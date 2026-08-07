# Brief & direction

## Purpose
HamunaAgent 是基于 Claude Agent SDK 的桌面端通用 AI Agent 产品。开源（Apache-2.0），面向需要强大 AI 助手的个人用户和团队，提供多会话管理、工具调用、定时任务、团队协作等完整 AI 工作流。

## Audience
- **个人用户**：开发者、知识工作者，需要一个统一的 AI 对话入口，支持文件操作、终端、代码编辑、网页浏览等深度工作
- **团队用户**：小团队通过 Space 功能协作，共享 Issue/Goal/Skill，通过 IM Bot（飞书/钉钉/Telegram）接入 AI 能力
- **高级用户**：需要自定义 Agent、MCP Server、多 Runtime（Claude Code/Codex/Gemini）切换、定时任务编排

## Tone
- **专业而克制**：工具型产品，不追求花哨，追求高效和信任感
- **技术感但不冰冷**：面向技术人员，但 UI 应该平易近人，不是 IDE 的复制品
- **安静**：默认状态安静、不打扰，信息密度适中，重要内容自然浮出

## Success criteria
- 用户能在 3 秒内开始一次新的 AI 对话
- 多会话切换无感知延迟
- 工具调用过程透明可追溯（用户知道 AI 在做什么）
- 新用户 5 分钟内理解核心功能布局
- 视觉一致性：换肤/主题切换后所有组件视觉无断裂

## Constraints
- **技术栈**：Tauri v2 (Rust) + React 19 + TypeScript + TailwindCSS
- **平台**：Windows 10+、macOS、Linux
- **视口**：desktop-only（最小 1024px 宽，典型 1280-1920px）
- **已有设计系统**：项目已有完整的 CSS Token / Theme System / 组件库，新设计必须基于现有 Token
- **无障碍**：键盘导航完整，色彩对比度 WCAG AA
- **国际化**：已有 i18n 系统，支持中/英文
