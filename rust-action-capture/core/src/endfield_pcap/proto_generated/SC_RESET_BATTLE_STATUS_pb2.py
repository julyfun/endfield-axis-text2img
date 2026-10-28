# Generated manually for local decode compatibility.
# The source proto imports BATTLE_RESET_REASON.proto, whose top-level enum
# values collide with other global enum symbols in this mixed proto corpus.
# For packet inspection we only need to preserve field layout, so `reason`
# is decoded as a plain int32 instead of importing the conflicting enum.

from google.protobuf import descriptor_pb2 as _descriptor_pb2
from google.protobuf import descriptor_pool as _descriptor_pool
from google.protobuf.internal import builder as _builder

import BATTLE_MGR_INFO_pb2 as BATTLE__MGR__INFO__pb2  # noqa: F401


_file_proto = _descriptor_pb2.FileDescriptorProto()
_file_proto.name = "SC_RESET_BATTLE_STATUS.proto"
_file_proto.syntax = "proto3"
_file_proto.dependency.extend(["BATTLE_MGR_INFO.proto"])

_message = _file_proto.message_type.add()
_message.name = "SC_RESET_BATTLE_STATUS"

_field = _message.field.add()
_field.name = "inst_id"
_field.number = 1
_field.label = _descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
_field.type = _descriptor_pb2.FieldDescriptorProto.TYPE_UINT64

_field = _message.field.add()
_field.name = "battle_inst_id"
_field.number = 2
_field.label = _descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
_field.type = _descriptor_pb2.FieldDescriptorProto.TYPE_UINT64

_field = _message.field.add()
_field.name = "battle_info"
_field.number = 3
_field.label = _descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
_field.type = _descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
_field.type_name = ".BATTLE_MGR_INFO"

_field = _message.field.add()
_field.name = "reason"
_field.number = 4
_field.label = _descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
_field.type = _descriptor_pb2.FieldDescriptorProto.TYPE_INT32

DESCRIPTOR = _descriptor_pool.Default().AddSerializedFile(_file_proto.SerializeToString())

_globals = globals()
_builder.BuildMessageAndEnumDescriptors(DESCRIPTOR, _globals)
_builder.BuildTopDescriptorsAndMessages(DESCRIPTOR, "SC_RESET_BATTLE_STATUS_pb2", _globals)
