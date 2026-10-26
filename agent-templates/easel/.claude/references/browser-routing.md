# 浏览器路由

*要碰网页时先读这页。选错工具的代价是登录态丢失，或者发布到一半卡住。*

## 一句话规则

**搜索、查询、调研 → 优先内置浏览器，Playwright 作为 fallback。无人值守 → 不碰浏览器。**

「优先」是顺序要求，不是建议：先在用户看得见的窗口里试，试不动才换。反过来，明明能一次做成却先开 headless 就是错的 —— 它看不到用户的登录态，还多出一套要单独登录的 profile。

## 三个工具

| | 内置浏览器 | agent-browser | Playwright MCP |
|---|---|---|---|
| 怎么调 | `hamuna browser …` | `npx agent-browser …` | MCP 工具（需先在设置里装） |
| 用户看得见吗 | **看得见**（叠加在 Chat 面板上） | 看不见（无头） | 看不见（无头） |
| 登录态 | 用户自己那个 Tauri 窗口的 cookie | `~/.agent-browser/` 独立 profile | `~/.playwright-mcp-profile/` 独立 profile |
| Windows | 可用 | **被禁用**（上游缺陷） | 可用 |
| 上传本地文件 | 支持，**≤12 MiB 且只适合图片** | 支持，无此限制 | 支持，无此限制 |
| 需要用户开着一个 Chat 吗 | **需要** | 不需要 | 不需要 |

三个工具的登录态**互不相通**。在内置浏览器里登录过小红书，agent-browser 仍然是未登录状态。这是设计如此，不是 bug —— 别试着共享 profile，两个 Chromium 抢同一个目录会锁死。

## 什么时候用哪个

### 用内置浏览器（默认，先试这个）

- **搜索、查资料、调研** —— 一律先走这里
- 用户就在旁边，看着你做
- 要登录、扫码、过人机校验 —— 用户能直接在他的窗口里操作
- 读网页、填表、点按钮
- 上传**图片**（封面、配图）

```bash
hamuna browser search "小红书 美妆赛道 2026 趋势"
hamuna browser open https://creator.xiaohongshu.com
hamuna browser read
hamuna browser fill --selector "#title" --value "标题"
hamuna browser upload --selector "input[type=file]" --file outputs/<主题>/cover.png
```

**内置浏览器需要一个可见的 Chat session。** 拿不到 session 会直接报错，不是重试能解决的 —— 这就是换 fallback 的信号。

### 用 headless（fallback，只在三种情况下换）

1. **内置浏览器起不来**：报 `a Chat session is required`，或打开超时 15s
2. **上传视频**（超 12 MiB，内置浏览器的注入通道装不下）
3. **无人值守**：心跳 / 定时任务里巡检（此时用户不在，内置浏览器物理上开不了）

换个说法：**能内置就内置。** headless 只在前一条路真的断了的时候用，不是"headless 更方便所以先用它"。

```bash
# 有 agent-browser（macOS / Linux；Windows 不可用）
npx agent-browser open https://creator.xiaohongshu.com
npx agent-browser snapshot

# 否则走 Playwright MCP（三平台可用，需用户在设置里安装）
```

headless 用的是一套**独立的登录态**，第一次用要单独登录一次。这件事必须问用户，不要自己扫码。

## 硬边界

**上传视频不能用内置浏览器。** 文件是通过页面脚本以 base64 内联进去的，12 MiB 硬上限。视频动辄几十上百 MB，会直接报错。这不是可以调大的参数 —— 再大就撞管理 API 的 body 上限和 webview 内存。视频发布走 headless。

**心跳里不碰浏览器。** 见 `05-PUBLISH-POLICY.md`。内置浏览器在无人值守时开不起来，headless 能开但没有当次确认，两者都指向同一个结论：**巡检只读本地数据，发布等用户回来。**

## 登录

- 内置浏览器：用户在 Chat 一侧的面板里自己登录，你只管确认登录成功（`browser read` 能看到账号页而非登录页）
- headless：需要单独登录。**必须问用户**，不要自己走验证码流程
- 任何情况下不替用户输入密码、不保存密码

## 失败怎么处理

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `a Chat session is required to open one` | 无人值守，或 Chat 不可见 | 换 headless；心跳里则直接放弃 |
| `Target is not a file input and contains none` | 站点用自定义按钮直调系统选择框 | 请用户手动选文件，不要假装成功 |
| `File is N MiB, over the 12 MiB limit` | 视频 / 超大图 | 换 headless |
| `Timed out waiting for the browser panel to open` | 用户没允许，或面板被关 | 先问用户；明显是无人值守/面板起不来时换 headless |
| headless 打开是新用户 | profile 隔离 | 让用户登录一次，记住是哪个工具登录的 |

**换 fallback 要说明。** 不要静默从内置切到 Playwright —— 用户会以为还是他自己那个已登录的窗口，结果看到的是另一个身份。一句话交代：「内置浏览器打不开，改用 Playwright，它没有你的登录态」。

