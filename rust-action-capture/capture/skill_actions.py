"""Cast classification from the complete skill table, never from cast counts."""
import csv
import json
from pathlib import Path
import re


class ActionRules:
    def __init__(self, skills):
        attacks, stages = {}, {}
        for skill in set(skills):
            match = re.fullmatch(r"(chr_.+)_attack_?(\d+)", skill)
            if match and not match[1].endswith(("_power", "_plunging", "_heavy")):
                attacks.setdefault(match[1], []).append((int(match[2]), skill))
            match = re.fullmatch(r"(chr_.+_(?:normal_skill|normalskill))(?:_(\d+))?", skill)
            if match:
                stages.setdefault(match[1], []).append((int(match[2] or 0), skill))
        self.finishers = {max(rows)[1] for rows in attacks.values()}
        self.stages = {skill: "战技" + ("" if n == 1 else self.roman(n))
                       for rows in stages.values()
                       for n, (_, skill) in enumerate(sorted(rows), 1)}

    @staticmethod
    def roman(n):
        return "I" * n if n < 4 else {4: "IV", 5: "V", 6: "VI"}.get(n, str(n))

    def classify(self, skill):
        skill = skill.lower()
        if not skill or "ai" in skill.split("_"):
            return None
        if skill.endswith("_dodge") or skill.endswith("_dash") and skill.startswith("chr_"):
            return "闪避"
        if skill.startswith("common_"):
            return None
        if skill in self.finishers:
            return "重击"
        if re.search(r"_(?:power_attack|execution|execute|finisher)\d*$", skill):
            return "处决"
        if skill in self.stages:
            return self.stages[skill]
        if "normal_skill" in skill or "normalskill" in skill:
            return "战技"
        if "ultimate" in skill:
            return "大招"
        if "combo" in skill:
            return "连携"
        if "attack" in skill:
            return None
        return "其他"


def write_maps(core: Path, output: Path):
    source = core / "data/local_tables/NumIdStrTable.json"
    skills = json.loads(source.read_text(encoding="utf-8"))["skill_id"]["dic"]
    rules = ActionRules(skills.values())
    output.mkdir(parents=True, exist_ok=True)
    metadata = {
        "source": "core/data/local_tables/NumIdStrTable.json",
        "date": "2026-10-28",
        "rules": {"note": "always empty", "dodge": "opt-in; AI always excluded",
                  "common": "excluded except manual dodge", "attack": "only final numbered segment = 重击",
                  "power_attack": "处决 (CharacterPowerAttack); pending live execution confirmation",
                  "control": "heavy attacks and dodges require known current leader; updated from SC_CHAR_BAG_SET_TEAM_LEADER",
                  "stages": "ordered exact skill variants, not cast counts"},
        "heavy_attack_skills": sorted(rules.finishers),
        "battle_skill_stages": dict(sorted(rules.stages.items())),
    }
    (output / "action_metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (output / "skill_actions.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["numeric_id", "skill_id", "action"])
        for numeric, skill in sorted(skills.items(), key=lambda row: int(row[0])):
            if skill.startswith(("chr_", "common_")):
                writer.writerow([numeric, skill, rules.classify(skill) or ""])
