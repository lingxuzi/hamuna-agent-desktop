# 端到端 Demo 案例

> 本目录沉淀完整的 agnes-short-drama skill 端到端产出案例，供 Agent 参考与 Skill 用户上手学习。

## 当前案例

| 案例 | 风格 | 集数 | 状态 |
|------|------|------|------|
| [十年后的回信 E01](./E01_模糊的勇气/README.md) | 二次元动漫 | 第 1 集 | ✅ 完整 demo（Phase 2-5 全链路） |

## 每个 demo 文件包含

- **Phase 2**：6 字段元数据自动展开（剧集/故事类型/受众/概要/世界观/角色）
- **Phase 3**：完整集级剧本（导演式语法 4 标记）
- **Phase 4**：角色/场景/道具资产 prompt（含风格锚定词 + 引用命名）
- **Phase 5**：9 宫格分镜图 prompt + 13 个 12 字段单镜视频 prompt + Multi-Phase 视频 prompt
- **ffmpeg 合成命令**：单集拼接步骤
- **验证清单**：10 项自检通过表

## 使用方法

1. 拿到完整 demo 后，**对照模板字段填空**——验证 skill 输出与你的项目匹配
2. **资产 prompt 直接复制**到 `mcp__multimedia-creator__agnes25_image_generate` 调用
3. **12 字段视频 prompt 直接复制**到 `mcp__multimedia-creator__agnes25_video_generate` reference 模式调用
4. **ffmpeg 命令直接复制**到终端执行

## 新增案例的模板

如要为其他短剧项目生成 demo，按 `E01_模糊的勇气/README.md` 的 7 节结构组织：

1. 项目元数据 + 关联文件
2. Phase 2 自动展开
3. Phase 3 完整剧本
4. Phase 4 资产库
6. Phase 5 分镜与拍摄
7. ffmpeg 合成
8. 验证清单
9. 后续集数索引