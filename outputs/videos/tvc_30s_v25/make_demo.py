"""30s TVC demo using hosted_mcps/agnes-video-25/ reference mode.

Reuses assets already in outputs/images/:
  - character_setup_bartender.png  → <Picture 1>
  - product_hero_gin.png           → <Picture 2>
  - scene_bar_background.png       → <Picture 3>

Each take is a 5s reference-mode video; references are NOT first-frame anchors,
they're visual anchors carried via the prompt's <Picture N> placeholders.

Outputs (under outputs/videos/tvc_30s_v25/):
  - take01..take06_raw.mp4   (raw per-take from agnes25_video_generate)
  - take01..take06_norm.mp4  (ffmpeg-normalized for concat)
  - concat_list.txt
  - tvc_30s_v25_final.mp4
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)

# Add hosted_mcps/agnes-video-25 to sys.path so we can import the package.
REPO_ROOT = Path("/home/hmcz/Projects/hamuna-agent-desktop")
sys.path.insert(0, str(REPO_ROOT / "hosted_mcps/agnes-video-25/src"))

from agnes_video_25.server import agnes25_video_generate  # noqa: E402

# Asset paths (local)
ASSETS = {
    "character": REPO_ROOT / "outputs/images/character_setup_bartender.png",
    "product": REPO_ROOT / "outputs/images/product_hero_gin.png",
    "scene": REPO_ROOT / "outputs/images/scene_bar_background.png",
}

OUT_DIR = REPO_ROOT / "outputs/videos/tvc_30s_v25"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def upload_image(local_path: Path) -> str:
    """Upload a local image to img.remit.ee; return its public HTTPS URL."""
    result = subprocess.run(
        [
            "curl", "-s", "-X", "POST", "https://img.remit.ee/api/upload",
            "-H", "Referer: https://img.remit.ee/free-image-hosting",
            "-H", "Origin: https://img.remit.ee",
            "-F", f"file=@{local_path};type=image/png",
        ],
        capture_output=True, text=True, check=True,
    )
    payload = json.loads(result.stdout)
    if not payload.get("success"):
        raise RuntimeError(f"img.remit.ee upload failed for {local_path}: {result.stdout}")
    return "https://img.remit.ee" + payload["directUrl"]


def normalize_for_concat(src: Path, dst: Path) -> None:
    """Re-encode to 30fps / yuv420p / even dims so concat demuxer doesn't choke."""
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(src),
        "-r", "30", "-pix_fmt", "yuv420p",
        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(dst),
    ]
    subprocess.run(cmd, check=True)


async def main() -> int:
    # 1. Upload 3 reference assets; collect HTTPS URLs in fixed order:
    #    [<Picture 1>=character, <Picture 2>=product, <Picture 3>=scene]
    print("==> uploading 3 reference assets to img.remit.ee")
    ref_urls: list[str] = []
    for key in ("character", "product", "scene"):
        url = upload_image(ASSETS[key])
        print(f"  {key:<10} {url}")
        ref_urls.append(url)

    # 2. 6 takes × 5s, each references the same 3 anchors via <Picture N>.
    #    Goal: visual style/character/product continuity across takes WITHOUT
    #    dictating any take's first frame.
    takes: list[tuple[str, str]] = [
        ("take01_hero", (
            "以 <Picture 1> 中的调酒师形象与 <Picture 3> 的酒吧空间为视觉锚点，"
            "开场特写：调酒师在吧台后微笑侧目，背景虚化，自然光从右后方打入，"
            "镜头缓慢推进，氛围安静有质感，色彩克制（金色+深棕），"
            "不出现任何品牌包装或文字。镜头始终不切。"
        )),
        ("take02_pour", (
            "延续上一镜头的人物与空间感，<Picture 1> 调酒师拿起 <Picture 2> 金酒瓶，"
            "优雅地将酒液倒入古典杯，琥珀色液体在低光下通透，"
            "运镜：右肩视角 → 缓慢推到杯口微距，金色酒液流动可见。\n"
            "硬约束：酒瓶外观与 <Picture 2> 一致，标签朝向镜头外不出现。"
        )),
        ("take03_pour_detail", (
            "极近景：从杯中酒液上升的气泡入手，<Picture 2> 金酒独有的草本色泽在背光中发亮，"
            "画面质感：电影级 macro photography, 50mm 微距, f/2.8, 浅景深。"
            "无人物，无 logo，无字幕。"
        )),
        ("take04_shake", (
            "<Picture 1> 调酒师加入冰块与 <Picture 2> 金酒，开始专业调酒 shake 动作，"
            "双手持雪克壶有力节奏感，背景是 <Picture 3> 暖色 bar 灯光，"
            "运镜：稳拍中景 + 慢动作点缀（动作 1/2 速度），"
            "硬约束：人物脸部与服饰保持与开场一致。"
        )),
        ("take05_clink", (
            "<Picture 1> 调酒师轻推成品古典杯向前，杯壁结露，背景 <Picture 3> 暖光发糊，"
            "运镜：低位 25 度仰拍，杯子入画后停留 1.5s，杯身反射出暖色光斑。"
            "无 logo，无字幕，无手指出画。"
        )),
        ("take06_endboard", (
            "收束镜头：成品古典杯居中，<Picture 3> 暖色 bar 灯光在背景缓慢呼吸，"
            "金酒草本气泡在杯中上升（macro），氛围安静留白。\n"
            "硬约束：全程不出现任何文字 / logo / 字幕 / 标签 / 箭头；"
            "不出现额外人物；杯子不要换外观。"
        )),
    ]

    raw_paths: list[Path] = []
    for i, (name, prompt) in enumerate(takes, start=1):
        out_path = OUT_DIR / f"{name}_raw.mp4"
        if out_path.exists():
            print(f"\n==> [skip] {name} ({i}/6) — already exists at {out_path}")
            raw_paths.append(out_path)
            continue
        print(f"\n==> generating {name} ({i}/6), 5s, reference mode")
        print(f"    prompt: {prompt[:80]}...")
        result = await agnes25_video_generate(
            prompt=prompt,
            model="agnes-video-2.5-flash",   # cheapest; same reference API
            mode="reference",
            seconds="5",
            size="720P",
            aspect_ratio="16:9",
            images=ref_urls,
            timeout_seconds=300.0,
            poll_interval_seconds=3.0,
            download=True,
            output_filename=f"{name}_raw.mp4",
        )
        if not result.get("ok"):
            print(f"    FAILED: {result.get('error')}")
            return 1
        local = result.get("local_path")
        if not local:
            print(f"    FAILED: no local_path in result")
            return 1
        # Move/rename to OUT_DIR if MCP saved elsewhere.
        src = Path(local)
        if src != out_path:
            out_path.write_bytes(src.read_bytes())
        raw_paths.append(out_path)
        print(f"    OK → {out_path}  (video_id={result.get('video_id')})")

    # 3. Normalize each take (libx264 / 30fps / yuv420p / even dims).
    print("\n==> normalizing 6 takes for concat")
    norm_paths: list[Path] = []
    for raw in raw_paths:
        norm = raw.with_name(raw.stem.replace("_raw", "_norm") + ".mp4")
        if norm.exists():
            print(f"  [skip] {norm.name} (already normalized)")
        else:
            normalize_for_concat(raw, norm)
        norm_paths.append(norm)
        print(f"  {norm.name}")

    # 4. Concat demuxer.
    concat_list = OUT_DIR / "concat_list.txt"
    concat_list.write_text(
        "".join(f"file '{p.name}'\n" for p in norm_paths)
    )
    final = OUT_DIR / "tvc_30s_v25_final.mp4"
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_list),
        "-c", "copy",
        str(final),
    ]
    subprocess.run(cmd, check=True)
    print(f"\n==> done: {final}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
