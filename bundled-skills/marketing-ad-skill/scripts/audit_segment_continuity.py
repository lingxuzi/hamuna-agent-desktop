"""Static auditor for cross-segment continuity in marketing-ad-skill.

Audits agent_video_direction.json against the 4 cross-segment continuity
anchors defined in video-direction.md §三 + storyboard-prompt-spec.md
§3.3.1 + adcraft-assets.md §2 (scene lock).

Input schema (round_3_5_output):
  {
    "directions": [
      {"idx": 1, "duration_seconds": 12, "opening_state": "...",
       "primary_action": "...", "closing_state": "...",
       "subject_action": "...", "camera_motion": "...",
       "framing": "...", "transition_intent": "..."},
      ...  # length = N
    ],
    "continuity_handoffs": [
      {"from_segment": 1, "to_segment": 2, "anchor": "..."},
      ...  # length = N - 1
    ]
  }

OR pass a list of [round_3_5_output_dicts] for batch audit.

Exit: 0 = all pass, 1 = any fail.
"""

import json
import re
import sys


CONTINUITY_RULES = [
    ("C01", "directions[].duration_seconds == 12",
     lambda d: _all_durations_12(d)),
    ("C02", "directions 长度 ≥ 2（≥2 段才有连续性问题）",
     lambda d: _directions_len_ge2(d)),
    ("C03", "continuity_handoffs 长度 = directions 长度 - 1",
     lambda d: _handoffs_match(d)),
    ("C04", "continuity_handoffs[].from_segment / to_segment 严格相邻",
     lambda d: _handoffs_consecutive(d)),
    ("C05", "continuity_handoffs[].anchor 必含 服装/道具/光线 锚点词",
     lambda d: _handoff_anchor_kind(d)),
    ("C06", "每段 opening_state 必显式承接上段 closing_state",
     lambda d: _opening_references_prev_closing(d)),
    ("C07", "每段 closing_state 必为可作下段 first_frame 的定格描述",
     lambda d: _closing_is_static_frame(d)),
    ("C08", "每段 prompt 必含场景锁定指令（防 #8 漂移）",
     lambda d: _scene_lock_each_dir(d)),
    ("C09", "跨段服装锚点一致性（同套装不漂移）",
     lambda d: _wardrobe_continuity(d)),
    ("C10", "跨段光线锚点一致性（同场景不漂移）",
     lambda d: _lighting_continuity(d)),
]


def _dirs(data) -> list:
    if isinstance(data, list):
        item = data[0] if data else {}
    else:
        item = data
    # 兼容：顶层 directions 或 video_direction.directions
    if "directions" in item:
        return item.get("directions", [])
    vd = item.get("video_direction", {})
    return vd.get("directions", [])


def _handoffs(data) -> list:
    if isinstance(data, list):
        item = data[0] if data else {}
    else:
        item = data
    if "continuity_handoffs" in item:
        return item.get("continuity_handoffs", [])
    vd = item.get("video_direction", {})
    return vd.get("continuity_handoffs", [])


def _all_durations_12(data) -> tuple:
    ds = _dirs(data)
    bad = [(i + 1, d.get("duration_seconds"))
           for i, d in enumerate(ds)
           if d.get("duration_seconds") != 12]
    if bad:
        return (False, f"非 12s 段: {bad}")
    return (True, f"全部 {len(ds)} 段 = 12s")


def _directions_len_ge2(data) -> tuple:
    n = len(_dirs(data))
    return (n >= 2, f"directions 长度={n}（<2 段无连续性问题）")


def _handoffs_match(data) -> tuple:
    ds, hs = _dirs(data), _handoffs(data)
    n, m = len(ds), len(hs)
    if n == 0:
        return (True, "无方向段（不要求）")
    expected = n - 1
    if m == expected:
        return (True, f"handoffs 长度 {m} = {n}-1")
    return (False, f"handoffs={m} ≠ directions-1={expected}")


def _handoffs_consecutive(data) -> tuple:
    hs = _handoffs(data)
    bad = [(i + 1, h) for i, h in enumerate(hs)
           if h.get("to_segment") != h.get("from_segment", 0) + 1
           or h.get("from_segment") != i + 1]
    if bad:
        return (False, f"非相邻锚点: {bad[:3]}")
    return (True, f"{len(hs)} 个 handoff 严格相邻 (i→i+1)")


ANCHOR_KINDS = ["服装", "光线", "道具", "场景", "妆造", "光线方向", "布光", "光源"]


def _handoff_anchor_kind(data) -> tuple:
    hs = _handoffs(data)
    if not hs:
        return (True, "无 handoff")
    missing = []
    for i, h in enumerate(hs):
        anchor = h.get("anchor", "")
        if not any(k in anchor for k in ANCHOR_KINDS):
            missing.append((i + 1, anchor))
    if missing:
        return (False, f"锚点未含 {ANCHOR_KINDS[:3]}...: {missing}")
    return (True, f"{len(hs)} 锚点均含 服装/光线/道具/场景 关键词")


PREV_REF_PHRASES = ["承接", "延续", "上段", "上一段", "从", "接续",
                   "continuing", "carrying over"]


def _opening_references_prev_closing(data) -> tuple:
    ds = _dirs(data)
    if len(ds) < 2:
        return (True, "<2 段不要求")
    bad = []
    for i in range(1, len(ds)):
        op = ds[i].get("opening_state", "")
        if not any(p in op for p in PREV_REF_PHRASES):
            bad.append((i + 1, op[:30]))
    if bad:
        return (False, f"段 {bad} 段首未承接上段（缺'承接/延续/上段'）")
    return (True, f"全部 {len(ds)-1} 个段首显式承接")


STATIC_HINTS = ["定格", "居中", "特写", "静止", "呆", "凝视", "满帧",
                "hero shot", "static", "hold"]


def _closing_is_static_frame(data) -> tuple:
    ds = _dirs(data)
    bad = []
    for i, d in enumerate(ds):
        cs = d.get("closing_state", "")
        if not any(h in cs for h in STATIC_HINTS):
            bad.append((i + 1, cs[:30]))
    if bad:
        return (False, f"段 {bad} 末帧非定格（缺'定格/居中/特写/hero shot'）")
    return (True, f"全部 {len(ds)} 末帧为定格可锚定")


def _scene_lock_each_dir(data) -> tuple:
    ds = _dirs(data)
    bad = []
    for i, d in enumerate(ds):
        text = " ".join(str(d.get(k, "")) for k in
                        ("opening_state", "primary_action", "closing_state"))
        if not (("严格在" in text and "场景" in text)
                or "禁止场景漂移" in text
                or "全程锁定" in text
                or "scene lock" in text.lower()):
            bad.append((i + 1, "缺场景锁定"))
    if bad:
        return (False, f"段 {bad} 缺场景锁定指令")
    return (True, f"全部 {len(ds)} 段含场景锁定")


WARDROBE_BANNED_DRIFT = ["换装", "换衣", "换造型", "脱掉", "脱下",
                        "wardrobe change", "outfit change"]


def _wardrobe_continuity(data) -> tuple:
    """跨段非 wardrobe_change 场景不应出现换装关键词"""
    ds = _dirs(data)
    bad = []
    for i in range(1, len(ds)):
        ti = " ".join(str(ds[i].get(k, "")) for k in
                      ("opening_state", "primary_action", "closing_state"))
        if any(w in ti for w in WARDROBE_BANNED_DRIFT):
            bad.append((i + 1, ti[:30]))
    if bad:
        return (False, f"段 {bad} 非切换场景出现换装（应声明 wardrobe_change）")
    return (True, f"跨段服装锁定（无漂移）")


LIGHTING_DRIFT = ["中午阳光", "morning sunlight", "正午", "窗光",
                  "window light", "突然变暗", "light suddenly"]


def _lighting_continuity(data) -> tuple:
    """相邻段光线方向不应突然漂移"""
    ds = _dirs(data)
    bad = []
    for i in range(1, len(ds)):
        ti = ds[i].get("opening_state", "") + ds[i].get("primary_action", "")
        if any(L in ti for L in LIGHTING_DRIFT):
            bad.append((i + 1, ti[:30]))
    if bad:
        return (False, f"段 {bad} 光线漂移（命中禁止关键词 {LIGHTING_DRIFT[:3]}）")
    return (True, f"跨段光线锁定（无漂移）")


def audit(data) -> dict:
    results = []
    for rid, label, fn in CONTINUITY_RULES:
        try:
            ok, detail = fn(data)
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
        print("usage: audit_segment_continuity.py <file.json> | --stdin",
              file=sys.stderr)
        sys.exit(2)

    items = data if isinstance(data, list) else [data]

    print(f"\n=== marketing-ad-skill 跨段连续性审计 ===")
    print(f"检查 {len(items)} 个 video_direction × {len(CONTINUITY_RULES)} 项规则\n")

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