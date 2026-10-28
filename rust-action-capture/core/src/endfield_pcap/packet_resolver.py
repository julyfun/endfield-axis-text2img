from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .runtime_paths import bundle_root


@dataclass(slots=True)
class PacketResolveContext:
    owner_hint: str = ""
    owner: str = ""
    src: str = ""
    active_suits_by_char: dict[str, set[str]] | None = None
    active_weapons_by_char: dict[str, str] | None = None
    blackboard_values: dict[str, float] | None = None
    blackboard_keys: set[str] | None = None


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_legacy_maps(root: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    packet_root = root / "data" / "packet_semantics"

    def load_map(name: str) -> dict[str, Any]:
        path = packet_root / name
        if not path.exists():
            return {}
        try:
            payload = _read_json(path)
        except (OSError, json.JSONDecodeError):
            return {}
        mappings = payload.get("mappings")
        if isinstance(mappings, dict):
            return mappings
        characters = payload.get("characters")
        if isinstance(characters, dict):
            return characters
        return {}

    return (
        load_map("skill_numeric_map.json"),
        load_map("buff_numeric_map.json"),
        load_map("actor_fingerprint_map.json"),
    )


def _load_static_buff_numeric_map(root: Path) -> dict[str, str]:
    path = root / "data" / "local_tables" / "NumIdStrTable.json"
    if not path.exists():
        return {}
    try:
        payload = _read_json(path)
    except (OSError, json.JSONDecodeError):
        return {}
    buff_table = payload.get("buff_id") if isinstance(payload, dict) else None
    mapping = buff_table.get("dic") if isinstance(buff_table, dict) else None
    if not isinstance(mapping, dict):
        return {}
    return {
        str(raw_id): str(canonical_id)
        for raw_id, canonical_id in mapping.items()
        if str(raw_id) and isinstance(canonical_id, str) and canonical_id
    }


def _char_prefix(template: str) -> str:
    parts = str(template or "").split("_")
    if len(parts) >= 3 and parts[0] == "chr" and parts[1].isdigit():
        return "_".join(parts[:3])
    return ""


def _character_family_from_id(text: str) -> str:
    match = re.search(r"(chr_\d{4}_[a-z0-9]+)", str(text or ""))
    return match.group(1) if match else ""


def _is_unknown_actor_name(value: str) -> bool:
    text = str(value or "").strip()
    return not text or text == "?" or text.startswith("id_")


class PacketResolver:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or bundle_root()).resolve()
        table = _read_json(self.root / "data/local_tables/NumIdStrTable.json")
        self.static_skill_by_numeric = table["skill_id"]["dic"]
        self.skill_by_owner_numeric: dict[str, str] = {}
        self.skill_by_numeric_unique: dict[str, str] = {}
        self.strong_skill_owner_by_numeric: dict[str, str] = {}
        self.buff_by_numeric: dict[str, dict[str, Any]] = {}
        self.static_buff_by_numeric: dict[str, str] = {}
        self.buff_content_by_id: dict[str, dict[str, Any]] = {}
        self.skill_content_by_id: dict[str, dict[str, Any]] = {}
        self.attribute_type_content_by_id: dict[str, dict[str, Any]] = {}
        self.attribute_type_by_numeric: dict[str, dict[str, Any]] = {}
        self.semantic_indexes: dict[str, Any] = {}
        self.bundle_path = self.root / "data" / "packet_semantics" / "packet_resolver_bundle.json"
        self._load()

    def _load(self) -> None:
        if self.bundle_path.exists():
            try:
                payload = _read_json(self.bundle_path)
            except (OSError, json.JSONDecodeError):
                payload = {}
            skills = payload.get("skills") if isinstance(payload, dict) else {}
            buffs = payload.get("buffs") if isinstance(payload, dict) else {}
            content = payload.get("content") if isinstance(payload, dict) else {}
            self.skill_by_owner_numeric = dict(skills.get("by_owner_numeric") or {})
            self.skill_by_numeric_unique = dict(skills.get("by_numeric_unique") or {})
            self.strong_skill_owner_by_numeric = dict(skills.get("strong_owner_by_numeric") or {})
            self.buff_by_numeric = dict(buffs.get("by_numeric") or {})
            if isinstance(content, dict):
                self.buff_content_by_id = dict(content.get("buffs") or {})
                self.skill_content_by_id = dict(content.get("skills") or {})
                self.attribute_type_content_by_id = dict(content.get("attribute_types") or {})
            indexes = payload.get("indexes") if isinstance(payload, dict) else {}
            if isinstance(indexes, dict):
                self.semantic_indexes = indexes
                attr_index = indexes.get("attribute_types")
                if isinstance(attr_index, dict):
                    self.attribute_type_by_numeric = dict(attr_index.get("by_attribute_type") or {})
            # The generated resolver bundle can lag behind a same-day resource
            # sync. Overlay the curated packet map and retain the authoritative
            # Buff NumIdStrTable as the final numeric identity source.
            _, legacy_buff_map, _ = _load_legacy_maps(self.root)
            self.buff_by_numeric.update(
                {
                    str(raw_key): value
                    for raw_key, value in legacy_buff_map.items()
                    if isinstance(value, dict)
                }
            )
            self.static_buff_by_numeric = _load_static_buff_numeric_map(self.root)
            return

        skill_numeric_map, buff_numeric_map, actor_fingerprint_map = _load_legacy_maps(self.root)

        by_int: dict[str, set[str]] = {}
        by_owner_numeric: dict[str, str] = {}
        for raw_key, mapping in skill_numeric_map.items():
            if not isinstance(raw_key, str) or not isinstance(mapping, dict):
                continue
            canonical = str(mapping.get("canonical_skill_id") or "")
            if not canonical:
                continue
            by_owner_numeric[raw_key] = canonical
            match = re.search(r"_skill_(\d+)$", raw_key)
            if match is not None:
                by_int.setdefault(match.group(1), set()).add(canonical)
        self.skill_by_owner_numeric = by_owner_numeric
        self.skill_by_numeric_unique = {
            int_id: next(iter(values))
            for int_id, values in by_int.items()
            if len(values) == 1
        }

        owners_by_int: dict[str, set[str]] = {}
        for actor_key, payload in actor_fingerprint_map.items():
            if not isinstance(actor_key, str) or not isinstance(payload, dict):
                continue
            for item in payload.get("strong_skill_ids") or []:
                int_id = str(item or "")
                if int_id:
                    owners_by_int.setdefault(int_id, set()).add(actor_key)
        self.strong_skill_owner_by_numeric = {
            int_id: next(iter(values))
            for int_id, values in owners_by_int.items()
            if len(values) == 1
        }
        self.buff_by_numeric = {
            str(raw_key): mapping
            for raw_key, mapping in buff_numeric_map.items()
            if isinstance(mapping, dict)
        }
        self.static_buff_by_numeric = _load_static_buff_numeric_map(self.root)

    @staticmethod
    def _packet_buff_mapping_applies(
        mapping: dict[str, Any],
        owner: str,
        src: str,
        active_suits_by_char: dict[str, set[str]] | None,
        active_weapons_by_char: dict[str, str] | None,
    ) -> bool:
        unknown_owner = _is_unknown_actor_name(owner)
        unknown_src = _is_unknown_actor_name(src)
        character_id = str(mapping.get("character_id") or "")
        if character_id:
            if character_id not in {owner, src}:
                if not (unknown_owner and unknown_src):
                    return False
                active_chars = set((active_weapons_by_char or {}).keys()) | set((active_suits_by_char or {}).keys())
                if character_id not in active_chars:
                    return False
        suit_id = str(mapping.get("suit_id") or "")
        if suit_id:
            suit_holders = {
                char
                for char, suits in (active_suits_by_char or {}).items()
                if suit_id in suits
            }
            if unknown_owner and unknown_src:
                if len(suit_holders) != 1:
                    return False
            elif not any(suit_id in (active_suits_by_char or {}).get(char, set()) for char in (owner, src)):
                return False
        weapon_id = str(mapping.get("weapon_id") or "")
        if weapon_id:
            weapon_holders = {
                char
                for char, active_weapon in (active_weapons_by_char or {}).items()
                if active_weapon == weapon_id
            }
            if unknown_owner and unknown_src:
                if len(weapon_holders) != 1:
                    return False
            else:
                weapon_candidates = {
                    (active_weapons_by_char or {}).get(owner),
                    (active_weapons_by_char or {}).get(src),
                }
                if weapon_id not in weapon_candidates:
                    return False
        return True

    def resolve_skill(self, str_id: Any = None, int_id: Any = None, *, context: PacketResolveContext | None = None) -> str | None:
        if isinstance(str_id, str) and str_id:
            return str_id
        if int_id is None:
            return None
        number = str(int(int_id))
        if number in self.static_skill_by_numeric:
            return self.static_skill_by_numeric[number]
        owner_hint = (context.owner_hint if context else "") or ""
        if owner_hint:
            mapped = self.skill_by_owner_numeric.get(f"{owner_hint}_skill_{number}")
            if mapped:
                return mapped
            return f"{owner_hint}_skill_{number}"
        fingerprint_owner = self.strong_skill_owner_by_numeric.get(number)
        if fingerprint_owner:
            mapped = self.skill_by_owner_numeric.get(f"{fingerprint_owner}_skill_{number}")
            if mapped:
                return mapped
            return f"{fingerprint_owner}_skill_{number}"
        direct = self.skill_by_numeric_unique.get(number)
        if direct:
            return direct
        return f"skill_{number}"

    def resolve_buff(self, str_id: Any = None, int_id: Any = None, *, context: PacketResolveContext | None = None) -> str:
        if isinstance(str_id, str) and str_id:
            return str_id
        if int_id is None:
            return "unknown_buff"
        number = str(int(int_id))
        mapping = self.buff_by_numeric.get(number)
        if isinstance(mapping, dict) and context is not None:
            if self._packet_buff_mapping_applies(
                mapping,
                context.owner,
                context.src,
                context.active_suits_by_char,
                context.active_weapons_by_char,
            ):
                canonical = str(mapping.get("canonical_buff_id") or "")
                if canonical:
                    return canonical
        static_canonical = self.static_buff_by_numeric.get(number)
        if static_canonical:
            return static_canonical
        semantic = self._resolve_buff_from_semantic_indexes(context)
        if semantic:
            return semantic
        return number

    def buff_content(self, canonical_id: str | None) -> dict[str, Any]:
        if not canonical_id:
            return {}
        payload = self.buff_content_by_id.get(canonical_id)
        return payload if isinstance(payload, dict) else {}

    def skill_content(self, canonical_id: str | None) -> dict[str, Any]:
        if not canonical_id:
            return {}
        payload = self.skill_content_by_id.get(canonical_id)
        return payload if isinstance(payload, dict) else {}

    def attribute_type_content(self, canonical_id: str | None) -> dict[str, Any]:
        if not canonical_id:
            return {}
        payload = self.attribute_type_content_by_id.get(canonical_id)
        return payload if isinstance(payload, dict) else {}

    def attribute_type_info(self, numeric_id: Any = None) -> dict[str, Any]:
        if numeric_id is None:
            return {}
        key = str(int(numeric_id))
        payload = self.attribute_type_by_numeric.get(key)
        return payload if isinstance(payload, dict) else {}

    def parent_rules(self, parent_type: str, canonical_id: str) -> dict[str, Any]:
        if not canonical_id:
            return {}
        indexes = self.semantic_indexes.get("parent_rules") if isinstance(self.semantic_indexes, dict) else {}
        if not isinstance(indexes, dict):
            return {}
        if parent_type == "skill":
            payload = indexes.get("skills")
        elif parent_type == "buff":
            payload = indexes.get("buffs")
        else:
            return {}
        if not isinstance(payload, dict):
            return {}
        row = payload.get(canonical_id)
        return row if isinstance(row, dict) else {}

    @staticmethod
    def _is_canonical_buff_id(value: str | None) -> bool:
        text = str(value or "")
        return bool(text) and text != "unknown_buff" and not text.isdigit()

    @staticmethod
    def _value_close(expected: float, actual: float) -> bool:
        return abs(expected - actual) <= max(0.05, abs(actual) * 0.15)

    @staticmethod
    def _blackboard_signature(values: dict[str, float] | None) -> str:
        if not isinstance(values, dict) or not values:
            return ""
        keys = sorted(str(key) for key in values.keys() if str(key))
        return "|".join(keys)

    @staticmethod
    def _blackboard_signature_from_keys(keys: set[str] | None) -> str:
        if not isinstance(keys, set) or not keys:
            return ""
        return "|".join(sorted(str(key) for key in keys if str(key)))

    def _buff_expected_values(self, canonical_id: str) -> dict[str, float]:
        row = self.buff_content(canonical_id)
        if not row:
            return {}
        values: dict[str, float] = {}
        for item in row.get("blackboard") or []:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "")
            default = item.get("defaultDouble")
            if key and isinstance(default, (int, float)):
                values[key] = float(default)
        for decode_key in ("manualDecode", "autoDecode"):
            decode = row.get(decode_key)
            if not isinstance(decode, dict):
                continue
            defaults = decode.get("blackboardDefaults")
            if isinstance(defaults, dict):
                for key, value in defaults.items():
                    if isinstance(value, (int, float)):
                        values[str(key)] = float(value)
            direct = decode.get("directFloatAssignments")
            if isinstance(direct, dict):
                for key, value in direct.items():
                    if isinstance(value, (int, float)):
                        values[str(key)] = float(value)
        return values

    def _buff_rule_reference_count(self, canonical_id: str) -> int:
        rules = self.parent_rules("buff", canonical_id)
        if not rules:
            return 0
        return len(rules.get("referenced_buff_ids") or []) + len(rules.get("created_buff_ids") or [])

    def _resolve_buff_from_semantic_indexes(self, context: PacketResolveContext | None) -> str | None:
        if context is None:
            return None
        has_values = isinstance(context.blackboard_values, dict) and bool(context.blackboard_values)
        has_keys = isinstance(context.blackboard_keys, set) and bool(context.blackboard_keys)
        if not has_values and not has_keys:
            return None
        indexes = self.semantic_indexes
        if not isinstance(indexes, dict):
            return None
        exact_index = ((indexes.get("blackboard_signature_index") or {}).get("buffs") or {})
        if not isinstance(exact_index, dict):
            return None
        primary_signature = self._blackboard_signature(context.blackboard_values)
        fallback_signature = self._blackboard_signature_from_keys(context.blackboard_keys)
        signature_candidates: list[tuple[str, bool]] = []
        if primary_signature:
            signature_candidates.append((primary_signature, True))
        if fallback_signature and fallback_signature != primary_signature:
            signature_candidates.append((fallback_signature, False))

        candidates: list[str] | None = None
        signature_from_values = False
        candidate_count = 10**9
        for signature, from_values in signature_candidates:
            current = exact_index.get(signature)
            if not isinstance(current, list) or not current:
                continue
            if len(current) == 1:
                candidate = str(current[0] or "")
                if candidate:
                    if from_values:
                        return candidate
                    if isinstance(context.blackboard_keys, set) and len(context.blackboard_keys) >= 4:
                        return candidate
                continue
            if len(current) < candidate_count:
                candidates = current
                signature_from_values = from_values
                candidate_count = len(current)
        if not candidates:
            return None

        src_char = _char_prefix(context.src)
        owner_char = _char_prefix(context.owner)
        src_weapon = (context.active_weapons_by_char or {}).get(src_char) or ""
        owner_weapon = (context.active_weapons_by_char or {}).get(owner_char) or ""
        parent_rule_index = ((indexes.get("parent_rules") or {}).get("buffs") or {})
        candidate_families = {
            _character_family_from_id(str(candidate or ""))
            for candidate in candidates
            if _character_family_from_id(str(candidate or ""))
        }
        shared_family = next(iter(candidate_families)) if len(candidate_families) == 1 else ""

        scored: list[tuple[int, int, int, int, str]] = []
        for candidate in candidates:
            buff_id = str(candidate or "")
            if not buff_id:
                continue
            score = 40
            family_hits = 0
            if src_char and src_char in buff_id:
                score += 10
                family_hits += 1
            if owner_char and owner_char in buff_id:
                score += 6
                family_hits += 1
            if src_weapon and src_weapon in buff_id:
                score += 10
                family_hits += 1
            if owner_weapon and owner_weapon in buff_id:
                score += 6
                family_hits += 1

            expected = self._buff_expected_values(buff_id)
            exact_value_matches = 0
            close_value_matches = 0
            for key, actual in context.blackboard_values.items():
                expected_value = expected.get(str(key))
                if expected_value is None:
                    continue
                if abs(expected_value - actual) < 1e-6:
                    score += 25
                    exact_value_matches += 1
                elif self._value_close(expected_value, actual):
                    score += 8
                    close_value_matches += 1

            rules = parent_rule_index.get(buff_id)
            if isinstance(rules, dict):
                references = len(rules.get("referenced_buff_ids") or []) + len(rules.get("created_buff_ids") or [])
                dynamic = len(rules.get("dynamic_keys") or [])
                if owner_char and src_char and references:
                    score += 4
                if owner_char and src_char and dynamic:
                    score -= 2
                if owner_char and src_char and not exact_value_matches and not close_value_matches:
                    if owner_char != src_char:
                        score += references * 3
                    else:
                        score -= references * 3
                if not exact_value_matches and not close_value_matches and not src_char and shared_family:
                    if owner_char and owner_char != shared_family:
                        score += references * 4
                    elif owner_char and owner_char == shared_family:
                        score -= references * 4
                    elif not owner_char:
                        score += references * 4

            scored.append((score, exact_value_matches, close_value_matches, family_hits, buff_id))

        scored.sort(key=lambda item: (-item[0], -item[1], -item[2], -item[3], item[4]))
        if not scored:
            return None
        best = scored[0]
        runner_up = scored[1] if len(scored) > 1 else None
        score, exact_matches, close_matches, family_hits, buff_id = best
        structure_confident = (
            family_hits > 0
            or (shared_family and owner_char and owner_char != shared_family)
            or (shared_family and not owner_char)
        )
        if (
            not signature_from_values
            and exact_matches == 0
            and close_matches == 0
            and isinstance(context.blackboard_keys, set)
            and context.blackboard_keys
        ):
            if not structure_confident:
                return None
            if score < 50:
                return None
            if runner_up is not None and score - runner_up[0] < 6:
                return None
            return buff_id
        if exact_matches <= 0 and close_matches < 2 and family_hits <= 0:
            return None
        if exact_matches > 0 and family_hits <= 0:
            if score < 65:
                return None
            if runner_up is not None and score - runner_up[0] < 20:
                return None
            return buff_id
        if score < 70:
            return None
        if runner_up is not None and score - runner_up[0] < 20:
            return None
        return buff_id

    @staticmethod
    def _content_created_ids(content: dict[str, Any]) -> list[str]:
        values: list[str] = []
        for key in ("createdBuffIds", "binaryCreatedBuffIds"):
            for item in content.get(key) or []:
                text = str(item or "")
                if text:
                    values.append(text)
        for decode_key in ("manualDecode", "autoDecode"):
            decode = content.get(decode_key)
            if not isinstance(decode, dict):
                continue
            for item in decode.get("highConfidenceCreatedBuffIds") or []:
                text = str(item or "")
                if text:
                    values.append(text)
        deduped: list[str] = []
        seen: set[str] = set()
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            deduped.append(value)
        return deduped

    @staticmethod
    def _content_assignment_patterns(content: dict[str, Any]) -> list[dict[str, Any]]:
        patterns: list[dict[str, Any]] = []
        for decode_key in ("manualDecode", "autoDecode"):
            decode = content.get(decode_key)
            if not isinstance(decode, dict):
                continue
            for item in decode.get("createdBuffAssignmentPatterns") or []:
                if isinstance(item, dict):
                    patterns.append(item)
        for item in content.get("createdBuffActions") or []:
            if not isinstance(item, dict):
                continue
            buff_id = str(item.get("buffId") or "")
            if not buff_id:
                continue
            assign_map: dict[str, str] = {}
            for assign_item in item.get("assignItems") or []:
                if not isinstance(assign_item, dict):
                    continue
                src_key = str(assign_item.get("inputValueKey") or "")
                tgt_key = str(assign_item.get("targetKey") or "")
                if src_key and tgt_key:
                    assign_map[src_key] = tgt_key
            patterns.append({"buffId": buff_id, "assignMap": assign_map})
        deduped: list[dict[str, Any]] = []
        seen: set[tuple[str, tuple[tuple[str, str], ...]]] = set()
        for item in patterns:
            buff_id = str(item.get("buffId") or "")
            assign_map = item.get("assignMap") if isinstance(item.get("assignMap"), dict) else {}
            key = (buff_id, tuple(sorted((str(k), str(v)) for k, v in assign_map.items() if k and v)))
            if not buff_id or key in seen:
                continue
            seen.add(key)
            deduped.append({"buffId": buff_id, "assignMap": dict(key[1])})
        return deduped

    @staticmethod
    def _assigned_item_keys(assigned_items: Any) -> tuple[set[str], set[str]]:
        target_keys: set[str] = set()
        input_keys: set[str] = set()
        if not isinstance(assigned_items, list):
            return target_keys, input_keys
        for item in assigned_items:
            if not isinstance(item, dict):
                continue
            target = str(item.get("target_key") or item.get("targetKey") or "")
            input_key = str(item.get("input_value_key") or item.get("inputValueKey") or "")
            if target:
                target_keys.add(target)
            if input_key:
                input_keys.add(input_key)
        return target_keys, input_keys

    def resolve_created_buff(
        self,
        *,
        parent_type: str,
        parent_canonical_id: str,
        assigned_items: Any,
    ) -> str | None:
        if not parent_canonical_id:
            return None
        rules = self.parent_rules(parent_type, parent_canonical_id)
        if rules:
            created_ids = [
                str(item or "")
                for item in (rules.get("created_buff_ids") or [])
                if str(item or "")
            ]
            if len(created_ids) == 1:
                return created_ids[0]
            referenced_ids = [
                str(item or "")
                for item in (rules.get("referenced_buff_ids") or [])
                if str(item or "")
            ]
            patterns = []
            for item in rules.get("assignment_patterns") or []:
                if not isinstance(item, dict):
                    continue
                buff_id = str(item.get("buff_id") or "")
                assign_map = item.get("assign_map") if isinstance(item.get("assign_map"), dict) else {}
                if buff_id:
                    patterns.append({"buffId": buff_id, "assignMap": assign_map})
            target_keys, input_keys = self._assigned_item_keys(assigned_items)
            scored: list[tuple[int, str]] = []
            for item in patterns:
                buff_id = str(item.get("buffId") or "")
                assign_map = item.get("assignMap") if isinstance(item.get("assignMap"), dict) else {}
                if not buff_id:
                    continue
                pattern_input = {str(key) for key in assign_map.keys() if key}
                pattern_target = {str(value) for value in assign_map.values() if value}
                score = 0
                if target_keys and pattern_target:
                    if target_keys == pattern_target:
                        score += 100
                    else:
                        score += 10 * len(target_keys & pattern_target)
                if input_keys and pattern_input:
                    if input_keys == pattern_input:
                        score += 80
                    else:
                        score += 8 * len(input_keys & pattern_input)
                if score > 0:
                    scored.append((score, buff_id))
            scored.sort(key=lambda item: (-item[0], item[1]))
            if scored and (len(scored) == 1 or scored[0][0] > scored[1][0]):
                return scored[0][1]
            if referenced_ids:
                child_values = self._assigned_item_keys(assigned_items)
                target_keys, _input_keys = child_values
                child_key_signature = "|".join(sorted(target_keys))
                candidate_rows: list[tuple[int, str]] = []
                for buff_id in referenced_ids:
                    child_rules = self.parent_rules("buff", buff_id)
                    if not child_rules:
                        continue
                    blackboard_keys = set(str(key) for key in (child_rules.get("blackboard_keys") or []) if str(key))
                    score = 0
                    if not target_keys and not blackboard_keys:
                        score += 20
                    if target_keys and blackboard_keys:
                        if target_keys == blackboard_keys:
                            score += 40
                        else:
                            score += 5 * len(target_keys & blackboard_keys)
                    if blackboard_keys:
                        score += min(len(blackboard_keys), 4)
                    if self._buff_rule_reference_count(buff_id) == 0:
                        score += 3
                    if score > 0:
                        candidate_rows.append((score, buff_id))
                candidate_rows.sort(key=lambda item: (-item[0], item[1]))
                if candidate_rows and (len(candidate_rows) == 1 or candidate_rows[0][0] > candidate_rows[1][0]):
                    return candidate_rows[0][1]
        if parent_type == "skill":
            content = self.skill_content(parent_canonical_id)
        elif parent_type == "buff":
            content = self.buff_content(parent_canonical_id)
        else:
            return None
        if not content:
            return None

        created_ids = self._content_created_ids(content)
        if len(created_ids) == 1:
            return created_ids[0]

        target_keys, input_keys = self._assigned_item_keys(assigned_items)
        patterns = self._content_assignment_patterns(content)
        scored: list[tuple[int, str]] = []
        for item in patterns:
            buff_id = str(item.get("buffId") or "")
            assign_map = item.get("assignMap") if isinstance(item.get("assignMap"), dict) else {}
            if not buff_id:
                continue
            pattern_input = {str(key) for key in assign_map.keys() if key}
            pattern_target = {str(value) for value in assign_map.values() if value}
            score = 0
            if target_keys and pattern_target:
                if target_keys == pattern_target:
                    score += 100
                else:
                    score += 10 * len(target_keys & pattern_target)
            if input_keys and pattern_input:
                if input_keys == pattern_input:
                    score += 80
                else:
                    score += 8 * len(input_keys & pattern_input)
            if score > 0:
                scored.append((score, buff_id))
        scored.sort(key=lambda item: (-item[0], item[1]))
        if scored and (len(scored) == 1 or scored[0][0] > scored[1][0]):
            return scored[0][1]
        return None
