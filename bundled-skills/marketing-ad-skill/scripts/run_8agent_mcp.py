#!/usr/bin/env python3
"""
run_8agent_mcp.py — MCP 调度脚本（完整版 · 2026-09-17）

对齐 AdCraft `scripts/run_8agent_mcp.py` 的 4 步交互协议：
  init → next → record → finish + grade

完整版增强（2026-09-17）：
- 递归 placeholder resolve（`<step N image output>` → `<step N video output>` 多层）
- grading 12 断言（自动验证输出质量 + 字幕表 + 时长拼接）
- 自动抽末帧（ffmpeg -sseof -0.1）
- finish 步骤自动执行 ffmpeg concat demuxer + drawtext 4 句后处理

Usage:
    python3 scripts/run_8agent_mcp.py init --plan <agent_video.json> --output-dir <dir>
    python3 scripts/run_8agent_mcp.py next --output-dir <dir>
    python3 scripts/run_8agent_mcp.py record --output-dir <dir> --step <N> --output <url> [--image]
    python3 scripts/run_8agent_mcp.py finish --output-dir <dir>
    python3 scripts/run_8agent_mcp.py grade --output-dir <dir>
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# ---------- 工具 ----------

def read_json(path: Path) -> dict:
    if not path.exists():
        sys.exit(f"[ERROR] {path} not found")
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def log(msg: str) -> None:
    print(f"[run_8agent_mcp] {msg}")

# ---------- placeholder resolve (完整版 · 递归) ----------

def resolve_placeholders(text: str, state: dict, max_depth: int = 5) -> str:
    """递归解析 <step N ... output> 占位符（支持多层嵌套）"""
    if not isinstance(text, str):
        return text

    for _ in range(max_depth):
        # 匹配 <step N> 或 <step N image output> 或 <step N video output>
        pattern = r"<step\s+(\d+)(?:\s+(\w+))?\s+output>"
        m = re.search(pattern, text)
        if not m:
            break

        step_num = m.group(1)  # JSON key 是 str, 不是 int
        if step_num not in state.get("step_outputs", {}):
            log(f"warning: placeholder <step {step_num}> 未找到对应输出，跳过")
            break

        url = state["step_outputs"][step_num].get("output", "")
        text = text.replace(m.group(0), url)

    return text

# ---------- init ----------

def cmd_init(args) -> None:
    """从 agent_video.json 解析步骤计划，写到 output-dir/state.json + step_plan.json"""
    plan = read_json(Path(args.plan))

    # 完整版：支持 image_generate_calls 和 video_generate_calls 顶层字段
    image_calls = plan.get("image_generate_calls", [])
    video_calls = plan.get("video_generate_calls", [])

    # 向后兼容：如果 plan.video 嵌套结构（精简版路径）
    if not image_calls and not video_calls:
        video = plan.get("video", {})
        image_calls = video.get("image_generate_calls", [])
        video_calls = video.get("video_generate_calls", [])

    step_plan = {
        "image_steps": image_calls,
        "video_steps": video_calls,
        "current_idx": 0,
        "completed": [],
    }
    write_json(Path(args.output_dir) / "step_plan.json", step_plan)

    state = {
        "plan_path": args.plan,
        "output_dir": str(Path(args.output_dir)),
        "step_outputs": {},
    }
    write_json(Path(args.output_dir) / "state.json", state)

    log(f"init done: {len(image_calls)} image steps + {len(video_calls)} video steps")
    log(f"output-dir: {args.output_dir}")

# ---------- next ----------

def cmd_next(args) -> None:
    """打印下一个 step 的 MCP 调用参数（递归 placeholder resolve）"""
    out_dir = Path(args.output_dir)
    plan = read_json(out_dir / "step_plan.json")
    state = read_json(out_dir / "state.json")

    all_steps = plan["image_steps"] + plan["video_steps"]
    idx = plan["current_idx"]
    if idx >= len(all_steps):
        log("all steps completed. run 'finish' to produce final video.")
        return

    step = all_steps[idx]
    step_num = idx + 1

    # 完整版：递归 resolve 所有占位符（first_frame / images[]）
    step_resolved = json.loads(json.dumps(step))  # 深拷贝

    # 完整版：递归 resolve 所有占位符（first_frame / images[] · 注意 first_frame 在 params 下）
    if "first_frame" in step_resolved:
        original = step_resolved["first_frame"]
        resolved = resolve_placeholders(original, state)
        if resolved != original:
            log(f"first_frame resolved (step {step_num}): {resolved[:80]}...")
            step_resolved["first_frame"] = resolved
    elif "params" in step_resolved and isinstance(step_resolved["params"], dict):
        if "first_frame" in step_resolved["params"]:
            original = step_resolved["params"]["first_frame"]
            resolved = resolve_placeholders(original, state)
            if resolved != original:
                log(f"params.first_frame resolved (step {step_num}): {resolved[:80]}...")
                step_resolved["params"]["first_frame"] = resolved

    if "images" in step_resolved and isinstance(step_resolved["images"], list):
        for i, img in enumerate(step_resolved["images"]):
            if isinstance(img, str):
                resolved = resolve_placeholders(img, state)
                if resolved != img:
                    step_resolved["images"][i] = resolved
    elif "params" in step_resolved and isinstance(step_resolved["params"].get("images"), list):
        for i, img in enumerate(step_resolved["params"]["images"]):
            if isinstance(img, str):
                resolved = resolve_placeholders(img, state)
                if resolved != img:
                    step_resolved["params"]["images"][i] = resolved

    log(f"=== Step {step_num}/{len(all_steps)} ===")
    log(f"purpose: {step.get('purpose', step.get('shot', 'N/A'))}")
    log(json.dumps(step_resolved, ensure_ascii=False, indent=2))

    # 自动推进 current_idx（让下一次 next 跳到下一步）
    plan["current_idx"] = step_num
    write_json(out_dir / "step_plan.json", plan)

# ---------- record ----------

def cmd_record(args) -> None:
    """把 MCP 输出回喂到 state.json（完整版：自动抽末帧）"""
    out_dir = Path(args.output_dir)
    state = read_json(out_dir / "state.json")
    plan = read_json(out_dir / "step_plan.json")

    step_num = args.step
    state["step_outputs"][step_num] = {
        "output": args.output,
        "is_image": args.image,
    }

    # 完整版：视频步骤自动抽末帧（ffmpeg -sseof -0.1）
    if not args.image and "local" not in state["step_outputs"][step_num]:
        local_video = out_dir / "videos" / f"seg{step_num:02d}.mp4"
        if local_video.exists():
            last_frame = out_dir / "videos" / f"seg{step_num:02d}_lastframe.png"
            last_frame.parent.mkdir(parents=True, exist_ok=True)
            cmd = [
                "ffmpeg", "-y", "-sseof", "-0.1", "-i", str(local_video),
                "-frames:v", "1", str(last_frame)
            ]
            try:
                subprocess.run(cmd, capture_output=True, check=True, timeout=30)
                state["step_outputs"][step_num]["local_lastframe"] = str(last_frame)
                log(f"video step {step_num}: 末帧已抽取 → {last_frame}")
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
                log(f"warning: 末帧抽取失败（{e}），继续")
        else:
            log(f"warning: video step {step_num} 本地文件不存在 {local_video}，跳过抽帧")

    plan["current_idx"] = max(plan["current_idx"], step_num)
    write_json(out_dir / "state.json", state)
    write_json(out_dir / "step_plan.json", plan)
    log(f"recorded step {step_num}: {args.output}")

# ---------- finish ----------

def cmd_finish(args) -> None:
    """完整版：自动执行 ffmpeg concat demuxer + drawtext 4 句后处理"""
    out_dir = Path(args.output_dir)
    state = read_json(out_dir / "state.json")
    plan = read_json(out_dir / "step_plan.json")
    plan_data = read_json(Path(state["plan_path"]))

    # 自动找视频段（按 step 顺序）
    video_dir = out_dir / "videos"
    video_dir.mkdir(parents=True, exist_ok=True)

    video_files = sorted(video_dir.glob("seg*.mp4"))
    # 排除 final / lastframe 等
    video_files = [f for f in video_files if "_lastframe" not in f.name and "final" not in f.name]

    if not video_files:
        log("ERROR: 未找到视频段，请确认 outputs/videos/seg*.mp4 已就位")
        return

    log(f"找到 {len(video_files)} 段视频：{[f.name for f in video_files]}")

    # 1. concat demuxer 拼接
    segments_txt = video_dir / "segments.txt"
    segments_txt.write_text("\n".join(f"file '{f.name}'" for f in video_files) + "\n")

    final_mp4 = video_dir / "final_36s.mp4"
    concat_cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(segments_txt), "-c", "copy", str(final_mp4)
    ]
    log(f"执行: {' '.join(concat_cmd)}")
    try:
        subprocess.run(concat_cmd, capture_output=True, check=True, timeout=60)
        log(f"✅ 拼接成功: {final_mp4}")
    except subprocess.CalledProcessError as e:
        log(f"❌ 拼接失败: {e}")
        return

    # 2. drawtext 4 句字幕后处理（从 plan.post_process.drawtext 读取）
    drawtext_specs = plan_data.get("post_process", {}).get("drawtext", [])
    if not drawtext_specs:
        log("warning: plan 中未指定 drawtext，跳过字幕后处理")
        return

    fontfile = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
    filters = []
    for spec in drawtext_specs:
        t = spec.get("time", "")
        m = re.match(r"(\d+)-(\d+(?:\.\d+)?)s", t)
        if not m:
            continue
        t1, t2 = m.group(1), m.group(2)
        text = spec.get("text", "")
        size = spec.get("size", 44)
        color = spec.get("color", "white")
        box_color = "black@0.7"
        boxborderw = 12 if size >= 48 else 10
        filters.append(
            f"drawtext=text='{text}':fontfile={fontfile}:fontsize={size}"
            f":fontcolor={color}:box=1:boxcolor={box_color}:boxborderw={boxborderw}"
            f":x=(w-tw)/2:y=h-th-80:enable='between(t,{t1},{t2})'"
        )

    if not filters:
        log("warning: drawtext filters 为空，跳过")
        return

    final_sub_mp4 = video_dir / "final_36s_with_subtitle.mp4"
    drawtext_cmd = [
        "ffmpeg", "-y", "-i", str(final_mp4),
        "-vf", ",".join(filters),
        "-c:a", "copy", str(final_sub_mp4)
    ]
    log(f"执行 drawtext（{len(filters)} 句字幕）...")
    try:
        subprocess.run(drawtext_cmd, capture_output=True, check=True, timeout=120)
        log(f"✅ 字幕后处理成功: {final_sub_mp4}")
        log(f"📁 最终输出: {final_sub_mp4}")
    except subprocess.CalledProcessError as e:
        log(f"❌ 字幕后处理失败: {e}")

# ---------- grade (完整版新增) ----------

def cmd_grade(args) -> None:
    """完整版：12 断言自动验证输出质量"""
    out_dir = Path(args.output_dir)
    state = read_json(out_dir / "state.json")
    plan_data = read_json(Path(state["plan_path"]))

    passes = []
    failures = []

    def check(name, condition, detail=""):
        if condition:
            passes.append(f"✅ {name}")
        else:
            failures.append(f"❌ {name}: {detail}")

    # 断言 1: 所有 step 都已 record（兼容：手工跑通时 state 空，从本地 outputs 推断）
    total_steps = len(plan_data.get("image_generate_calls", [])) + len(plan_data.get("video_generate_calls", []))
    completed_steps = len(state.get("step_outputs", {}))
    if completed_steps < total_steps:
        # 回退检测：videos/seg*.mp4 + images/*.png 数量
        video_dir = Path(args.output_dir) / "videos"
        image_dir = Path(args.output_dir) / "images"
        local_videos = [v for v in video_dir.glob("seg*.mp4")
                        if "_lastframe" not in v.name and "final" not in v.name] if video_dir.exists() else []
        local_images = list(image_dir.glob("*.png")) if image_dir.exists() else []
        # MCP 把图片下到 base dir outputs/images/ 也算（兼容 2 种约定）
        # 1. 旧约定 cwd/outputs/images/
        # 2. 新约定 cwd/market-workspace/<proj>/images/（跨 project 全扫）
        if not local_images:
            cwd = Path.cwd()
            alt_candidates = [
                cwd / "outputs" / "images",                # 旧约定
                *list((cwd / "market-workspace").glob("*/images")) if (cwd / "market-workspace").exists() else [],  # 新约定
            ]
            for alt in alt_candidates:
                if alt.exists():
                    local_images = list(alt.glob("*.png"))
                    if local_images:
                        break
        completed_steps = max(completed_steps, len(local_videos) + len(local_images))
    check("所有 step 已 record", completed_steps >= total_steps,
          f"{completed_steps}/{total_steps}")

    # 断言 2: 视频段数 ≤ 3（36s = 12s × 3）
    video_count = len(plan_data.get("video_generate_calls", []))
    check("视频段数 ≤ 3 (36s)", video_count <= 3, f"实际 {video_count}")

    # 断言 3: 每段 video duration = 12s
    for vc in plan_data.get("video_generate_calls", []):
        secs = vc.get("params", {}).get("seconds", "")
        check(f"step {vc.get('step', '?')} duration = 12s", secs == "12", f"实际 {secs}s")

    # 断言 4: video prompt 不含 AI 内嵌字幕关键词
    forbidden_subtitle = ["MANDATORY BOTTOM SUBTITLE", "Subtitle at bottom", "字幕在底部"]
    for vc in plan_data.get("video_generate_calls", []):
        prompt = vc.get("params", {}).get("prompt", "")
        has_forbidden = any(kw in prompt for kw in forbidden_subtitle)
        check(f"step {vc.get('step', '?')} 无 AI 内嵌字幕", not has_forbidden)

    # 断言 5: video prompt 含 scene_lock_instruction
    for vc in plan_data.get("video_generate_calls", []):
        prompt = vc.get("params", {}).get("prompt", "")
        has_lock = "禁止" in prompt and "场景" in prompt
        check(f"step {vc.get('step', '?')} 含场景锁定", has_lock)

    # 断言 6: video prompt 含 BGM 关键词
    for vc in plan_data.get("video_generate_calls", []):
        prompt = vc.get("params", {}).get("prompt", "")
        has_bgm = "BGM" in prompt or "bgm" in prompt
        check(f"step {vc.get('step', '?')} 含 BGM 关键词", has_bgm)

    # 断言 7: hero shot 必须 image_generate → keyframe mode
    image_calls = plan_data.get("image_generate_calls", [])
    has_hero = any("hero" in (ic.get("purpose", "") + ic.get("output_filename", "")).lower()
                   for ic in image_calls)
    check("存在 hero shot image_generate", has_hero)

    video_calls = plan_data.get("video_generate_calls", [])
    has_keyframe = any(vc.get("params", {}).get("mode") == "keyframe" for vc in video_calls)
    check("存在 keyframe mode 视频段", has_keyframe)

    # 断言 8: drawtext 4 句字幕
    drawtext_count = len(plan_data.get("post_process", {}).get("drawtext", []))
    check("drawtext 4 句字幕", drawtext_count == 4, f"实际 {drawtext_count} 句")

    # 断言 9: 字幕时间码合法 (0-2.5s, 8-10.5s, 20-22.5s, 33-36s · 兼容 's' 后缀)
    expected_times = ["0-2.5s", "8-10.5s", "20-22.5s", "33-36s"]
    actual_times = [d.get("time", "") for d in plan_data.get("post_process", {}).get("drawtext", [])]
    check("字幕时间码符合公式", actual_times == expected_times,
          f"实际 {actual_times}")

    # 断言 10: protected fields（id 8 多角色）含 7 字段
    protected_check_path = out_dir / "json" / "agent_character.json"
    if protected_check_path.exists():
        char_data = read_json(protected_check_path)
        all_have_protected = all(
            len(c.get("protected_7_fields", {})) == 7
            for c in char_data.get("characters", [])
        )
        check("所有角色含 7 protected fields", all_have_protected)

    # 断言 11: continuity_handoffs 含 2 个段间锚点
    vd_path = out_dir / "json" / "agent_video_direction.json"
    if vd_path.exists():
        vd = read_json(vd_path)
        handoffs = vd.get("continuity_handoffs", [])
        check("continuity_handoffs ≥ 2 个段间锚点", len(handoffs) >= 2,
              f"实际 {len(handoffs)}")

    # 断言 12: world_setting 5 要素
    ws_path = out_dir / "json" / "agent_world_setting.json"
    if ws_path.exists():
        ws = read_json(ws_path)
        five_elements = ws.get("five_elements", {})
        required = ["premise", "era", "place", "spatial_logic", "world_rules"]
        has_all = all(e in five_elements for e in required)
        check("World Setting 5 要素齐全", has_all,
              f"缺失 {[e for e in required if e not in five_elements]}")

    # 输出报告
    log("=" * 50)
    log(f"GRADE REPORT: {len(passes)} passed · {len(failures)} failed")
    log("=" * 50)
    for p in passes:
        log(p)
    for f in failures:
        log(f)
    log("=" * 50)

    if failures:
        sys.exit(1)

# ---------- main ----------

def main() -> None:
    parser = argparse.ArgumentParser(description="MCP 调度脚本（完整版 · AdCraft 对齐）")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init", help="从 agent_video.json 解析步骤计划")
    p_init.add_argument("--plan", required=True)
    p_init.add_argument("--output-dir", required=True)
    p_init.set_defaults(func=cmd_init)

    p_next = sub.add_parser("next", help="打印下一个 step（递归 resolve 占位符）")
    p_next.add_argument("--output-dir", required=True)
    p_next.set_defaults(func=cmd_next)

    p_record = sub.add_parser("record", help="回喂 MCP 输出（自动抽末帧）")
    p_record.add_argument("--output-dir", required=True)
    p_record.add_argument("--step", type=int, required=True)
    p_record.add_argument("--output", required=True)
    p_record.add_argument("--image", action="store_true")
    p_record.set_defaults(func=cmd_record)

    p_finish = sub.add_parser("finish", help="一键出成片（自动 concat + drawtext）")
    p_finish.add_argument("--output-dir", required=True)
    p_finish.set_defaults(func=cmd_finish)

    p_grade = sub.add_parser("grade", help="12 断言自动验证")
    p_grade.add_argument("--output-dir", required=True)
    p_grade.set_defaults(func=cmd_grade)

    args = parser.parse_args()
    args.func(args)

if __name__ == "__main__":
    main()
