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
from endfield_pcap.service import SessionPipeline


class WorkerTests(unittest.TestCase):
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
