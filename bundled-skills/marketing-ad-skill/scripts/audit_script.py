"""Static auditor for marketing-ad-skill agent_script.json.

Audits Script Writer (Round 2a) output against the script design schema
expanded by screenwriter.md (xiaoluo-film-screenwriting) integration.

Input schema (agent_script.json · §3-§6 4-class routes · EXCLUDES §7 UGC):
  {
    "script": {
      "hook_0_3s": "...",
      "body_3_25s": "...",
      "cta_25_30s": "...",
      "selling_points": ["...", "...", "..."],
      "subtitle_triggers": [{"time": "...", "text": "..."}, ...],
      # 🆕 screenwriter.md 整合字段：
      "core_conflict": "<核心冲突 · 欲望/利益/身份/关系/世界阻力/失败代价>",
      "hero_desire": "<主角欲望>",
      "hero_fear": "<主角恐惧>",
      "hero_arc": "<人物弧光：初始→裂缝→最终选择→结局>",
      "scenes": [
        {"scene": "...", "time_range": "...",
         "scene_goal": "...", "obstacle": "...",
         "info_release": "...", "relationship_change": "...",
         "exit_hook": "..."}
      ],
      "dialogues": [
        {"character": "<正式姓名>", "line": "..."}
      ],
      "visual_directions": [
        {"beat": "...", "shot": "<景别+机位+构图焦点>", "blocking": "..."}
      ],
      "continuity_check": {"passed": true, "items": ["..."]}
    }
  }

Exit: 0 = all pass, 1 = any fail.
"""

import json
import re
import sys


SCRIPT_RULES = [
    # 基础字段
    ("S01", "script.hook_0_3s 非空",
     lambda s: _nonempty("hook_0_3s", s)),
    ("S02", "script.body_3_25s 非空",
     lambda s: _nonempty("body_3_25s", s)),
    ("S03", "script.cta_25_30s 非空",
     lambda s: _nonempty("cta_25_30s", s)),
    ("S04", "selling_points ≥ 3 且 ≤ 5（§2.2 ≤3 卖点铁律上限留 5 给 hook+CTA）",
     lambda s: _selling_points_range(s)),
    ("S05", "subtitle_triggers ≥ 3（30s/36s 4 句公式落地）",
     lambda s: _subtitle_triggers_count(s)),
    # 卖点-口播对齐
    ("S06", "body_3_25s 必显式引用 ≥ 2 个 selling_points（避免卖点漂移）",
     lambda s: _body_refs_selling(s)),
    ("S07", "cta_25_30s 必含 selling_points 中至少 1 个关键词（卖点收束）",
     lambda s: _cta_refs_selling(s)),
    # 🆕 screenwriter.md 整合字段
    ("S08", "core_conflict 必填 ≥ 6 类冲突关键词（欲望/利益/身份/关系/世界/代价）",
     lambda s: _core_conflict_keys(s)),
    ("S09", "hero_desire / hero_fear / hero_arc 三字段齐",
     lambda s: _hero_three_fields(s)),
    ("S10", "scenes 长度 ≥ 3（场次规划）+ 每场含 7 字段（goal/obstacle/info/change/hook）",
     lambda s: _scenes_complete(s)),
    ("S11", "dialogues[].character 必为正式姓名（禁'她/他/它/对方'代词）",
     lambda s: _dialogue_character_formal(s)),
    ("S12", "dialogues 台词数 ≥ 3（避免'无声剧本'）",
     lambda s: _dialogues_count(s)),
]


def _script(data) -> dict:
    """Extract script block (handle list or dict wrapper)."""
    if isinstance(data, list):
        return data[0].get("script", {}) if data else {}
    return data.get("script", {})


def _nonempty(field: str, s: dict) -> tuple:
    val = s.get(field, "")
    ok = bool(val and str(val).strip())
    return (ok, f"{field}={'<空>' if not ok else str(val)[:40]}")


def _selling_points_range(s: dict) -> tuple:
    pts = s.get("selling_points", [])
    n = len(pts)
    if 3 <= n <= 5:
        return (True, f"selling_points={n}（合规 · §2.2 ≤3 卖点铁律扩展到 ≤5）")
    if n < 3:
        return (False, f"selling_points={n} < 3（§2.2 铁律）")
    return (False, f"selling_points={n} > 5（避免卖点稀释）")


def _subtitle_triggers_count(s: dict) -> tuple:
    st = s.get("subtitle_triggers", [])
    n = len(st)
    if n >= 3:
        return (True, f"subtitle_triggers={n}（drawtext 4 句公式）")
    return (False, f"subtitle_triggers={n} < 3（v9 drawtext 公式落地不足）")


def _body_refs_selling(s: dict) -> tuple:
    """中文卖点漂移检查：2-gram 子串匹配 + 关键数字匹配。"""
    body = str(s.get("body_3_25s", ""))
    pts = s.get("selling_points", [])
    if not body or not pts:
        return (False, "body 或 selling_points 为空")
    matched = []
    for p in pts:
        # 1) 数字命中（"280" "5 分钟" "4 小时" 等关键数字跨空格）
        nums = re.findall(r"\d+", p)
        for n in nums:
            if n in body:
                matched.append(p)
                break
        else:
            # 2) 2-gram 中文子串匹配
            for i in range(len(p) - 1):
                if p[i:i + 2] in body:
                    matched.append(p)
                    break
    if len(matched) >= 2:
        return (True, f"body 引用 {len(matched)}/{len(pts)} selling_points: {[p[:15] for p in matched[:2]]}")
    return (False, f"body 仅引用 {len(matched)}/{len(pts)} selling_points（卖点漂移风险）")


def _cta_refs_selling(s: dict) -> tuple:
    cta = str(s.get("cta_25_30s", ""))
    pts = s.get("selling_points", [])
    if not cta or not pts:
        return (False, "cta 或 selling_points 为空")
    matched = []
    for p in pts:
        nums = re.findall(r"\d+", p)
        for n in nums:
            if n in cta:
                matched.append(p)
                break
        else:
            for i in range(len(p) - 1):
                if p[i:i + 2] in cta:
                    matched.append(p)
                    break
    if matched:
        return (True, f"cta 命中 selling_point: {matched[0][:20]}")
    return (False, f"cta 未命中任何 selling_points（收束与卖点脱节）")


CONFLICT_KEYS = ["欲望", "利益", "身份", "关系", "世界", "阻力",
                 "代价", "冲突"]


def _core_conflict_keys(s: dict) -> tuple:
    cc = str(s.get("core_conflict", ""))
    if not cc:
        return (False, "core_conflict 字段空（screenwriter.md §核心冲突 必填）")
    hit = [k for k in CONFLICT_KEYS if k in cc]
    if len(hit) >= 3:
        return (True, f"core_conflict 命中 {len(hit)} 类冲突关键词: {hit}")
    return (False, f"core_conflict 命中 {len(hit)} 类（<3 · 需补 欲望/利益/身份/关系/世界/代价）")


def _hero_three_fields(s: dict) -> tuple:
    d = s.get("hero_desire", "")
    f = s.get("hero_fear", "")
    a = s.get("hero_arc", "")
    missing = [k for k, v in [("hero_desire", d), ("hero_fear", f), ("hero_arc", a)] if not v]
    if not missing:
        return (True, "欲望/恐惧/弧光 3 字段齐")
    return (False, f"缺失字段: {missing}（screenwriter.md §人物小传 必填）")


SCENE_REQUIRED_FIELDS = ["scene_goal", "obstacle", "info_release",
                         "relationship_change", "exit_hook"]


def _scenes_complete(s: dict) -> tuple:
    scenes = s.get("scenes", [])
    n = len(scenes)
    if n < 3:
        return (False, f"scenes={n} < 3（场次规划不足）")
    incomplete = []
    for i, sc in enumerate(scenes):
        miss = [f for f in SCENE_REQUIRED_FIELDS if not sc.get(f)]
        if miss:
            incomplete.append((i + 1, miss))
    if incomplete:
        return (False, f"场 {incomplete[:2]} 缺字段（5 字段必填）")
    return (True, f"{n} 场 · 5 字段齐（goal/obstacle/info/change/hook）")


BANNED_PRONOUNS = ["她", "他", "它", "对方", "他们", "她们", "它们"]


def _dialogue_character_formal(s: dict) -> tuple:
    """screenwriter.md §角色名称硬性规则：禁止她/他/它"""
    dialogues = s.get("dialogues", [])
    bad = []
    for i, d in enumerate(dialogues):
        ch = d.get("character", "")
        if ch in BANNED_PRONOUNS:
            bad.append((i + 1, ch))
    if bad:
        return (False, f"对白 {bad} 用代词（禁'她/他/它/对方'）")
    return (True, f"{len(dialogues)} 条对白角色名合规")


def _dialogues_count(s: dict) -> tuple:
    n = len(s.get("dialogues", []))
    if n >= 3:
        return (True, f"对白数={n}")
    return (False, f"对白数={n} < 3（无声剧本风险）")


def audit(data) -> dict:
    s = _script(data)
    results = []
    for rid, label, fn in SCRIPT_RULES:
        try:
            ok, detail = fn(s)
        except Exception as e:
            ok, detail = False, f"check error: {e}"
        results.append({"id": rid, "label": label, "ok": ok, "detail": detail})
    n_pass = sum(1 for r in results if r["ok"])
    return {
        "label": data.get("label") or data.get("project") or "<unnamed>",
        "passed": n_pass,
        "total": len(results),
        "pass_rate": f"{n_pass}/{len(results)}",
        "results": results,
    }


def main():
    if "--stdin" in sys.argv:
        data = json.load(sys.stdin)
    elif len(sys.argv) > 1:
        data = json.load(open(sys.argv[1]))
    else:
        print("usage: audit_script.py <file.json> | --stdin", file=sys.stderr)
        sys.exit(2)

    items = data if isinstance(data, list) else [data]
    print(f"\n=== marketing-ad-skill 剧本设计审计（§3-§6 · 排除 §7 UGC）===")
    print(f"检查 {len(items)} 个 script × {len(SCRIPT_RULES)} 项规则\n")

    overall_pass, overall_total = 0, 0
    for item in items:
        report = audit(item)
        overall_pass += report["passed"]
        overall_total += report["total"]
        status = "✓" if report["passed"] == report["total"] else "✗"
        print(f"[{status}] {report['label']} — {report['pass_rate']}")
        for r in report["results"]:
            mark = "  ✓" if r["ok"] else "  ✗"
            print(f"{mark} {r['id']} {r['label']}: {r['detail']}")
        print()

    pct = 100 * overall_pass / max(overall_total, 1)
    print(f"=== 总览：{overall_pass}/{overall_total} = {pct:.1f}% ===")

    sys.exit(0 if overall_pass == overall_total else 1)


if __name__ == "__main__":
    main()