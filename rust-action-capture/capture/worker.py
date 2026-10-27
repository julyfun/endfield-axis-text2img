"""Headless capture worker. stdout is NDJSON; stdin EOF or a line stops capture."""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
from pathlib import Path
import sys
import threading

from skill_actions import ActionRules


def emit(event: dict) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def configure_core(root: Path | None) -> None:
    if root is not None:
        sys.path.insert(0, str(root / "src"))
    # Keep the DLL search handle alive for the duration of capture.
    npcap = Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/Npcap"
    if npcap.is_dir():
        global _npcap_dll_directory
        _npcap_dll_directory = os.add_dll_directory(str(npcap))


class EventSink:
    def __init__(self, resolver):
        self.resolver = resolver
        self.session = None
        self.rules = ActionRules(resolver.static_skill_by_numeric.values())

    def __call__(self, event: dict) -> None:
        kind = event.get("type")
        if event.get("session_id") != self.session:
            self.session = event.get("session_id")
            emit({"type": "capture_session", "session_id": self.session})
        if kind in {"SC_SELF_SCENE_INFO_SKILLS", "SC_ATTACH_SERVER_SKILL", "SC_UPDATE_SERVER_SKILL"}:
            for skill in event.get("skills") or []:
                self({**skill, "type": "BattleOpSkillAttach", "session_id": self.session,
                      "timestamp_ms": event.get("timestamp_ms")})
            return
        if kind == "SC_DETACH_SERVER_SKILL":
            for inst in event.get("del_skill_inst_ids") or []:
                emit({"type": "BattleOpSkillDetach", "skill_inst_id": inst})
            return
        if kind == "BattleOpSkillAttach":
            event = dict(event)
            event["template_str_id"] = self.resolver.resolve_skill(
                event.get("template_str_id"), event.get("template_int_id")
            ) or str(event.get("template_int_id") or "")
            if not event["template_str_id"]:
                return
            event["action"] = self.rules.classify(event["template_str_id"])
        if kind in {
            "BattleOpSkillAttach", "BattleOpSkillDetach", "BattleOpSkillStartCast",
            "BattleOpModifyBattleState", "SC_SELF_SCENE_INFO", "squad_update",
            "SC_GAME_MECHANICS_SYNC_CHALLENGE_START",
            "SC_GAME_MECHANICS_SYNC_CHALLENGE_COMPLETE", "SC_RESET_BATTLE_STATUS",
            "SC_SYNC_WEEK_RAID_SETTLEMENT", "SC_GAME_MECHANICS_SYNC_RESTART_GAME_INST",
        }:
            emit(event)


def verify_protocols() -> None:
    from endfield_pcap.message_registry import MessageRegistry
    from endfield_pcap.runtime_paths import bundle_root

    registry = MessageRegistry(bundle_root() / "data")
    required = (
        "CS_BATTLE_OP", "CS_PING", "SC_PING", "SC_SELF_SCENE_INFO",
        "SC_GAME_MECHANICS_SYNC_CHALLENGE_START", "SC_GAME_MECHANICS_SYNC_CHALLENGE_COMPLETE",
        "SC_CHAR_BAG_SET_TEAM_LEADER",
    )
    missing = [name for name in required if registry.load_message_class(name) is None]
    if missing:
        raise RuntimeError("抓包组件缺少协议模块，请重新构建完整发行包：" + ", ".join(missing))


def leader_tracking_pipeline():
    from endfield_pcap.service import SessionPipeline

    if getattr(SessionPipeline, "tracks_leader", False):
        return SessionPipeline

    class LeaderTrackingPipeline(SessionPipeline):
        tracks_leader = True

        def _handle_message(self, decoded, timestamp_ms):
            if decoded.class_name == "SC_CHAR_BAG_SET_TEAM_LEADER":
                leader = int(decoded.message.leaderid)
                for member in self.squad_index.values():
                    member.is_leader = member.obj_id == leader
                self._emit_scene_info_event(timestamp_ms)
            super()._handle_message(decoded, timestamp_ms)

    return LeaderTrackingPipeline


async def capture(args) -> None:
    import endfield_pcap.service as core_service
    from endfield_pcap.install_detect import detect_game_dll_dir
    from endfield_pcap.models import ServiceObserver
    from endfield_pcap.packet_resolver import PacketResolver
    from endfield_pcap.runtime_paths import bundle_root
    from endfield_pcap.service import DamageLogService, ServiceConfig

    core_service.SessionPipeline = leader_tracking_pipeline()

    game_dir = args.game_dir or detect_game_dll_dir()
    if game_dir is None or not (game_dir / "GameAssembly.dll").is_file():
        raise RuntimeError("未找到游戏目录，请在设置中填写包含 GameAssembly.dll 的终末地目录")
    root = bundle_root()
    config = ServiceConfig(
        ws_port=0, log_dir=args.log_dir, log_level="INFO", game_exe="Endfield.exe",
        npcap_device="auto", dll_dir=game_dir, debug_enabled=False,
        debug_dir=args.log_dir / "debug", rsa_key_txt=root / "secrets/client_privkey.pem",
        name_index_path=root / "jsondata/CharacterNameIndex.json", trace_enabled=False,
    )
    observer = ServiceObserver(
        on_event=EventSink(PacketResolver()),
        on_state_change=lambda state, *_: emit({"type": "capture_status", "state": str(state)}),
        on_runtime_metrics=lambda metrics, *_: emit({
            "type": "capture_metrics", "packets": metrics.packets_seen,
            "decoded": metrics.messages_decoded,
        }),
    )
    service = DamageLogService(config, observer)
    if args.check:
        emit({"type": "capture_status", "state": "ready", "game_dir": str(game_dir)})
        return
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()

    def watch_parent():
        sys.stdin.readline()
        loop.call_soon_threadsafe(stop.set)

    threading.Thread(target=watch_parent, daemon=True).start()
    task = asyncio.create_task(service.run())
    stopped = asyncio.create_task(stop.wait())
    try:
        await asyncio.wait((task, stopped), return_when=asyncio.FIRST_COMPLETED)
        service.request_stop()
        await task
    finally:
        stopped.cancel()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core-root", type=Path)
    parser.add_argument("--game-dir", type=Path)
    parser.add_argument("--log-dir", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--check-protocols", action="store_true")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    try:
        configure_core(args.core_root)
        verify_protocols()
        if args.check_protocols:
            emit({"type": "capture_status", "state": "protocols_ready"})
            return 0
        asyncio.run(capture(args))
        return 0
    except Exception as exc:
        message = str(exc)
        if "wpcap.dll" in message:
            message = "未找到 Npcap 抓包驱动，请安装 Npcap 后重试。" + message
        emit({"type": "capture_error", "message": message})
        logging.exception("Capture failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
