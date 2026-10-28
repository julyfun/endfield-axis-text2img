from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from .runtime_paths import bundle_root


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return None


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _value_options(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def _select_option(options: list[Any], level: Any) -> Any:
    if not options or level is None:
        return None
    try:
        level_int = int(level)
    except (TypeError, ValueError):
        return None
    if 0 <= level_int < len(options):
        return options[level_int]
    if 1 <= level_int <= len(options):
        return options[level_int - 1]
    return None


def _sub_key_order(raw_key: Any) -> tuple[int, str]:
    match = re.search(r"(\d+)", str(raw_key))
    return (int(match.group(1)) if match else 99, str(raw_key))


def _build_affix_rows(item: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    main_attr = item.get("主词条")
    if isinstance(main_attr, dict):
        rows.append(
            {
                "kind": "main",
                "index": 0,
                "desc": _clean_text(main_attr.get("desc")),
                "value": main_attr.get("value"),
                "value_options": _value_options(main_attr.get("value")),
            }
        )
    sub_attrs = item.get("副词条")
    if isinstance(sub_attrs, dict):
        for index, key in enumerate(sorted(sub_attrs.keys(), key=_sub_key_order)):
            attr = sub_attrs.get(key)
            if not isinstance(attr, dict):
                continue
            rows.append(
                {
                    "kind": "sub",
                    "index": index,
                    "desc": _clean_text(attr.get("desc")),
                    "value": attr.get("value"),
                    "value_options": _value_options(attr.get("value")),
                }
            )
    return rows


@lru_cache(maxsize=1)
def weapon_catalog(root: str | None = None) -> dict[str, dict[str, Any]]:
    base = Path(root) if root else bundle_root()
    items_dir = base / "data" / "akedata" / "weapon" / "items"
    result: dict[str, dict[str, Any]] = {}
    if not items_dir.exists():
        return result
    for path in sorted(items_dir.glob("*.json")):
        payload = _read_json(path)
        if not isinstance(payload, dict):
            continue
        weapon_id = str(payload.get("weaponId") or path.stem)
        result[weapon_id] = {
            "weapon_id": weapon_id,
            "name": _clean_text(payload.get("title") or payload.get("name") or weapon_id),
            "rarity": payload.get("rarity"),
            "base_atk": payload.get("baseAtk") if isinstance(payload.get("baseAtk"), list) else [],
            "skilllist": payload.get("skilllist") if isinstance(payload.get("skilllist"), list) else [],
        }
    return result


@lru_cache(maxsize=1)
def equip_piece_catalog(root: str | None = None) -> dict[str, dict[str, Any]]:
    base = Path(root) if root else bundle_root()
    items_dir = base / "data" / "akedata" / "equip" / "items"
    result: dict[str, dict[str, Any]] = {}
    if not items_dir.exists():
        return result
    for path in sorted(items_dir.glob("*.json")):
        payload = _read_json(path)
        if not isinstance(payload, dict):
            continue
        suit_id = str(payload.get("suitID") or path.stem)
        suit_name = _clean_text(payload.get("套组名称") or payload.get("displayName") or payload.get("name"))
        equip_items = payload.get("equip")
        if not isinstance(equip_items, dict):
            continue
        for item_id, item in equip_items.items():
            if not isinstance(item, dict):
                continue
            item_key = str(item.get("itemId") or item_id)
            result[item_key] = {
                "item_id": item_key,
                "name": _clean_text(item.get("name")) or item_key,
                "suit_id": suit_id,
                "suit_name": suit_name,
                "part": _clean_text(item.get("部位")),
                "affixes": _build_affix_rows(item),
            }
    return result


@lru_cache(maxsize=1)
def attribute_type_catalog(root: str | None = None) -> dict[int, dict[str, Any]]:
    base = Path(root) if root else bundle_root()
    items_dir = base / "data" / "akedata" / "attribute_type" / "items"
    result: dict[int, dict[str, Any]] = {}
    if not items_dir.exists():
        return result
    for path in sorted(items_dir.glob("*.json")):
        payload = _read_json(path)
        if not isinstance(payload, dict):
            continue
        try:
            attr_type = int(payload.get("attributeType") if payload.get("attributeType") is not None else path.stem)
        except (TypeError, ValueError):
            continue
        result[attr_type] = {
            "attribute_type": attr_type,
            "name": _clean_text(payload.get("name")) or f"AttributeType{attr_type}",
            "slug": _clean_text(payload.get("slug")) or f"attribute_type_{attr_type}",
            "default_value": payload.get("defaultValue"),
        }
    return result


def weapon_base_atk(weapon_template: str, weapon_level: int) -> int | float | None:
    values = weapon_catalog().get(str(weapon_template or ""), {}).get("base_atk")
    if not isinstance(values, list) or not values:
        return None
    if weapon_level <= 0:
        weapon_level = len(values)
    if weapon_level > len(values):
        return None
    value = values[weapon_level - 1]
    return value if isinstance(value, (int, float)) else None


def weapon_base_atk_bounds(weapon_template: str) -> dict[str, int | float | None]:
    values = weapon_catalog().get(str(weapon_template or ""), {}).get("base_atk")
    if not isinstance(values, list) or not values:
        return {"lv1": None, "max": None}
    first = values[0]
    last = values[-1]
    return {
        "lv1": first if isinstance(first, (int, float)) else None,
        "max": last if isinstance(last, (int, float)) else None,
    }


def _full_option_level(options: list[Any]) -> int | None:
    if not options:
        return None
    return len(options) - 1


def selected_weapon_blackboard(weapon_template: str, refine: int) -> list[dict[str, Any]]:
    meta = weapon_catalog().get(str(weapon_template or ""), {})
    rows: list[dict[str, Any]] = []
    for skill in meta.get("skilllist") or []:
        if not isinstance(skill, dict):
            continue
        skill_name = _clean_text(skill.get("skillName")) or "weapon_skill"
        for raw in skill.get("blackboard") or []:
            if not isinstance(raw, dict):
                continue
            key = _clean_text(raw.get("key"))
            values = raw.get("value")
            selected = _select_option(values if isinstance(values, list) else [values], refine)
            rows.append(
                {
                    "skill_name": skill_name,
                    "key": key,
                    "refine": refine,
                    "value": selected,
                    "values": values,
                }
            )
    return rows


def _weapon_skill_blackboard_rows(weapon_template: str) -> list[dict[str, Any]]:
    meta = weapon_catalog().get(str(weapon_template or ""), {})
    rows: list[dict[str, Any]] = []
    for index, skill in enumerate(meta.get("skilllist") or []):
        if not isinstance(skill, dict):
            continue
        blackboard_rows = [
            raw
            for raw in skill.get("blackboard") or []
            if isinstance(raw, dict) and _clean_text(raw.get("key"))
        ]
        if not blackboard_rows:
            continue
        rows.append(
            {
                "index": index,
                "skill_name": _clean_text(skill.get("skillName")) or f"weapon_skill_{index}",
                "keys": {_clean_text(raw.get("key")) for raw in blackboard_rows},
                "blackboard": blackboard_rows,
            }
        )
    return rows


def _weapon_values_match(expected: Any, observed: Any) -> bool:
    if isinstance(expected, (int, float)) and isinstance(observed, (int, float)):
        return math.isclose(float(expected), float(observed), rel_tol=1e-6, abs_tol=1e-6)
    return str(expected) == str(observed)


def _normalize_weapon_refine_index(index: int, option_count: int) -> int:
    if option_count <= 0:
        return index
    # Weapon static tables often expose 9 blackboard tiers while the user-facing
    # refine scale is 6 tiers. The leading tiers are server-side pre-offset slots,
    # so we collapse them back to the raw 0-based refine value used by upload/site.
    display_tier_count = 6
    offset = max(0, option_count - display_tier_count)
    normalized = index - offset
    if normalized < 0:
        return 0
    max_normalized = max(0, min(option_count, display_tier_count) - 1)
    return min(normalized, max_normalized)


def _coerce_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def infer_weapon_refine_from_source_skills(
    weapon_template: str,
    source_skills: list[dict[str, Any]] | None,
) -> int | None:
    skill_rows = _weapon_skill_blackboard_rows(weapon_template)
    if not skill_rows:
        return None

    source_rows: list[dict[str, Any]] = []
    for skill in source_skills or []:
        if not isinstance(skill, dict):
            continue
        blackboard = skill.get("blackboard")
        if not isinstance(blackboard, dict) or not blackboard:
            continue
        keys = {_clean_text(key) for key in blackboard.keys() if _clean_text(key)}
        if not keys:
            continue
        level = _coerce_int(skill.get("level")) or 0
        source_rows.append(
            {
                "keys": keys,
                "blackboard": blackboard,
                "level": level,
                "potential_lv": skill.get("potential_lv", skill.get("potentialLv")),
            }
        )
    if not source_rows:
        return None

    passive_row = max(skill_rows, key=lambda row: (len(row["keys"]), int(row["index"])))
    passive_keys = set(passive_row["keys"])
    best_source = max(
        source_rows,
        key=lambda row: (
            len(passive_keys & set(row["keys"])),
            len(set(row["keys"])),
            int(row["level"]),
        ),
    )
    if not (passive_keys & set(best_source["keys"])):
        return None

    max_option_count = max(
        len(_value_options(raw.get("value")))
        for raw in passive_row["blackboard"]
        if _value_options(raw.get("value"))
    )
    candidates: list[int] = []
    for refine in range(max_option_count):
        compared = 0
        mismatch = False
        for raw in passive_row["blackboard"]:
            key = _clean_text(raw.get("key"))
            if not key or key not in best_source["blackboard"]:
                continue
            expected = _select_option(_value_options(raw.get("value")), refine)
            observed = best_source["blackboard"].get(key)
            compared += 1
            if expected is None or not _weapon_values_match(expected, observed):
                mismatch = True
                break
        if compared and not mismatch:
            candidates.append(refine)

    hinted_refine = int(best_source["level"] - 1) if int(best_source["level"]) > 0 else None
    if len(candidates) == 1:
        return _normalize_weapon_refine_index(candidates[0], max_option_count)
    if hinted_refine is not None and hinted_refine in candidates:
        return _normalize_weapon_refine_index(hinted_refine, max_option_count)
    if hinted_refine is not None and 0 <= hinted_refine < max_option_count:
        return _normalize_weapon_refine_index(hinted_refine, max_option_count)
    if candidates:
        return _normalize_weapon_refine_index(candidates[0], max_option_count)
    return None


def format_weapon_refine_stats(weapon_template: str, refine: int) -> str:
    parts: list[str] = []
    for row in selected_weapon_blackboard(weapon_template, refine):
        key = _clean_text(row.get("key"))
        if not key:
            continue
        value = row.get("value")
        if isinstance(value, float):
            value_text = f"{value:.6g}"
        else:
            value_text = str(value)
        skill_name = _clean_text(row.get("skill_name"))
        parts.append(f"{skill_name}.{key}={value_text}@refine{refine}")
    return ";".join(parts)


def selected_equip_affixes(item_id: str, enhance: dict[int, int] | dict[Any, Any] | None) -> list[dict[str, Any]]:
    meta = equip_piece_catalog().get(str(item_id or ""), {})
    levels: dict[int, int] = {}
    for key, value in dict(enhance or {}).items():
        try:
            levels[int(key)] = int(value)
        except (TypeError, ValueError):
            continue
    rows: list[dict[str, Any]] = []
    for raw in meta.get("affixes") or []:
        if not isinstance(raw, dict):
            continue
        row = dict(raw)
        if row.get("kind") == "sub":
            index = int(row.get("index") or 0)
            level = levels.get(index + 1, levels.get(index))
            if level is None:
                level = _full_option_level(row.get("value_options") or [])
            row["level"] = level
            selected = _select_option(row.get("value_options") or [], level)
            if selected is not None:
                row["value"] = selected
                row["selected_value"] = selected
        rows.append(row)
    return rows


def format_equip_stats(item_id: str, enhance: dict[int, int] | dict[Any, Any] | None) -> str:
    parts: list[str] = []
    for row in selected_equip_affixes(item_id, enhance):
        desc = _clean_text(row.get("desc"))
        if not desc:
            continue
        value = row.get("value")
        if isinstance(value, float):
            value_text = f"{value:.6g}"
        else:
            value_text = str(value)
        kind = "main" if row.get("kind") == "main" else f"sub{int(row.get('index') or 0) + 1}"
        level = row.get("level")
        level_text = f"@{level}" if level is not None else ""
        parts.append(f"{kind}:{desc}={value_text}{level_text}")
    return ";".join(parts)


def normalize_gem_payload(gem: Any, inst_id: int, template_string: str = "") -> dict[str, Any]:
    terms: list[dict[str, int]] = []
    for term in getattr(gem, "terms", []) or []:
        terms.append(
            {
                "term_num_id": int(getattr(term, "term_num_id", 0) or 0),
                "cost": int(getattr(term, "cost", 0) or 0),
            }
        )
    gem_id = int(getattr(gem, "gem_id", 0) or 0) or int(inst_id or 0)
    return {
        "inst_id": int(inst_id or 0),
        "gem_id": gem_id,
        "template_id": int(getattr(gem, "template_id", 0) or 0),
        "template_string": template_string,
        "total_cost": int(getattr(gem, "total_cost", 0) or 0),
        "terms": terms,
        "weapon_id": int(getattr(gem, "weapon_id", 0) or 0),
        "domain_id": int(getattr(gem, "domain_id", 0) or 0),
    }


def format_gem_terms(gem_payload: dict[str, Any] | None) -> str:
    if not gem_payload:
        return ""
    attrs = attribute_type_catalog()
    terms = gem_payload.get("terms")
    if not isinstance(terms, list):
        return ""
    parts: list[str] = []
    for term in terms:
        if not isinstance(term, dict):
            continue
        try:
            term_id = int(term.get("term_num_id") or 0)
            cost = int(term.get("cost") or 0)
        except (TypeError, ValueError):
            continue
        attr = attrs.get(term_id, {})
        label = attr.get("slug") or attr.get("name") or f"attr_{term_id}"
        parts.append(f"{term_id}:{label}@cost{cost}")
    return ",".join(parts)
