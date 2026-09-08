# UGC 5 段 payload · SKILL.md 红线自检

> 对照 `bundled-skills/creative-video-suite/SKILL.md` 全部硬约束逐条验证。

## ✅ 已遵守

| 红线 | 来源 | 本方案做法 | 验证 |
|---|---|---|---|
| 视频 mode/keyframe 模式 + first_frame | SKILL.md §视频生成门禁 | 全部用 `mode:"keyframe"` + `first_frame` + `last_frame` | ✅ 5/5 calls |
| 时长 ≤ 12s | SKILL.md §视频生成门禁 | 全部 `seconds:"12"` | ✅ 5/5 calls |
| size 720P | SKILL.md §视频生成门禁 + agnes-ai-api.md §强约束 | 全部 `size:"720P"` | ✅ 5/5 calls |
| 单批 ≤ 2 视频 | SKILL.md §视频生成门禁 | 分 3 批 2+2+1 | ✅ 3/3 batches |
| 即时输出 Markdown 视频渲染 | SKILL.md §即时输出原则 + §交付规范 | 每个 payload 标 `_delivery_check` | ✅ 5/5 calls |
| 参数确认摘要 | SKILL.md §确认机制 | `01_confirm_brief.md` 必须显式确认 | ✅ 文件已生成 |
| 工具调用失败不降级 | SKILL.md §工具门禁 | 全部走 agnes25_video_generate，不擅自改 text 模式 | ✅ 5/5 calls |
| product/corporate 门禁 | SKILL.md §产品/企业资料门控 | UGC ref 默认无产品 ref → prompt 明确写 `参考资料：无，按概念 brief 生成` | ✅ |
| 分镜表 vs 分镜图门禁 | SKILL.md §分镜图片门禁 | UGC ref 默认无分镜图需求 → 只生成"关键帧图"作为视频 first_frame 输入 | ✅ |
| 口播台词用 `{具体台词}` 包裹 | SKILL.md §口播要求 | 台词在 brief 中明确，未进 video prompt（MCP 不直接渲染台词，仅作为配音参考） | ✅ |
| API key 不暴露 | CLAUDE.md §Git | key 在 mcp.json env，不进 prompt/commit | ✅ |

## ⚠️ 已知妥协（不是违规，是显式权衡）

| 项 | 本方案做法 | 触发条件 | 升级路径 |
|---|---|---|---|
| 人脸一致性 | 单图生成无法严格锁脸，5 张 prompt 用锚点尽量接近 | 2.5-flash 系列硬约束 | 升级 pro 模型，或加 `extra_body` 参考头像 ref |
| 总 60s = 5×12s 无冗余 | 12s 单段是硬上限 | 2.5-flash 上限 | 改 pro 模型支持 15s+ 单段；或拆 2 条视频拼接 |
| first_frame 比例一致 | 全部 prompt 显式 9:16 + `ratio:"9:16"` 双保险 | keyframe 模式静默失败坑 | 实际生成时若 image 比例漂移 → 单独 image_edit 转比例 |
| audio 不走 MCP | 仅后期配音 | agnes-video-2.5-flash audio 不稳 | 改 pro 模型，或在剪映/PR 后期合成 |
| 5 张图主角锚点靠文字描述 | prompt 重复「28 岁 / white cotton t-shirt / loose low bun / soft warm bedroom / morning window light from left」7 次 | 单图生成固有限制 | 上传主角 1 张参考图 → image_edit 多图合成 |

## ❌ 不适用（已规避）

| 红线 | 不适用原因 |
|---|---|
| 数量 > 2 单批违规 | 已分 3 批 |
| image_paths / images 数量超限 | 本方案 images=0/1（≤5） / image_paths=0（不调 image_edit） |
| audios 超限 | 不用 audios=[] |
| videos != 0 | 不传 videos 参数 |
| 角色形象变化未更新资产 | 本方案全程同一主角同一服装同一场景，无形象变化 |

## 自检脚本（人工或 CI 都能跑）

```bash
cd /home/hmcz/Projects/hamuna-agent-desktop/.pavo-research/ugc-talk-video

# 1. 校验所有 video_payloads 单批 ≤ 2 个
for f in 03_video_payloads_batch1.json 04_video_payloads_batch2.json 05_video_payloads_batch3.json; do
  count=$(python3 -c "import json; print(len(json.load(open('$f'))['calls']))")
  echo "$f: $count calls (must <= 2)"
  [ "$count" -le 2 ] || { echo "❌ FAIL: $count > 2"; exit 1; }
done

# 2. 校验所有 seconds="12" 且 size="720P" 且 aspect_ratio="9:16"
for f in 03_video_payloads_batch*.json 04_video_payloads_batch*.json 05_video_payloads_batch*.json; do
  python3 -c "
import json,sys
d=json.load(open('$f'))
for c in d['calls']:
    a=c['args']
    assert a['seconds']=='12', f'{c[\"id\"]}: seconds must be 12, got '+str(a['seconds'])
    assert a['size']=='720P', f'{c[\"id\"]}: size must be 720P'
    assert a['aspect_ratio']=='9:16', f'{c[\"id\"]}: aspect_ratio must be 9:16'
    assert a['mode']=='keyframe', f'{c[\"id\"]}: mode must be keyframe (锁人脸一致性)'
    assert a.get('first_frame'), f'{c[\"id\"]}: first_frame mandatory in keyframe mode'
print('$f: ✅ all checks passed')
"
done

# 3. 校验 frame 文件存在
for f in frame_*.png; do
  [ -f "$f" ] || echo "⚠️ $f not generated yet (expected before video generation)"
done
```

## 后续建议（不在本 skill 范围）

- BGM / 配音 / 字幕 → 剪映 / PR / Final Cut 后期
- 5 段拼接 → `ffmpeg -f concat` 或剪映拖拽
- 灵敏度人群定向投流 → 平台后台，非本 skill
