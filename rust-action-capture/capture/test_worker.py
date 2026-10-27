"""Integration tests against the capture core selected by ENDFIELD_CAPTURE_CORE."""
import argparse
import asyncio
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import worker

worker.configure_core(Path(os.environ["ENDFIELD_CAPTURE_CORE"]))
from endfield_pcap.models import RuntimeMetrics
from endfield_pcap.packet_resolver import PacketResolver
from endfield_pcap.proto_generated.CS_BATTLE_OP_pb2 import CS_BATTLE_OP
from endfield_pcap.proto_generated.SC_SELF_SCENE_INFO_pb2 import SC_SELF_SCENE_INFO
from endfield_pcap.service import SessionPipeline


class WorkerTests(unittest.TestCase):
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
