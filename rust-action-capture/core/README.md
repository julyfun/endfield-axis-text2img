# Bundled capture core

This directory contains the runtime dependency closure of EndfieldLogsClient's
`_internal/src/endfield_pcap`, plus generated protobuf modules and resources used
by the headless capture worker. The source snapshot was taken from the locally
installed `EndfieldLogsClient_2.10.85_20260810` on 2026-10-29. Missing generated skill-update and ping modules were sourced from
https://github.com/medps16000/endfield-suite-open at commit `8ea1718288a0d9f38d83e0e192bc40b851a30928`.
The upstream MIT license is preserved in `LICENSE`.

Excluded: client GUI, updater, overlays, uploaders, Python runtime, caches,
Npcap binaries, game DLLs, user settings, and captured logs.

Local changes:

- Decode and log CS/SC ping messages for clock synchronization; battle operation
  events also preserve their generation for detecting simulation clock resets.

- `PacketResolver` loads the authoritative `skill_id` mapping before heuristic
  packet mappings. The table includes the newer action IDs already tracked in
  this repository's `data/skill_actions.csv` (including multi-stage skills).

`secrets/client_privkey.pem` is the protocol decryption resource distributed in
that client bundle; it is not a user account key. Never place personal keys or
captured login/session data in this directory.

Source runs load from `core/src`; PyInstaller copies `core/data`, `core/jsondata`
and the protocol key into the frozen worker. No external client path is used.
