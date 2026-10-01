#!/usr/bin/env python3
"""
json_to_creative_plan.py — 11 Agent JSON → qisi 格式 creative-plan.md

按 qisi-video-remix/references/delivery-guide.md §1-§7 7 节格式拼装 Markdown。
对应 11 JSON：director / world_setting / script / character / scene / prop / storyboard
              / bgm / video_direction / video / qisi_remixer（§8 必跑）

Usage:
    python3 scripts/json_to_creative_plan.py \
        --input-dir <agent_outputs> \
        --output <creative-plan.md> \
        [--project-name <片名>] \
        [--routing §3|§4|§5|§6|§7|§8]

示例（leshi_remix 60s 实战）：
    python3 scripts/json_to_creative_plan.py \
        --input-dir market-workspace/leshi_remix/agent_outputs \
        --output market-workspace/leshi_remix/creative-plan.md \
        --project-name "加班夜的三袋惊喜" \
        --routing §8
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# ---------- JSON I/O ----------

def read_json(path: Path) -> dict:
    if not path.exists():
        print(f"[WARN] {path.name} not found · skipping", file=sys.stderr)
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def safe_get(d: dict, *keys: str, default: Any = "") -> Any:
    """安全嵌套取值（任一 key 缺失返回 default）"""
    for k in keys:
        if not isinstance(d, dict):
            return default
        d = d.get(k, default if k == keys[-1] else {})
    return d if d else default


# ---------- Markdown 拼接 ----------

def md_h(level: int, text: str) -> str:
    return f"{'#' * level} {text}\n\n"


def md_table(headers: list[str], rows: list[list[str]]) -> str:
    out = "| " + " | ".join(headers) + " |\n"
    out += "| " + " | ".join(["---"] * len(headers)) + " |\n"
    for row in rows:
        out += "| " + " | ".join(str(c) for c in row) + " |\n"
    return out + "\n"


def md_code_block(text: str, lang: str = "text") -> str:
    return f"```{lang}\n{text}\n```\n\n"


# ---------- 11 JSON → creative-plan.md 7 节 ----------

def render_section_1(jsons: dict, project_name: str, routing: str) -> str:
    """§1 本次方案（片名+时长+单段上限+比例+风格+默认设置+材料范围）"""
    d = jsons.get("director", {})
    cd = safe_get(d, "creative_director")
    ws = safe_get(d, "creative_director", "world_setting")
    pd_ = safe_get(d, "creative_director", "product_design")

    total_seconds = safe_get(ws, "duration_seconds", default=36)
    platform = safe_get(ws, "platform", default="抖音")
    style_keywords = safe_get(ws, "style_keywords", default=[])
    style_str = " + ".join(style_keywords[:2]) if style_keywords else "未指定"
    aspect_ratio = "9:16 竖屏" if "抖音" in platform or "快手" in platform else "16:9 横屏"

    routing_map = {"§3": "商品展示", "§4": "电商种草", "§5": "游戏买量",
                   "§6": "品牌宣传", "§7": "UGC 口播", "§8": "视频复刻"}
    routing_full = routing_map.get(routing, "未指定")
    n_segments = total_seconds // 12

    out = md_h(1, project_name or safe_get(pd_, "product_name", default="未命名"))
    out += "> **本文件用途**：marketing-ad-skill §8/§3-§6 端到端产物的可读 Markdown 版本。"
    out += "对应 11 Agent JSON · 按 qisi-video-remix/references/delivery-guide.md §1-§7 格式拼装。\n\n"
    out += "---\n\n"
    out += md_h(2, "1. 本次方案")
    out += md_table(
        ["项", "值"],
        [
            ["片名", project_name or "（未提供）"],
            ["预计总时长", f"{total_seconds} 秒"],
            ["单段上限", f"12s × {n_segments}（本 skill 12s 铁律 · §9.1 · 与 qisi 默认 15s/30s 不同）"],
            ["比例", aspect_ratio],
            ["风格", style_str],
            ["路由", f"{routing} {routing_full}"],
            ["Agent 编排", "11 Agent（§8 加 Round 0.5 = 12 Agent）"],
        ],
    )
    out += "**默认设置**：\n\n"
    out += "- 语言：中文（普通话）\n"
    out += "- 字幕：drawtext 后处理（§9.3 · 与 qisi 默认「无字幕」不同）\n"
    out += f"- BGM：见 `agent_bgm.json`（三段节奏 + SFX）\n\n"
    out += "**参考材料覆盖范围**（§8 入口时填写）：\n\n"
    if routing == "§8":
        qr = jsons.get("qisi_remixer", {}).get("qisi_remixer", {})
        given = safe_get(qr, "source_materials", "given", default=[])
        unconfirmed = safe_get(qr, "source_materials", "unconfirmed", default=[])
        for g in given:
            out += f"- ✅ {g}\n"
        for u in unconfirmed:
            out += f"- ❌ {u}\n"
    else:
        out += "- ✅ 用户原始需求\n"
        out += "- ❌ 无参考视频（§8 入口未触发）\n"
    out += "\n**生成模型**：multimedia-creator MCP（agnes-image-2.5-flash + agnes-video-2.5-flash）\n\n"
    return out


def render_section_2(jsons: dict, routing: str) -> str:
    """§2 参考与改编思路（原片故事+借用方法+改动维度）"""
    out = md_h(2, "2. 参考与改编思路")
    if routing != "§8":
        out += "（非 §8 路由，无参考视频改编，此节简略）\n\n"
        d = jsons.get("director", {})
        cd = safe_get(d, "creative_director")
        concept = safe_get(cd, "concept", default=cd)
        out += f"创意概念：{concept}\n\n" if concept else ""
        return out

    qr = jsons.get("qisi_remixer", {}).get("qisi_remixer", {})

    out += md_h(3, "2.1 原片故事（基于 Round 0.5 timeline_breakdown）")
    narrative_pattern = safe_get(qr, "narrative_pattern", default="（未提供）")
    hook_mech = safe_get(qr, "hook_mechanism", default="（未提供）")
    visual_sig = safe_get(qr, "visual_signature", default="（未提供）")
    pacing_sig = safe_get(qr, "pacing_signature", default="（未提供）")
    out += f"- **narrative_pattern**：{narrative_pattern}\n"
    out += f"- **hook_mechanism**：{hook_mech}\n"
    out += f"- **visual_signature**：{visual_sig}\n"
    out += f"- **pacing_signature**：{pacing_sig}\n\n"

    out += md_h(3, "2.2 借用叙事方法（borrowed_methods）")
    methods = safe_get(qr, "borrowed_methods", default=[])
    if methods:
        rows = []
        for i, m in enumerate(methods, 1):
            rows.append([f"**方法 {i}**：{safe_get(m, 'name')}",
                         safe_get(m, 'how_it_works', default="（未说明）")])
        out += md_table(["方法", "在原片如何起作用"], rows)
    else:
        out += "（未提供 borrowed_methods）\n\n"

    out += md_h(3, "2.3 新故事改动（new_story_changes）")
    changes = safe_get(qr, "new_story_changes", default={})
    rows = []
    for dim in ["人物", "事件", "信息差", "解决方式"]:
        rows.append([dim, "✓" if changes.get(dim) else "✗"])
    out += md_table(["维度", "是否改动"], rows)

    comparison = safe_get(qr, "comparison_table", default=[])
    if comparison:
        out += "\n**comparison_table**（4 列对照）：\n\n"
        out += md_table(
            ["参考画面", "参考解读", "新画面", "新解读"],
            [[safe_get(c, 'reference_frame', '?', default='?'),
              safe_get(c, 'reference_interpretation', '?', default='?'),
              safe_get(c, 'new_frame', '?', default='?'),
              safe_get(c, 'new_interpretation', '?', default='?')]
             for c in comparison],
        )
    return out


def render_section_3(jsons: dict) -> str:
    """§3 完整剧本（按场次的可读故事 + 末帧定格）"""
    out = md_h(2, "3. 完整剧本")
    s = jsons.get("storyboard", {}).get("storyboard", {})
    segments = safe_get(s, "segments", default=[])
    if not segments:
        out += "（未提供 segments）\n\n"
        return out

    for seg in segments:
        idx = safe_get(seg, "idx", default="?")
        shot = safe_get(seg, "shot", default="（未命名）")
        duration = safe_get(seg, "duration", default=12)
        closing = safe_get(seg, "closing_state_for_next_segment", default="（未提供）")
        out += f"### 段 {idx}（{duration}s）· {shot}\n\n"
        if "prompt_combined" in seg and seg["prompt_combined"]:
            out += seg["prompt_combined"] + "\n\n"
        else:
            out += f"（无 prompt_combined · 段 {idx} 描述省略）\n\n"
        out += f"**末帧定格**：{closing}\n\n"
    return out


def render_section_4(jsons: dict) -> str:
    """§4 人物与场景（人物表+造型+场景表+生图提示词）"""
    out = md_h(2, "4. 人物与场景")

    char_data = jsons.get("character", {}).get("character", {})
    identity = safe_get(char_data, "identity_master", default={})
    name = safe_get(identity, "name", default="未命名")
    if identity:
        out += md_h(3, "4.1 人物表")
        rows = []
        for field, label in [
            ("gender", "性别"), ("age_range", "年龄"), ("ethnicity", "肤色"),
            ("hair", "发型"), ("body", "体型"), ("outfit", "服装"),
            ("accessory", "配饰"), ("expression", "表情"),
        ]:
            rows.append([label, safe_get(identity, field, default="（未提供）")])
        out += md_table(["字段", f"{name} · identity_master"], rows)
        out += "\n"

    scene_data = jsons.get("scene", {}).get("scene", {})
    scene_id = safe_get(scene_data, "identity", "location", default="未命名")
    out += md_h(3, "4.2 场景表")
    rows = []
    for field, label in [
        ("location", "地点"), ("lighting", "光照"), ("tone", "色调"),
        ("props", "道具"), ("depth", "景深"), ("forbidden", "禁止元素"),
    ]:
        rows.append([label, safe_get(scene_data, "identity", field, default="（未提供）")])
    out += md_table(["字段", f"{scene_id} · identity"], rows)
    scene_lock = safe_get(scene_data, "scene_lock_instruction", default="")
    if scene_lock:
        out += f"\n**scene_lock_instruction**：{scene_lock}\n\n"

    prop_data = jsons.get("prop", {}).get("prop_design", {})
    props = safe_get(prop_data, "props", default=[])
    if props:
        out += md_h(3, "4.3 道具表")
        rows = []
        for p in props:
            rows.append([
                safe_get(p, "prop_id", default="?"),
                safe_get(p, "identity", "name", default="?"),
                "✓" if p.get("recurs_across_segments") else "✗",
            ])
        out += md_table(["prop_id", "name", "跨段锁定"], rows)
    return out


def render_section_5(jsons: dict) -> str:
    """§5 分镜表（镜头+时间/时长+人物场景+画面运镜+对白声音）"""
    out = md_h(2, "5. 分镜表")
    s = jsons.get("storyboard", {}).get("storyboard", {})
    segments = safe_get(s, "segments", default=[])
    if not segments:
        out += "（未提供 segments）\n\n"
        return out

    def fmt(seconds: int) -> str:
        m, s_ = divmod(seconds, 60)
        return f"{m:02d}:{s_:02d}"

    rows = []
    for seg in segments:
        idx = safe_get(seg, "idx", default="?")
        duration = safe_get(seg, "duration", default=12)
        start = (idx - 1) * duration
        end = idx * duration
        shot = safe_get(seg, "shot", default="（未命名）")
        scene_id = safe_get(seg, "scene_id", default="（未提供）")
        rows.append([
            f"段 {idx}",
            f"{fmt(start)}–{fmt(end)}／{duration} 秒",
            scene_id,
            shot,
            "（见 §6 段提示词）",
        ])
    out += md_table(
        ["镜头", "全片时间／时长", "人物与场景", "画面和运镜", "对白与声音"],
        rows,
    )
    return out


def render_section_6(jsons: dict) -> str:
    """§6 生成分段（总览表 + 切分原因 + 起止状态 + 每段独立可复制代码块）"""
    out = md_h(2, "6. 生成分段")
    s = jsons.get("storyboard", {}).get("storyboard", {})
    segments = safe_get(s, "segments", default=[])
    if not segments:
        out += "（未提供 segments）\n\n"
        return out

    out += "> **总览表**：\n\n"
    rows = []
    for seg in segments:
        idx = safe_get(seg, "idx", default="?")
        duration = safe_get(seg, "duration", default=12)
        split_reason = safe_get(seg, "split_reason", default="—")
        closing = safe_get(seg, "closing_state_for_next_segment", default="—")
        rows.append([
            f"T{idx:02d}", f"段 {idx}", f"{duration}s",
            split_reason, closing,
        ])
    out += md_table(
        ["生成段", "覆盖镜头", "实际时长", "切分原因（split_reason）", "起始 → 结束状态"],
        rows,
    )

    out += "\n> **qisi 切段决策 SOP 二次判定**：见 `references/qisi-section-decision-sop.md`\n\n"

    for seg in segments:
        idx = safe_get(seg, "idx", default="?")
        shot = safe_get(seg, "shot", default="（未命名）")
        prompt = safe_get(seg, "prompt_combined", default="（未提供 prompt）")
        out += f"### T{idx:02d} · 段 {idx} · {shot}\n\n"
        out += md_code_block(prompt)
    return out


def render_section_7(jsons: dict) -> str:
    """§7 制作备注（总时长+镜头数+分段数+字幕+关键技术决策+交付）"""
    out = md_h(2, "7. 制作备注")

    s = jsons.get("storyboard", {}).get("storyboard", {})
    segments = safe_get(s, "segments", default=[])
    n_segments = len(segments)
    total = safe_get(s, "total_duration_seconds", default=n_segments * 12)

    out += md_h(3, "7.1 总时长/镜头数/分段数")
    out += f"- 计划总时长：**{total} 秒**\n"
    out += f"- 段数：{n_segments}（12s × {n_segments} · 本 skill 12s 铁律）\n"
    out += f"- 角色：见 §4.1\n"
    out += f"- 场景：见 §4.2\n\n"

    bgm_data = jsons.get("bgm", {}).get("bgm", {})
    drawtexts = safe_get(bgm_data, "drawtext_subtitles", default=[])
    if drawtexts:
        out += md_h(3, f"7.2 字幕（drawtext 后处理 · {len(drawtexts)} 句公式）")
        rows = []
        for dt in drawtexts:
            time = safe_get(dt, "time", default="?")
            text = safe_get(dt, "text", default="?")
            size = safe_get(dt, "font_size", default=44)
            color = safe_get(dt, "color", default="white")
            rows.append([time, text, size, color])
        out += md_table(["时间码", "文字", "字号", "颜色"], rows)
        out += "\n> box=1 + boxcolor=black@0.7 + boxborderw=12 防止白字落到亮区不可见\n"
        out += "> 字体：`/usr/share/fonts/truetype/wqy/wqy-microhei.ttc`\n\n"

    vd = jsons.get("video_direction", {}).get("video_direction", {})
    handoffs = safe_get(vd, "continuity_handoffs", default=[])
    if handoffs:
        out += md_h(3, f"7.3 跨段锁定（continuity_handoffs · {len(handoffs)} 个）")
        rows = []
        for h in handoffs:
            from_seg = safe_get(h, "from_segment", default="?")
            to_seg = safe_get(h, "to_segment", default="?")
            anchor = safe_get(h, "anchor", default="—")
            rows.append([f"段 {from_seg}→段 {to_seg}", anchor])
        out += md_table(["段间", "锚点"], rows)
        out += "\n"

    v = jsons.get("video", {}).get("video", {})
    n_img = len(safe_get(v, "image_generate_calls", default=[]))
    n_vid = len(safe_get(v, "video_generate_calls", default=[]))
    concat_cmd = safe_get(v, "concat_command", default="")
    out += md_h(3, "7.4 MCP 调用统计")
    out += f"- image_generate_calls：**{n_img}**（hero shot / first_frame / contact sheet）\n"
    out += f"- video_generate_calls：**{n_vid}**（每段一次 · mode=reference · seconds=12）\n"
    if concat_cmd:
        out += f"- concat_command：`{concat_cmd}`\n"
    out += "\n"

    out += md_h(3, "7.5 关键技术决策")
    out += "- **12s 段铁律**：受 agnes-video-2.5-flash ≤12s 限制 + 衔接连贯铁律\n"
    out += "- **reference mode**：必传 + 单元素 images[] 数组（harness dict 序列化坑已规避）\n"
    out += "- **drawtext 后处理**（v9 铁律）：不在 prompt 里写 AI 内嵌字幕\n"
    out += "- **scene_lock_instruction**：每段显式锁定场景（避免失败模式 #8 多场景漂移）\n"
    if n_segments >= 3:
        out += "- **每段拆 3-4 个 1-4s 离散分镜**（storyboard-prompt-spec.md · 避免全程空转）\n"

    out += md_h(3, "7.6 最终交付（待 finish）")
    out += "- `final_<N>s.mp4`（concat demuxer 拼接）\n"
    out += "- `final_<N>s_with_subtitle.mp4`（drawtext 后处理）\n"
    out += "- 11 Agent JSON 全交付：director + world_setting + script + character + scene + prop + storyboard + bgm + video_direction + video + qisi_remixer\n"
    return out


# ---------- main ----------

def main() -> None:
    ap = argparse.ArgumentParser(
        description="11 Agent JSON → qisi 格式 creative-plan.md（§1-§7 7 节）",
    )
    ap.add_argument("--input-dir", required=True,
                    help="agent_outputs 目录（含 11 个 agent_*.json）")
    ap.add_argument("--output", required=True, help="creative-plan.md 输出路径")
    ap.add_argument("--project-name", default="", help="片名（§1 必填）")
    ap.add_argument("--routing", default="§3",
                    choices=["§3", "§4", "§5", "§6", "§7", "§8"],
                    help="路由（§3 商品展示 / §4 电商种草 / §5 游戏买量 / §6 品牌宣传 / §7 UGC / §8 视频复刻）")
    args = ap.parse_args()

    input_dir = Path(args.input_dir)
    output_path = Path(args.output)

    json_files = {
        "director":        input_dir / "agent_director.json",
        "world_setting":   input_dir / "agent_world_setting.json",
        "script":          input_dir / "agent_script.json",
        "character":       input_dir / "agent_character.json",
        "scene":           input_dir / "agent_scene.json",
        "prop":            input_dir / "agent_prop.json",
        "storyboard":      input_dir / "agent_storyboard.json",
        "bgm":             input_dir / "agent_bgm.json",
        "video_direction": input_dir / "agent_video_direction.json",
        "video":           input_dir / "agent_video.json",
        "qisi_remixer":    input_dir / "agent_qisi_remixer.json",
    }

    jsons = {name: read_json(path) for name, path in json_files.items()}

    md = ""
    md += render_section_1(jsons, args.project_name, args.routing)
    md += render_section_2(jsons, args.routing)
    md += render_section_3(jsons)
    md += render_section_4(jsons)
    md += render_section_5(jsons)
    md += render_section_6(jsons)
    md += render_section_7(jsons)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(md, encoding="utf-8")

    print(f"[json_to_creative_plan] ✅ {output_path} ({len(md)} chars)")
    print(f"  sections: §1 本次方案 / §2 改编思路 / §3 剧本 / §4 人物场景 / §5 分镜 / §6 分段 / §7 制作备注")
    missing = [name for name, data in jsons.items() if not data]
    if missing:
        print(f"  [WARN] missing JSON: {', '.join(missing)}")


if __name__ == "__main__":
    main()