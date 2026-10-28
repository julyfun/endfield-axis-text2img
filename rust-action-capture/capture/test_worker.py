"""Integration tests against the repository capture core."""
import argparse
import asyncio
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from collections import Counter
from types import SimpleNamespace
from unittest.mock import Mock, patch

import worker

worker.configure_core()
from endfield_pcap.models import RuntimeMetrics, SquadMember
from endfield_pcap.packet_resolver import PacketResolver
from endfield_pcap.proto_generated.CS_BATTLE_OP_pb2 import CS_BATTLE_OP
from endfield_pcap.proto_generated.SC_SELF_SCENE_INFO_pb2 import SC_SELF_SCENE_INFO
from endfield_pcap.proto_generated.SC_CHAR_BAG_SET_TEAM_LEADER_pb2 import SC_CHAR_BAG_SET_TEAM_LEADER
from endfield_pcap.service import SessionPipeline


class WorkerTests(unittest.TestCase):
    def test_bundled_resources_and_every_registered_message_load_without_external_client(self):
        from endfield_pcap.runtime_paths import bundle_root
        from endfield_pcap.message_registry import MessageRegistry
        root = Path(__file__).resolve().parents[1] / "core"
        self.assertEqual(bundle_root(), root)
        worker.verify_protocols()
        registry = MessageRegistry(root / "data")
        for direction, mapping in registry._maps.items():
            for msg_id, name in mapping.items():
                if registry.should_decode_message(direction, msg_id):
                    with self.subTest(message=name):
                        self.assertIsNotNone(registry.load_message_class(name))

    def test_server_skill_update_messages_reach_action_sink(self):
        from endfield_pcap.proto_generated.SC_ATTACH_SERVER_SKILL_pb2 import SC_ATTACH_SERVER_SKILL
        message = SC_ATTACH_SERVER_SKILL()
        skill = message.skills.add()
        skill.inst_id = 7
        skill.skill_id.int_id = 3297
        decoded = SC_ATTACH_SERVER_SKILL.FromString(message.SerializeToString())
        pipeline = SessionPipeline.__new__(SessionPipeline)
        pipeline.session_id = "server-update"
        row = pipeline._server_skill_row(42, decoded.skills[0])
        sink = worker.EventSink(PacketResolver())
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            sink({"type": "SC_ATTACH_SERVER_SKILL", "session_id": "server-update", "skills": [row]})
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(events[-1]["template_str_id"], "chr_0036_jsspsi_normal_skill")
        self.assertEqual(events[-1]["action"], "战技")

    def test_heartbeat_proto_decode_pairs_echoed_token_for_clock_calibration(self):
        from endfield_pcap.message_registry import MessageRegistry
        from endfield_pcap.runtime_paths import bundle_root
        from endfield_pcap.proto_generated.CS_PING_pb2 import CS_PING
        from endfield_pcap.proto_generated.SC_PING_pb2 import SC_PING
        registry = MessageRegistry(bundle_root() / "data")
        pipeline = SessionPipeline.__new__(SessionPipeline)
        pipeline.session_id = "clock-test"
        pipeline.decoded_class_counts = Counter()
        pipeline.on_debug_message = None
        sink = worker.EventSink(PacketResolver())
        pipeline._emit_event = lambda event: sink(event.as_dict())
        base = 1_800_000_000_000
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            for direction, message, timestamp in [
                ("cs", CS_PING(client_ts=12345, logical_ts=1000), base),
                ("sc", SC_PING(client_ts=12345, server_ts=base + 310), base + 20),
                ("sc", SC_PING(client_ts=99999, server_ts=base + 320), base + 30),
            ]:
                msg_id = next(i for i, name in registry._maps[direction].items() if name == message.DESCRIPTOR.name)
                decoded, = registry.decode_messages(direction, {"msgid": msg_id}, message.SerializeToString())
                pipeline._handle_message(decoded, timestamp)
        samples = [json.loads(line) for line in output.getvalue().splitlines() if json.loads(line)["type"] == "capture_clock_sample"]
        self.assertEqual(samples, [{"type": "capture_clock_sample", "send_ms": base,
                                   "receive_ms": base + 20, "server_ms": base + 310}])
        # A response from the preceding session cannot calibrate a new session.
        with contextlib.redirect_stdout(io.StringIO()):
            sink({"type": "CS_PING", "session_id": "clock-test", "timestamp_ms": base, "client_ts": 7})
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            sink({"type": "SC_PING", "session_id": "new-session", "timestamp_ms": base + 20,
                  "client_ts": 7, "server_ts": base + 310})
        self.assertNotIn("capture_clock_sample", output.getvalue())

    def test_server_leader_switch_updates_battle_owner_before_next_cast(self):
        pipeline_class = worker.leader_tracking_pipeline()
        pipeline = pipeline_class.__new__(pipeline_class)
        pipeline.squad_index = {
            42: SquadMember(42, 1001, "chr_test", "A", True, 0),
            43: SquadMember(43, 1002, "chr_other", "B", False, 1),
        }
        pipeline.decoded_class_counts = Counter()
        pipeline.on_debug_message = None
        pipeline._emit_scene_info_event = Mock()
        pipeline._emit_loadout_event = Mock()
        message = SC_CHAR_BAG_SET_TEAM_LEADER(leaderid=1002)
        decoded = SimpleNamespace(class_name="SC_CHAR_BAG_SET_TEAM_LEADER",
                                  message=SC_CHAR_BAG_SET_TEAM_LEADER.FromString(message.SerializeToString()))
        pipeline._handle_message(decoded, 1234)
        self.assertFalse(pipeline.squad_index[42].is_leader)
        self.assertTrue(pipeline.squad_index[43].is_leader)
        pipeline._emit_scene_info_event.assert_called_once_with(1234)

    def test_real_skill_table_stages_finishers_execution_and_ai_filters(self):
        rules = worker.EventSink(PacketResolver()).rules
        expected = {
            "chr_0036_jsspsi_normal_skill": "战技",
            "chr_0036_jsspsi_normal_skill_1": "战技II",
            "chr_0036_jsspsi_normal_skill_2": "战技III",
            "chr_0036_jsspsi_attack1": None,
            "chr_0036_jsspsi_attack4": None,
            "chr_0036_jsspsi_attack5": "重击",
            "chr_0036_jsspsi_power_attack": "处决",
            "chr_0003_endminf_power_attack2": "处决",
            "common_character_perfect_dodge": "闪避",
            "common_character_ai_dash": None,
            "chr_0036_jsspsi_ai_dodge": None,
            "common_character_walkretreat": None,
        }
        for skill, action in expected.items():
            with self.subTest(skill=skill):
                self.assertEqual(rules.classify(skill), action)
        from skill_actions import ActionRules
        rules = ActionRules(["chr_test_attack1", "chr_test_attack3", "chr_other_attack4"])
        self.assertIsNone(rules.classify("chr_test_attack1"))
        self.assertEqual(rules.classify("chr_test_attack3"), "重击")

    def test_login_skill_list_initializes_casts_without_client_attach_events(self):
        sink = worker.EventSink(PacketResolver())
        pipeline = SessionPipeline.__new__(SessionPipeline)
        pipeline.session_id = "login-session"
        pipeline.squad_index = {}
        pipeline.entity_index = {}
        pipeline.metrics = RuntimeMetrics()
        pipeline.on_event = lambda event: sink(event.as_dict())
        scene = SC_SELF_SCENE_INFO()
        character = scene.detail.char_list.add()
        for inst, numeric in [(7, 3297), (8, 3414), (9, 3722), (10, 3093)]:
            skill = character.battle_info.skill_list.add()
            skill.inst_id = inst
            skill.skill_id.int_id = numeric
        scene = SC_SELF_SCENE_INFO.FromString(scene.SerializeToString())
        rows = [pipeline._server_skill_row(42, skill) for skill in scene.detail.char_list[0].battle_info.skill_list]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            pipeline._emit_server_skill_rows_event("SC_SELF_SCENE_INFO_SKILLS", 42, None, rows, 1800000000000)
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        skills = {e["skill_inst_id"]: e["template_str_id"] for e in events if e["type"] == "BattleOpSkillAttach"}
        self.assertEqual(skills, {7:"chr_0036_jsspsi_normal_skill", 8:"chr_0036_jsspsi_combo_skill", 9:"chr_0036_jsspsi_ultimate_skill", 10:"chr_0036_jsspsi_attack1"})
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            sink({"type":"SC_DETACH_SERVER_SKILL", "session_id":"login-session", "del_skill_inst_ids":[7]})
        self.assertEqual(json.loads(output.getvalue()), {"type":"BattleOpSkillDetach", "skill_inst_id":7})

    def test_protobuf_cast_reaches_ndjson_with_resolved_skill(self):
        sink = worker.EventSink(PacketResolver())
        pipeline = SessionPipeline.__new__(SessionPipeline)
        pipeline.session_id = "test-session"
        pipeline.metrics = RuntimeMetrics()
        pipeline.on_event = lambda event: sink(event.as_dict())
        message = CS_BATTLE_OP()
        op = message.client_data.op_list.add()
        op.op_type = op.DESCRIPTOR.fields_by_name["op_type"].enum_type.values_by_name["BattleOpSkillAttach"].number
        op.skill_attach_op_data.skill_inst_id = 7
        op.skill_attach_op_data.skill_id.int_id = 110
        op = message.client_data.op_list.add()
        op.op_type = op.DESCRIPTOR.fields_by_name["op_type"].enum_type.values_by_name["BattleOpSkillStartCast"].number
        op.owner_id = 42
        op.skill_start_cast_op_data.inst_id = 7
        op.client_tick_tms = 1234
        op.generation = 2
        decoded = CS_BATTLE_OP.FromString(message.SerializeToString())
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            pipeline._emit_battle_events(decoded, 1800000000000)
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([e["type"] for e in events], ["capture_session", "BattleOpSkillAttach", "BattleOpSkillStartCast"])
        self.assertEqual(events[1]["template_str_id"], "chr_0004_pelica_normal_skill")
        self.assertEqual(events[1]["action"], "战技")
        self.assertEqual(events[2]["owner_id"], 42)
        self.assertEqual(events[2]["skill_inst_id"], 7)
        self.assertEqual(events[2]["client_tick_tms"], 1234)
        self.assertEqual(events[2]["generation"], 2)

    def test_parent_eof_stops_service_and_closes_capture(self):
        manager = Mock()
        with tempfile.TemporaryDirectory() as logs:
            args = argparse.Namespace(game_dir=None, log_dir=Path(logs), check=False)
            with patch("endfield_pcap.service.CaptureManager.create", return_value=manager), patch("sys.stdin", io.StringIO("")), contextlib.redirect_stdout(io.StringIO()):
                asyncio.run(asyncio.wait_for(worker.capture(args), timeout=10))
        manager.start.assert_called_once()
        manager.stop.assert_called_once()


if __name__ == "__main__":
    unittest.main()
