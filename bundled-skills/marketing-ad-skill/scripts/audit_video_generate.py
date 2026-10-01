"""Static auditor for marketing-ad-skill video_generate calls.

Checks one MCP video_generate call (or a list of calls) against
references/storyboard-prompt-spec.md and references/adcraft-assets.md.

Usage:
  python audit_video_generate.py <call.json>
  python audit_video_generate.py --stdin < call.json
  echo '[{...}]' | python audit_video_generate.py --stdin

Exit code: 0 = all pass, 1 = any fail (for CI / pre-commit gating).
"""

import json
import re
import sys
from pathlib import Path


SPEC_RULES = [
    # (id, label, check_fn(call) -> (ok: bool, detail: str))
    ("S01", "mode ∈ {reference, keyframe, text}",
     lambda c: (
         c.get("mode") in ("reference", "keyframe", "text"),
         f"mode={c.get('mode')!r}")),
    ("S02", "seconds ∈ [4, 12] 且为整数",
     lambda c: (
         isinstance(c.get("seconds"), int) and 4 <= c["seconds"] <= 12,
         f"seconds={c.get('seconds')!r}")),
    ("S03", "reference mode 时 images[] 必传",
     lambda c: (
         c.get("mode") != "reference" or bool(c.get("images")),
         f"images={c.get('images')}")),
    ("S04", "images[] 长度 ≤ 5（agnes 上限）",
     lambda c: (
         len(c.get("images", [])) <= 5,
         f"len(images)={len(c.get('images', []))}")),
    ("S05", "images[] 单元素（harness dict 坑规避）",
     lambda c: (
         len(c.get("images", [])) <= 1,
         f"len(images)={len(c.get('images', []))}（多元素需 contact sheet 合成）")),
    ("S06", "reference mode 时 prompt 含 <Picture 1>",
     lambda c: _has_picture1(c.get("mode", ""), c.get("prompt", ""))),
    ("S07", "<Picture N> 连续编号（无跳号）",
     lambda c: _picture_no_gaps(c.get("prompt", ""))),
    ("S08", "<Picture N> 数量 = len(images) 或 ≤ len(images)",
     lambda c: _picture_count_matches_images(
         c.get("prompt", ""), c.get("images", []))),
    ("S09", "prompt 必含 'X秒' 文字驱动节奏（spec §3.3）",
     lambda c: _has_time_marker(c.get("prompt", ""))),
    ("S10", "prompt 禁逐句字幕/字幕叠加（不含禁令声明本身）",
     lambda c: _no_subtitle_keywords(c.get("prompt", ""))),
    ("S11", "prompt 必含场景锁定指令（防 #8 漂移）",
     lambda c: _has_scene_lock(c.get("prompt", ""))),
    ("S12", "prompt 禁价格字符 ¥/价格/￥/RMB（避免 AI 自动渲染价格字幕）",
     lambda c: _no_price_chars(c.get("prompt", ""))),
    ("S13", "keyframe mode 时 first_frame/last_frame 至少一个非空",
     lambda c: (
         c.get("mode") != "keyframe"
         or bool(c.get("first_frame")) or bool(c.get("last_frame")),
         f"first_frame={bool(c.get('first_frame'))} last_frame={bool(c.get('last_frame'))}")),
    ("S14", "aspect_ratio ∈ {16:9, 9:16, 1:1, 4:3, 3:4}",
     lambda c: (
         c.get("aspect_ratio") in ("16:9", "9:16", "1:1", "4:3", "3:4"),
         f"aspect_ratio={c.get('aspect_ratio')!r}")),
    ("S15", "size ∈ {720P, 1080P}",
     lambda c: (
         c.get("size") in ("720P", "1080P"),
         f"size={c.get('size')!r}")),
]


def _picture_no_gaps(prompt: str) -> tuple:
    """Check <Picture N> appears with N = 1..k consecutive."""
    nums = sorted(set(int(m) for m in
                      re.findall(r"<[Pp]icture\s+(\d+)>", prompt)))
    if not nums:
        return (True, "no <Picture N>（reference mode 不要求）")
    expected = list(range(1, max(nums) + 1))
    if nums == expected:
        return (True, f"<Picture 1..{max(nums)}> 连续")
    missing = set(expected) - set(nums)
    return (False, f"<Picture N> 跳号：缺失 {sorted(missing)}")


def _has_picture1(mode: str, prompt: str) -> tuple:
    if mode != "reference":
        return (True, f"mode={mode!r}（不要求）")
    if re.search(r"<[Pp]icture\s+1[\s>]", prompt):
        return (True, "含 <Picture 1>")
    return (False, "prompt 中未发现 <Picture 1>")


def _has_scene_lock(prompt: str) -> tuple:
    """spec §6.2 dim11 + adcraft-assets §2: prompt 必含场景锁定指令。
    三种合法写法任一：① 严格在 X 场景 ② 禁止场景漂移 ③ 全程锁定 X 场景
    """
    p = prompt
    if ("严格在" in p and "场景" in p) or "禁止场景漂移" in p:
        return (True, "含场景锁定指令")
    return (False, "缺场景锁定句（需含 '严格在 X 场景' 或 '禁止场景漂移'）")


def _picture_count_matches_images(prompt: str, images: list) -> tuple:
    """Spec §4.1: <Picture N> must align 1:1 with images[] in order."""
    nums = sorted(set(int(m) for m in
                      re.findall(r"<[Pp]icture\s+(\d+)>", prompt)))
    if not nums:
        return (True, "no <Picture N>")
    n_pic = max(nums)
    n_img = len(images)
    if n_pic == n_img:
        return (True, f"{n_pic} 张图与 {n_img} 个 <Picture N> 对齐")
    return (False, f"<Picture> 数={n_pic} ≠ len(images)={n_img}")


def _has_time_marker(prompt: str) -> tuple:
    """spec §3.3: X秒 文字驱动节奏"""
    matches = re.findall(r"(\d+)\s*秒", prompt)
    if not matches:
        return (False, "无 'X秒' 文字标记")
    seconds = [int(m) for m in matches]
    if all(1 <= s <= 4 for s in seconds):
        return (True, f"节奏点: {seconds}（均 ≤4s · 合规）")
    bad = [s for s in seconds if s > 4]
    return (False, f"节奏点含 {bad}（>4s · 违反 spec §2.1）")


def _no_subtitle_keywords(prompt: str) -> tuple:
    """v9 决策铁律：prompt 禁写让 AI 渲染字幕的关键词。
    例外：禁令声明本身（'严禁字幕' / '禁止字幕' / 'no subtitle'）不算违规——
    正是为了阻止 AI 生成字幕才写的。
    """
    # 先剥掉禁令声明句子再扫描
    stripped = re.sub(
        r"(严禁|禁止|不得|不要|不要在|不允许)[^,。\n]{0,15}(字幕|屏幕文字|字幕框|字幕叠加)",
        "", prompt)
    stripped = re.sub(
        r"(no|without|don'?t|never)[^,。\n]{0,15}(subtitle|caption|lower-third|on-screen text)",
        "", stripped, flags=re.IGNORECASE)
    bad = re.findall(
        r"(MANDATORY BOTTOM SUBTITLE|字幕(?:叠加)?|屏幕文字|字幕框|lower-third|口播逐字)",
        stripped, re.IGNORECASE)
    if bad:
        return (False, f"命中字幕关键词: {bad}")
    return (True, "无字幕关键词（含合规禁令声明）")


def _no_price_chars(prompt: str) -> tuple:
    """ugc-ref §13.1: ¥/价格/￥/RMB 字符会触发 AI 自动渲染"""
    bad = re.findall(r"(¥|￥|\bRMB\b|\b价格\b|\b价格对比\b)", prompt)
    if bad:
        return (False, f"命中价格字符: {bad}")
    return (True, "无价格字符")


def audit_call(call: dict) -> dict:
    """Audit a single MCP call dict, return per-rule results."""
    results = []
    for rid, label, fn in SPEC_RULES:
        try:
            ok, detail = fn(call)
        except Exception as e:
            ok, detail = False, f"check error: {e}"
        results.append({"id": rid, "label": label, "ok": ok, "detail": detail})
    n_pass = sum(1 for r in results if r["ok"])
    return {
        "call_label": call.get("label") or call.get("segment_id") or "<unnamed>",
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
        print("usage: audit_video_generate.py <file.json> | --stdin", file=sys.stderr)
        sys.exit(2)

    if isinstance(data, dict):
        calls = data.get("calls") or data.get("video_generate_calls") or [data]
    else:
        calls = data

    print(f"\n=== marketing-ad-skill video_generate 静态审计 ===")
    print(f"检查 {len(calls)} 个调用 × {len(SPEC_RULES)} 项 spec 规则\n")

    overall_pass = 0
    overall_total = 0
    for call in calls:
        report = audit_call(call)
        overall_pass += report["passed"]
        overall_total += report["total"]
        status = "✓" if report["passed"] == report["total"] else "✗"
        print(f"[{status}] {report['call_label']} — {report['pass_rate']}")
        for r in report["results"]:
            mark = "  ✓" if r["ok"] else "  ✗"
            print(f"{mark} {r['id']} {r['label']}: {r['detail']}")
        print()

    pct = 100 * overall_pass / max(overall_total, 1)
    print(f"=== 总览：{overall_pass}/{overall_total} = {pct:.1f}% ===")

    sys.exit(0 if overall_pass == overall_total else 1)


if __name__ == "__main__":
    main()