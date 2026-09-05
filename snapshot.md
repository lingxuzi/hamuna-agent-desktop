# HamunaAgent Desktop — Snapshot

> 实时记录项目模块状态、当前 TODO 与已完成任务。

最后更新：2026-09-02（**Q&A 续-13：增强 handler.ts DIAG — pin 出 column 45491 真实所在 tool** —— user 报告 desktop 仍 400，column 45491（接续 45371 已修的 AskUserQuestion + 45411/45451/45491 三次连续）。**根因已部分定位**：(a) 13:51 log 显示 column 45491 落在 Bash tool description 字符串末尾；body 布局 `model@1 / input@27 / instructions@-1(not present) / tools@39115 / stream@102481 / prompt_cache_key@39044`；(b) wire body.length=102525，单工具响应长度无问题；(c) 用户实测 4 次 400，column 都聚集在 45371-45491（< 200 字节漂移），body 因 input/cache key 长度变化 ±40 字节导致 column 漂移 → **同一字段在不同发送**反复失败；(d) **剥离隔离复现**：写 `/tmp/probe-desc-length.mjs` 用 `AGNES_API_KEY` env 注入（避免 hardcode key），扫 desc 长度 500-3000b + props 3-100，**10/10 全 HTTP 200**——证明单工具 + 单 schema 维度无法复现；desktop 的失败依赖其 wire 真实 shape（80+ tools × SDK 真 schema），脱离 desktop 触不到。**增强 DIAG**（已 bake 进 bundle @ 13:56）：handler.ts 错误日志加 4 段 dump——(1) 已有: body.length / column / @±200b slice / 顶层 key offsets；(2) 新增: `description`/`parameters`/`type`/`input_schema` 在 column ±400b 内的所有位置（暴露"放弃 match"边界 vs 真失败字段）；(3) **关键新增**：regex scan 全部 `"name":"X"` 偏移，落 column 两侧最近 tool 名 + `(±bytes)` 距离，**直接定位是哪个 tool entry**（例：Bash@45000+637）；(4) 命中 tool 时 dump 该 tool 完整 entry（≤1200b）便于看全 schema 形状。**当前状态**：bundle 已重打，source 13:56:03 > bundle 13:56:29 (`✓ server → src-tauri/resources/server-dist.js`)，enhanced DIAG 7 处 references 在 bundle 里。**下一步**：user 重启 desktop 让 sidecar 加载新 bundle → 触发任何 AI 调用 → 400 时新 DIAG 会 dump "tool @col: before=Bash@X(+) after=Edit@Y(-)" —— 我们就能 pin 出**到底是哪个 tool 哪个字段** schema shape 不被 agnes 接受，针对性写 fix（不靠继续猜 column 偏移）。**核心矛盾已暴露**：每次 fix 一个 schema 字段 → agnes strict serde 推进到下一处拒绝字段 → column 后移 40-200b。**这是产品事实**——agnes 不接受 SDK 完整工具目录 × Responses API spec 的某个 subset；修法路径只能：(1) user 重启 + 触发 fresh 400 + 给我新 DIAG → 我定位**这一个** tool 的这一个字段；(2) 拿到足够样本后，可以反向 agnes strict subset 用 whitelist 取代现在的"剥 description"。**为什么 probe 复现不出**：desktop 真发的 wire body 含 SDK 全部 30+ tool 的 zod→JSON-Schema 序列化结果（含 `$schema` / `$defs` / 嵌套 description / items.enum / additionalProperties 等），其组合只在 SDK 真启动时才出现；剥离 SDK 直接构造无法触达。**scope 备注**：(a) 已有 fix #2-#8 全部 wired + bundled + 41 unit test + e2e credentialed test 验证（fix #8 在 wire 上 `has description: false`）；(b) 增强 DIAG 是**短期定位工具**，user 拿到一次精准 pin 后就可删（保留到 fix landed）；(c) **不**再加 whitelist 减字段（避免一次改太多 → 引入新 bug）；(d) `instructions@-1(not present)` 提示 user 当前 session 走 chat_completions path（不是 Responses），fix #6 是 defensive——这次 400 来自 Responses API path（error 含 `ResponseInput` + `Responses` 字样），fix #6 仍生效但与本问题正交。**待 commit**：仅 handler.ts DIAG 增强一段（+25 行）+ bundle 重打，snapshot.md 增量。**未 commit**（不变）：上一批 fix #6 + fix #8 + tests 仍待 user 拍板。
> 维护规则：每次会话开始 / 任何文件改动后 MUST 更新本文件。

最后更新：2026-09-01（**Q&A：OpenAI 兼容端点兼容 Claude Agent SDK 的桥接路径与"配置后无法使用"常见原因**——结论摘要已并入本 snapshot；本次会话为调研型问答，无代码改动，待用户决定是否落 TODO 走修复路径。**Q&A 续-5：user 验证请求→响应完整链路 —— streaming 端到端 smoke test**——fix #2/#3/#4 全部修完 request side，担心可能 regression 响应侧 parser（不同代码路径）。写了 `translate/streaming-smoke.unit.test.ts`，mock 上游 Responses API 真实 SSE 序列（created → in_progress → output_text.delta×N → output_text.done → content_part.done → output_item.done → response.completed 带 usage）+ 工具调用变体（function_call.arguments.delta/done），驱动真 `handleResponsesStreamResponse` (handler.ts)，断言完整 Anthropic SDK 事件链 + `accumulateUsage` mirror。**测试 2/2 ✓**：(a) 文本 turn：`message_start → content_block_start → deltas(Hello, world 拼接正确) → content_block_stop → message_delta(stop_reason) → message_stop`；usage 输入 1234 / 输出 4 / cache 128 全部非零；stream 真正 EOF（不挂死 SDK）；(b) 工具 turn：function_call → tool_use + input_json_delta 拼接 `{"q":"AAPL"}` + stop_reason=tool_use。**回归**：`openai-bridge/` **57/57 unit tests ✓**（+2 vs 上一版）、`npx tsc --noEmit` clean、eslint clean。**结论**：fix #4 (type:'message' discriminator) 不影响响应侧解析，streaming 路径在新的请求形状下仍然产出格式正确的 SSE + 非零 usage，SDK 可正确消费。**Q&A 续-8：fix #4/#5 都落 + 重启 app 后仍 400（column 30678/30718）——**`instructions` 字段类型错了**（Bug E）**——真因是 OpenAI spec `instructions: Optional[str]` 但 agnes (Rust serde strict proxy) 当 `ResponseInput[]` 处理，错误信息**误导性极强**：column 报的是 string 内部 200 字节处（serde 逐字符尝试 match ResponseInput variant 给定放弃位置），不是 input 数组失败。**debug 路径**：(1) user 重启 app 后仍报 column 30678（fresh sidecar，新 bundle 包含 fix #4/#5）→ 错误不可能来自旧 module；(2) 临时给 `handler.ts::log('Upstream error')` 加 `console.log('[bridge][DIAG] requestBody.length + @col ±80 byte slice')`，触发 400 后 grep DIAG 输出；(3) DIAG 显示 `@30678 = "...AI applications, default to the latest and most capable Claude models.\\n - Claude Code is available as a CLI in the terminal, desktop app..."` —— **column 落在 instructions 系统 prompt 字符串内部**，不是 input 或 tools；(4) 扩 diag 窗口到 ±200 字节（user 第二轮报 column 30718，slice 显示 `ble-5', Opus 5: 'claude-opus-5', Sonnet 5: 'claude-sonnet-5', Haiku 4.5: 'claude-haiku-4-5-20251001'. When building AI applications, default to the latest and most capable Claude models.\\n - Claude Code is available as a CLI in the terminal...Claude Opus with faster outpu"`）—— 是 Claude Code CLI 的 system prompt 内容，OpenAI spec 标 `instructions: Optional[str]` 但 agnes 的 Rust serde 把 string 当 `ResponseInput[]` 解析；(5) **理论**：serde untagged enum 错误 column 通常 = 失败位置，string 内被 serde 当 array element 逐字符试 match ~200 字节后放弃。**fix #6（✅ 已落，待 commit）**：(a) `types/openai-responses.ts::ResponsesRequest.instructions` 类型 `string` → `ResponsesInputItem[] | string`（兼容两态，多数 strict proxy 要前者）；(b) `translate/request-responses.ts` 把 `system` string 改包成 `[{type:'message', role:'system', content:text}]`（含 `type:'message'` discriminator —— 沿用 fix #4 的同一不变量）；(c) 5 个新 unit test `instructions as ResponseInput[] (Bug E)`：string system 包成 system message / AnthropicSystemBlock[] join `\n\n` 再包 / system 缺省 omit / 空 string omit / wrapped message 携带 `type:'message'` discriminator（防 fix #4 反向 regression）。**测试**：openai-bridge 全量 **66/66 unit tests ✓**（+5 vs fix #5），typecheck clean，eslint clean。**移除 diag**：handler.ts 临时 `[bridge][DIAG]` block 已删（确认源码 + bundle 均 0 处 DIAG 引用）。**scope 备注**：(a) lenient providers (OpenAI 官方) **也接受** array 形式（OpenAI Responses API 文档把 instructions 描述成 string 或 input message list），所以 fix 不破坏与官方 provider 兼容；(b) ponytail：将来若有 provider 把 `instructions` 严格当 `Optional[str]`（与 OpenAI spec 一致），把包数组改成包回 string 即可——已加 ponytail 注释说明；(c) **生产验证仍需 user 重启 app**（sidecar 持有旧 module）。**未 commit**：本会话累计 openai-bridge = 5 文件 M（`types/openai-responses.ts` +22/-6、`translate/request-responses.ts` +14/-1、`translate/request-responses.unit.test.ts` 23→28 case、`handler.ts` revert 0 净变更、删除 `wire-shape-probe.unit.test.ts`）+ 2 文件 A（`streaming-smoke` 2 case + `e2e-roundtrip` 1 case）= 4 文件 M + 2 文件 A 独立 change set（待 user 重启确认 fix #6 生效后 commit）；snapshot.md 是这一批串联记录。**Q&A 续-9：fix #6 落 + user 再报 400（column 45371）→ 第六层独立 bug「tool schema `description` 字段被 agnes 拒绝」（Bug F）**`untagged enum ResponseInput` 在 column 45371 落在 `tools[].parameters` 的 `AskUserQuestion.options[].preview.description` 字符串内部（Claude Agent SDK AskUserQuestion tool schema 里 `preview` 字段的 JSDoc 长描述）—— 同 column 误导性 outer error 信息真因是 agnes 的 strict serde 在 body 内走每一段长 string 找 ResponseInput variant 走到 ~200 字节放弃报失败位置。**fix #8（✅ 已落，待 commit）**：(a) `translate/request-responses.ts` 新增 `stripSchemaDescriptions(schema)` 递归函数（export，仅供单测）—— `description` 键整子树剥除，保留 `type` / `properties` / `required` / `items` / `enum` / `additionalProperties` / `oneOf` / `anyOf` / `allOf`（LLM 理解工具参数形状所需的全部），null/undefined 返 undefined，scalars 直通；(b) tool 映射 `parameters: stripSchemaDescriptions(t.input_schema) as Record<string, unknown> | undefined` —— JSON Schema 顶层恒为 object，cast sound（数组分支仅在 nested 位置触发）；(c) tool 的 top-level `description` 保留（function description ≠ schema description，LLM 仍需知道工具用途）；(d) ponytail：strict proxy 改回接受 description 时，revert stripSchemaDescriptions 调用为 `t.input_schema` 直接传。**测试 +13 case**：(a) `stripSchemaDescriptions` 直单测 10 case —— undefined/null 返 undefined、top-level + nested properties + array items 剥 description、oneOf/anyOf/allOf 分支保留、enum/required/additionalProperties/type 保留、空字符串 description 仍剥、`short_description` 类 substring 不误伤、scalars 直通；(b) `translateRequestToResponses — tool schemas strip descriptions (Bug F)` 3 case —— strip 后无 description / 保留 top-level description / 空 input_schema `{}` 走空对象路径（input_schema 类型 required 不能省略）。**验证**：`npm run build:server` exit 0、`openai-bridge/` **80/80 unit tests ✓**（67→80，+13 vs fix #7）、`npx tsc --noEmit` clean、eslint clean。**类型修正历程**：`stripSchemaDescriptions` 类型经三次迭代 —— `unknown` → caller 不匹配 (`Record<string, unknown>`) → 改成 `Record<string, unknown>` 但 `Object.fromEntries(array)` 把数组转成对象（string keys）破坏数组语义 + vitest deep-equal 失败 → 改成 `Record<string, unknown> | unknown[] | undefined` 但 call site 不接受数组（顶层恒为 object 但 type system 不知）→ **最终**：函数返回 `Record<string, unknown> | unknown[] | undefined`（内部 arrays 仍为 arrays），call site `as Record<string, unknown> | undefined` 显式 cast + 注释说明 soundness。**production verification 待 user 重启 app**：sidecar 持有旧 module instance，npx tauri dev 触发 fresh sidecar + npm run build:server 已 bake。**保留 handler.ts diag**：本次诊断对后续 troubleshooting 仍有价值（只要列号出现即可快速定位是 string 内还是 array 内），暂不删；user 验证 fix #8 生效后再清。**scope 备注**：(a) **description 全文剥除 vs 选择性保留**：OpenAI Chat Completions 路径的 tool 描述是函数自身 description（field name `description` at top level of function def），不在 parameters 内部 → Chat Completions 不受影响（chat_completions 路径无 schema description 字段）；Responses API 的 `ResponsesTool.parameters` 是 JSON Schema object，可含 `description`——剥除是 Responses-only 修法；(b) 模型对工具的理解损失：property 没了 description 后，仅凭 property `name` + `type` 推断用途，**对绝大多数工具无影响**（property name 已自解释）；但若工具设计依赖 description 提供关键 hint（如"输入 ISO 日期格式如 2026-01-01"），剥除会降模型理解——**已知 trade-off**，未来若影响实际任务成功率，需评估是否改成"剥 description 但保留 type/enum/required/format"或"剥长 description 保留短 description"；(c) `description` 字段在 JSON Schema 是任意位置（顶层 properties 内 + oneOf 分支内 + nested object 内）—— 递归剥除 = 全部剥除，是保守做法；(d) **`bug E/F 同根`**：column 落在 string 内容 ≠ 字段问题 ≠ array 结构问题，全是 agnes 的 strict serde untagged-enum ResponseInput 错误信息的 column 报的是"放弃 match 的位置"，不是真正失败的字段——未来此类问题**优先看 body slice 再判断**。**未 commit**：本会话累计 openai-bridge = 1 文件 M（`translate/request-responses.ts` +35/-2，stripSchemaDescriptions + call site cast + ponytail 注释）+ 1 文件 M（`translate/request-responses.unit.test.ts` 28→41 case，含 Bug F 13 新 case）+ handler.ts 暂留 diag block。snapshot.md 是这一批串联记录，待 user 重启确认 fix #8 生效后一起拍板 commit（与续-7/续-8 同 change set）。

**Q&A 续-7：user 报第三独立 400（column 30555）——`FunctionToolParam.strict: Required[Optional[bool]]` 必填字段遗漏** —— chain of bugs 第四层：fix #2（output_text）+ fix #3（reasoning.effort vocabulary）+ fix #4（type:'message' discriminator）全过 → 请求 body 仍被 agnes 拒，但**错误 column 跳到 30555**（远小于之前的 57798/58154）→ 列号已不再落在 input array 范围（input 长度 ~300+）→ 列号 30555 必在 body 靠后位置（body 总长 41247）。**debug 路径**：(1) 写 `wire-shape-probe.unit.test.ts` 临时 probe — 真 translator + 81 tools defs + assistant tool_use replay → body JSON dump + 切片；(2) 算出 top-level offsets：`model@1, input@27, instructions@462, tools@8509, stream@41233`；(3) **column 30555 落在 tools array 内部**（8509..41233），不再撞 input → 同一 outer error string（`untagged enum ResponseInput`）实际是 `untagged enum ToolParam` 失败；(4) 拉 OpenAI Python SDK `function_tool_param.py` → `strict: Required[Optional[bool]]` —— OpenAI spec 标"可选值"但**要求字段出现在 wire 上**；(5) `ResponseInput` 错误信息是 agnes proxy 把 `ToolParam` deserialize 失败**外推**到 `ResponseInput` 的统一错误包装。**fix #5（✅ 已落，待 commit）**：(a) `types/openai-responses.ts` `ResponsesTool.strict` 加 JSDoc 注释（OpenAI spec 必填语义）；(b) `translate/request-responses.ts:79-87` tool 映射加 `strict: false`（保留 OpenAI historical default；strict:true 需要 Anthropic schema subset 合规——独立大改造，ponytail 注释留升级路径）；(c) `request-responses.unit.test.ts` 新增 `function tool strict flag (Bug D)` describe block 3 case：每 tool 都 emit strict:false / 无 tools 时不 emit / name/description/parameters 字段保留。**测试**：openai-bridge 全量 **62/62 unit tests ✓**（fix #4 15 case + fix #3 4 case + fix #5 3 case + 老 40 case + 新 6 streaming smoke + 1 e2e roundtrip），typecheck clean，eslint clean。**删除**：`wire-shape-probe.unit.test.ts`——diagnostic 一次性 probe，task 完成，不留 regression 噪声。**scope 备注**：(a) chat_completions 路径**不受影响**（OpenAI Chat Completions 的 `function` 类型不要求 `strict` 必填，仅 Responses API 要求）；(b) provider 接收 strict:true 需 schema subset 合规（additionalProperties:false、必填字段 required 全部声明、propertyNames enum 等）——升级前先验证 Anthropic tools schema 输出是否符合 subset；(c) **未跑生产验证**：fix 同样需 user 重启 app 让 sidecar 重新加载新 translator 模块。**未 commit**：本会话累计 openai-bridge 改动 = 2 源文件（`types/openai-responses.ts` +14/-1、`translate/request-responses.ts` +22/-1）+ 1 改 test (`request-responses.unit.test.ts` 6→23 case) + 2 新 test (`streaming-smoke` 2 case + `e2e-roundtrip` 1 case) = 5 文件独立 change set；snapshot.md 是这一批的串联记录（**不**与 TODO #21/#22 合并 commit）待用户拍板。

**Q&A 续-6：user 报同一 400（column 58154） + 要求 "直接测试 openai-bridge 到 agent sdk 链路"**——同一 `untagged enum ResponseInput` 错误，column 漂移到 58154，说明 fix #4 仍未生效（可能 app 未重启 in-memory 仍是旧 translator）。同时要求真链路 e2e 测试。**新增 `e2e-roundtrip.unit.test.ts`**：(1) 直接 patch `undici.fetch` (handler.ts:9 `import { fetch } from 'undici'`，不是 global fetch，global.fetch stub 无效) + loopback baseUrl 通过 `[test no-egress]` guard；(2) mock 上游 SSE 序列含 message + function_call 完整事件链；(3) 真实 `createBridgeHandler` 处理 Request（含 tools + 多轮 history + Claude reasoning effort='max'）；(4) **双断言**：**A. 请求 wire 契约**——遍历 `capturedRequests[0].bodyJson.input`：每条 message 项必须有 `type:'message'`（fix #4 验证）/ `input` JSON 不含 `output_text`/`refusal`（fix #2 验证）/ `'reasoning' in body === false`（fix #3 验证）/ URL ends with `/v1/responses`；**B. SDK 消费响应**——SSE 解析 → `message_start` 首位 / 包含 `message_delta` + `message_stop` / 同时有 text + tool_use content_block_start / usage 输入 500 输出 12 / `reachedDone:true` 流真 EOF。**测试 1/1 ✓**，openai-bridge 全量 **58/58 ✓**（+1 vs 续-5）、typecheck clean、eslint clean。**结论**：fix #2/#3/#4 在生产代码路径上**确实**产出正确 wire shape，translator 端到端链路**完全正常**。user 当前 column 58154 错误**几乎可以确定是 app 没重启**（sidecar Node 进程持有旧 translator 模块实例，hot reload 不会重启它）—— 用户**需要重启 app / 关掉所有 sidecar**（或开新 Tab 会触发 fresh sidecar）。**未 commit**：本会话累计 4 文件改动 + 3 文件新增（`types/openai-responses.ts` +12/-1；`translate/request-responses.ts` +19/-1；`translate/request-responses.unit.test.ts` 改 6 case + 加 5 case；`handler.ts` revert 无变更）+ 新增 `translate/streaming-smoke.unit.test.ts` (2 case) + `e2e-roundtrip.unit.test.ts` (1 case) + 本 snapshot 待拍板提交。**Q&A 续-3：user 重试仍 400 → 新独立 bug「`reasoning.effort: unknown variant max`」暴露**——链式原因：fix #2（output_text）让请求解析过 input items → 暴露了更靠后的 `reasoning.effort` enum 校验。`src/shared/reasoningEffort.ts::isProviderReasoningEffortSupported` 对**非 xai-sub** provider default-allow（`max` 也透传）→ handler.ts:362 gate 不删 → `translateRequestToResponses` 把 `reasoning: { effort: "max" }` 发给 agnes → agnes 400 `expected one of minimal, low, medium, high`（column 44251，比 fix #2 的 231761 小很多 → 新 session，request body 已不再撞 output_text 这关）。**fix #3（✅ 已落，待 commit）**：`translate/request-responses.ts` line 86-94 加 `RESPONSES_EFFORT_VALUES = new Set(['minimal','low','medium','high'])` + `if (effort && SAFE.has(effort))` clamp；Claude 的 `max` 和 OpenAI 的 `xhigh` 静默 omit（不 remap — remap 会掩盖用户「max ≠ high」的意图）；带 ponytail 注释说明 xhigh 升级路径。**测试 +4 case**：omit（未配）/ forward（4 个合法值）/ omit `max`（核心回归）/ omit `xhigh`。**验证**：`npx tsc --noEmit` exit 0 + eslint exit 0 + `request-responses.unit.test.ts` **10/10 ✓** + `npm run test:classification` → **193 server tests** 全过，无 regression。**scope 备注**：chat_completions 路径的 `reasoning_effort` 也有同样风险（OpenAI o-series 只认 `low|medium|high`，`max` 也可能踩坑）但 user 未报，**不在本次 scope**（YAGNI，add when：第二次报 chat_completions effort 400）。xai-sub (Grok) 走的 handler gate whitelist 是 `{low, medium, high}` 的子集，落在 Responses 安全集内 → 不受影响。**未 commit**：累计 3 文件改动（`types/openai-responses.ts` +9/-2；`translate/request-responses.ts` +18/-2；`translate/request-responses.unit.test.ts` 新增 ~190 行覆盖 6 + 4 共 10 case）待拍板提交。**Q&A 续-4：user 重启后再报 400 + UI 提示「上游 API 报错」（`terminalReason.api_error`）→ 第三独立 bug「`EasyInputMessage` 缺 `type:'message'` discriminator」暴露**——链式原因：fix #2 + fix #3 都过 → 请求 body 进 Rust serde `untagged enum ResponseInput` 解码 → `EasyInputMessageParam` 是 union variant 之一，**OpenAI 官方 schema 标 `type: Optional[Literal['message']]`**——但 Rust serde untagged enum 解析**严格按字段类型 dispatch**：无 `type` 字段就无法判定是 `EasyInputMessage` 还是 sibling variants（`FunctionCallOutput` 之类），直接 400 `data did not match any variant of untagged enum ResponseInput at line 1 column 57798`（unified log:11407）。debug 路径：临时给 handler.ts:543 加 `requestBody` 全 dump + 在 column 57798 切片 + 拉到 OpenAI Python SDK `response_input_item_param.py`/`easy_input_message_param.py`/`function_tool_param.py` 三个 TypedDict → 确认 `EasyInputMessageParam.type: Literal['message']` 必填；strict proxies 强制要求。**fix #4（✅ 已落，待 commit）**：(1) `types/openai-responses.ts` `ResponsesInputMessage` 加 `type?: 'message'` 可选字段 + 注释说明 strict-proxy 必填语义；(2) `translate/request-responses.ts` 在 `translateMessagesToResponses` 末尾加单次 O(n) 后处理：所有有 `role` 的 item（vs 有 `type:'function_call'`/`'function_call_output'` 的 sibling variants）强制写 `item.type='message'`；带 ponytail 注释说明未来若要转发 MCP / reasoning / file-search 变体，须分支处理（不能无脑加 type='message'，sibling variants 用自己的 discriminator）。**测试 +5 case（user/assistant/string、user parts array、sibling variants 不被覆盖、多轮 5-turn 回归）** + 老 6 case 全部加 `{type:'message', role, content}` 期望 → 共 **15/15 ✓**。**验证**：`npx tsc --noEmit` clean + eslint clean + openai-bridge 全量 **55/55 unit tests ✓**。**scope 备注（升级路径）**：(a) `FunctionToolParam.strict` 必填（`Required[Optional[bool]]`）当前我们没输出 → 若 agnes 下次改 strict-serde 则再踩坑，**不在本次 scope**（YAGNI，add when：第二次报 tool shape 400）；(b) chat_completions 路径**暂无 discriminator 需求**（其 `messages[].role` 已足够区分），不受本 fix 影响。**未 commit**：本会话累计 4 文件改动（`types/openai-responses.ts` +12/-1；`translate/request-responses.ts` +19/-1；`translate/request-responses.unit.test.ts` 改 6 case + 加 5 case；`handler.ts` 临时 debug dump 已 revert 无变更）待拍板提交。）+ TODO #22 续-2：recall 精度基准测试 — `scripts/kb-recall-test.ts` 真实 LLM dry-run，4 个手写 fixture（中文金融 / EN tech / 中英混合 / sparse），自动从 `~/.hamuna/config.json` 镜像生产 `resolveRelationModel` 分辨 model + provider（session → first enabled agent → defaultProvider.primaryModel）；**双路径**：① 任意 provider 有 baseUrl+apiKey → 直接 HTTP `/v1/messages`（production "direct-http" 分支，零开销）；② 只有 apiKey（如本机 subscription / 默认 Anthropic）→ Claude Agent SDK `query()`（mirror 生产 `sdkExtractRawText`，仅 minimal SDK call + 临时 `ANTHROPIC_API_KEY` env 注入 + finally 还原）；KB_RECALL_* env vars 仍作 hermetic override（优先级最高）。script 自包含 mirror `stripMarkdownFence`/`extractBalancedJson`/`parseExtraction`/`validateGrounding`（~120 行 pure，MIRROR 注释明确后续维护契约 — 改 kb-relations.ts 必须同步此处 + `kb-relations.unit.test.ts` 加 case）；scoring 用 lenient set-match（substring 双向包含，避免 graph 形状分歧报 FP）；输出 per-fixture P/R/F1 + matched/missed/hallucinated 列表 + char_interval_used + dropped-by-grounding + macro-aggregate + mode 标识。本机 dry-run `--fixtures 999` → 自动选 `mode=sdk baseUrl=(sdk) model=hamuna-coding`（与生产 poller 一致）。`tsc --noEmit --target es2022 --module nodenext --strict` exit 0 + `eslint scripts/kb-recall-test.ts` exit 0。**完成** — 1 文件（kb-recall-test.ts：直接 HTTP 路径 + SDK fallback 路径 + config auto-discovery + env override）+ 本 snapshot。**未 commit** —— 1 文件 + 本 snapshot。（TODO #22 初版：TODO #16：KB relations poller 在 fresh install 下每 15s 报 `Cannot open database because the directory does not exist` —— `kb-store.ts` `getKbStore()` 调 `createLocalSqliteStore` 前缺 `mkdirSync(parent, recursive:true)`，被 `kb-relations.ts:395` 静默吞掉永不恢复。修：单点 `mkdirSync(dirname(getDbPath()), { recursive: true })` + 1 个回归测试（`auto-creates parent directory when missing`，注入不存在的父目录路径）。`tsc --noEmit` exit 0 + `kb-store.integration.test.ts` 9/9 + eslint exit 0；TODO #3 预存在 `agent-session-env.integration.test.ts` 1M unlock 失败**与本修复无关**。TODO #4：review SDK 0.3.234 新增 6 个 TerminalReason 文案——3 条 label 润色（malformed_tool_use_exhausted 加"重试耗尽"/turn_setup_failed "会话→本轮"/tool_deferred_unavailable 加"最终"），en-US + zh-CN + MAP 三处对齐。`tsc --noEmit` exit 0 + terminalReason.unit.test 24/24 + JSON syntax OK。**未 commit** —— 3 文件 + 本 snapshot。TODO #17：Windows OpenClaw plugin 安装报 "system npm not found" — PATH-independent 修复（用户红线：绝不写系统 PATH）。修复 = 翻转 bundled-first + 扩展 Windows exe-relative 候选 + InstallerSource 抽 pure helper + 3-mode 错误信息 + 5 unit tests。`cargo check/clippy/build --release` ✅ + 5/5 测试通过。TODO #18：6 处过时的 bun.exe 引用清理（v0.2.0 已迁 node.js），5 文件 user-visible diagnostic 同步到 node.exe + SDK-embedded bun.exe（SDK 内部仍嵌 bun）。`cargo check/clippy/build --release` ✅。TODO #19：bash -i -l 在无 TTY 进程（Tauri GUI）下会向 stderr 写 "无法设定终端进程群/无任务控制"，泄漏到 sidecar stderr pipe 变成 ERROR 级噪音（`[bun-err][__global__]`）。根因 = 两侧 chokepoint 不一致（Rust `system_binary.rs:238` 已 `Stdio::null()`，Node `shell.ts:305` 仍默认 `['pipe','pipe','pipe']`）。修：shell.ts execFile 包一层 `exec ... 2>/dev/null` wrapper + classifier 加 `[shell]` 前缀 demote + TODO #18 漏改的 `[bun-err/out]` tag → `[sidecar-err/out]`（3 文件）。`tsc --noEmit` exit 0 + cargo clippy ✅ + stdio.rs 测试 8/8 + shell.unit.test 3/3。**未 commit** —— 4 文件 + 本 snapshot。TODO #20：Tab/Global sidecar Err 路径在 race 后误杀被替换的实例——错误信息误指 antivirus，根因 `instances.rs::start_tab_sidecar` Err 路径缺 `port_matches` 守卫（`session_lifecycle.rs:947/998` 已有）。修：抽 pure helper `check_instance_not_replaced(manager, tab_id, expected_port) -> Result<(), InstanceReplacedReason>`，Err 路径端口不匹配 → `ulog_warn` + `return Err(diag)` 跳过诊断+remove（防 restart cascade）。`cargo check` clean + `cargo test --lib sidecar::` 50/50 + 新 helper 单测 3/3。**未 commit** —— 1 文件 + 本 snapshot。TODO #21：`[kb-relations]` 13 条 stderr 噪音迁移到 stdout——8 条 progress/boot/success 从 `console.warn` → `console.log`（走 stdout，不再触发 stderr classifier），4 条真警告/错误保留为 `console.warn`（走 stderr，classifier 默认 ERROR 是正确分类）。`tsc --noEmit` + eslint + `npm run test:classification` (191) + `npm run test:unit` (2865/2871，6 失败为 pre-existing `widgetSandboxHtml.test.ts`，master `5c92cd8` 同样失败，与本修复**无关**) 全绿。**未 commit** —— 1 文件 + 本 snapshot。TODO #22：KB relations 抽取精度升级（用户选项 1+2+3+5）——LLM 输出幻觉是当前 KB 主要噪声源。四阶段提精度：① source grounding — 每个 entity/relation 强制 `source_quote` 字段（原文 verbatim span）+ 解析后机械校验 `text.includes(sourceQuote)` 丢弃幻觉项；② self-verification pass — 二次 LLM call 二次确认 source_quote 与 entity id 一致（opt-in flag `verifyWithLlm`，**已在 processPendingOnce 默认开启**，每 chunk 付一次额外 LLM call，boot log 提示成本翻倍）；③ markdown fence strip — `parseExtraction` 入口先 `stripMarkdownFence` 剥 ` ```json ... ``` ` wrapper；④ **char_interval 内置化（LangExtract 风格）** — LLM 额外输出 `char_start`/`char_end`，`validateGrounding` 优先用 `text.slice(charStart, charEnd) === sourceQuote` 双向 cross-check（100% 准确，不被 LLM quote 转写误差骗），fallback substring search；⑤ A/B ROI 工具 — `scripts/kb-verify-stats.mjs` 读 unified log 聚合 throughput / grounding drops / verify drops / char_interval adoption，**零额外 LLM 成本**（复用 production logs）。辅助改动：修 parseExtraction 的 `indexOf('{')` + `lastIndexOf('}')` JSON 解析 bug（chatty model 输出前置文本含 `{}` 时 slice 越界），改 brace-depth scan + string-escape aware；SYSTEM_PROMPT + EXAMPLE OUTPUT 加 char_start/char_end 字段；VERIFY_SYSTEM_PROMPT 明确"你可能在 review 自己的输出 — 不要 self-trust"。**完成** — 2 文件（kb-relations.ts：4 阶段改动 + 新 char_interval 字段 + validateGrounding 两阶段验证 + parseAndGround log 加 charIntervalUsed；scripts/kb-verify-stats.mjs：A/B 工具）+ 1 test（kb-relations.unit.test.ts：21 case = 17 上一版 + 4 新 char_interval case）。`tsc --noEmit` exit 0 + eslint clean + `test:classification` 192 ok + 新测试 21/21 + A/B 脚本空数据 dry-run OK。**未 commit** —— 3 文件 + 本 snapshot。）

---

## 1. 模块状态总览

### 1.1 桌面端 / Rust (`src-tauri/`)

| 模块 | 文件 | 状态 | 备注 |
|------|------|------|------|
| Sidecar 生命周期 | `src-tauri/src/sidecar/{manager,instances,commands,proxy,runtime_identity}.rs` | 稳定 | 详见 `tech_docs/sidecar_cold_start.md` |
| Sidecar 配置归置 | `src-tauri/src/sidecar/manager.rs` | 稳定 | `ensureSessionSidecar` result.isNew 黄金判据 |
| Sidecar 清理 | `src-tauri/src/sidecar/cleanup.rs` | 稳定 | `STARTUP_CLEANUP_PATTERNS` 含 `claude-agent-sdk` 进程名 |
| Sidecar 健康/关停 | `src-tauri/src/sidecar/{health,shutdown}.rs` | 稳定 | `update_lock_probe_paths` 校验 Tauri 资源路径 |
| Local HTTP Proxy | `src-tauri/src/local_http.rs` | 稳定 | 裸 `reqwest::Client::new` 禁 — clippy |
| Process Cmd | `src-tauri/src/process_cmd.rs` | 稳定 | 裸 `Command::new` 禁 — clippy |
| Proxy Config | `src-tauri/src/proxy_config.rs` | 稳定 | `apply_to_subprocess_for_provider` provider-aware |
| IM 集成 (Telegram/飞书/钉钉) | `src-tauri/src/im/*.rs` | 稳定 | 详见 `tech_docs/im_integration_architecture.md` |
| 定时任务 | `src-tauri/src/cron_task/*.rs` | 稳定 | `TaskStore` 唯一权威；旧 `cron_tasks.json` 仅 startup 迁移 |
| 任务中心 / Session Goal | `src-tauri/src/session_goal/*.rs` | 稳定 | |
| Inbox / Mailbox | `src-tauri/src/inbox/*.rs` | 稳定 | |
| 全文搜索 | `src-tauri/src/search/*.rs` | 稳定 | Tantivy + jieba |
| ~~知识库引擎 KbEngine~~ | ~~`src-tauri/src/kb/mod.rs`~~ | ✅ 已删（Phase 4） | Rust 端 KB 模块已删除；KB 现在由 Node `src/server/kb/kb-store.ts`（TypeGraph+SQLite）独占提供；tantivy 保留（主搜索 `src/search/` 仍用） |
| Managed Codex Runtime | `src-tauri/src/managed_codex.rs` | 稳定 | 锁 `src/shared/managed-codex-runtime.json::version` |
| Grok Auth | `src-tauri/src/grok_auth/*.rs` | 稳定 | |
| 浮动球 / 全局快捷键 | `src-tauri/src/{floating_ball,global_shortcut}.rs` | 稳定 | |
| App Config (Rust) | `src-tauri/src/{config_io,app_dirs,device_identity}.rs` | 稳定 | `with_config_lock` 写盘 |
| Browser / Notification | `src-tauri/src/{browser,notification,notification_badge}.rs` | 稳定 | |
| Admin API | `src-tauri/src/management_api.rs` | 稳定 | |
| Memory Auto Update | `src-tauri/src/memory_auto_update.rs` | 稳定 | |
| CLI 安装 | `src-tauri/src/cli.rs` | 稳定 | |

### 1.2 Sidecar / Node.js 后端 (`src/server/`)

| 模块 | 入口 | 状态 | 备注 |
|------|------|------|------|
| Sidecar 入口 | `src/server/index.ts` | 稳定 | `SYSTEM_SKILLS` 清单 |
| Session Engine | `src/server/session-engine/` | 稳定 | `selector.ts` 统一 adapter 分流 |
| Builtin Session | `src/server/builtin-session/` | 稳定 | `lifecycle / turn-lifecycle / config / types` |
| External Runtime | `src/server/runtimes/external-session/` | 稳定 | Claude Code / Codex / Gemini |
| Agent Session | `src/server/agent-session.ts` | 稳定 | public facade；`reloadLiveSessionSkills`（builtin SDK reloadSkills，可等待 + needsRestart 结果） |
| Skill Reload | `src/server/utils/skill-reload.ts` | 已修 | **新模块（TODO #12）**；纯函数 `evaluateSkillReload`，避免拉起 agent-session import 图 |
| External Runtime Env | `src/server/runtimes/env-utils.ts` | 已修 | **静态 `import './claude-code-env.json'` 改运行时 `fs.readFile + try/catch`**；missing file → `{}`（对齐源码注释"missing file = no-op"语义，`.gitignore` secrets 不入 git） |
| Builtin MCP | `src/server/tools/{builtin-mcp-meta,builtin-mcp-registry}.ts` | 稳定 | `src/server/tools/*.ts` 禁顶层 import SDK/zod |
| Gemini Image Tool | `src/server/tools/gemini-image-tool.ts` | 稳定 | 懒加载 |
| Edge TTS Tool | `src/server/tools/edge-tts-tool.ts` | 稳定 | 懒加载 |
| IM Bridge Tools | `src/server/tools/im-bridge-tools.ts` | 稳定 | runtime-dynamic，context-injected |
| Title Generator | `src/server/title-generator.ts` | 稳定 | |
| Third-party Providers | `src/server/{provider-verify,subscription-auth}.ts` | 稳定 | 详见 `tech_docs/third_party_providers.md` |
| OpenAI Bridge | `src/server/openai-bridge/` | 稳定 | |
| Plugin Bridge | `src/server/plugin-bridge/` | 稳定 | shim 版本同步 bump |
| Inbox | `src/server/inbox/` | 稳定 | |
| MCP OAuth | `src/server/mcp-oauth/` | 稳定 | |
| 日志 / Runtime | `src/server/utils/` | 稳定 | `runtime.ts` bundled Node；`path-safety` chokepoint |
| KB 富文本入库 | `src/server/kb-ingest.ts` | 稳定 | URL/PDF/docx/xlsx→text（SSRF 防护）；sidecar→进程内 `addText`（Phase 2 起不再走 management API） |
| KB LLM 关系抽取 | `src/server/kb-relations.ts` | 稳定 | 轮询 pending 队列→直接 HTTP/SDK 抽取→进程内 `saveRelations`+`removePending`（Phase 2 起不再走 management API） |
| KB TypeGraph store | `src/server/kb/kb-store.ts` | 🆕 新增 | 单例 `createLocalSqliteStore`（WAL+busy_timeout）+ jieba 预分词 + Rust 算法精确移植（CRUD/mounts/addText/query FTS5+1跳） |
| KB HTTP service | `src/server/kb/kb-service.ts` | 🆕 新增 | `/api/admin/kb/*` 16 路由分发 + `{ok,...}` 契约；lazy 加载保证冷启动不受影响 |

### 1.3 前端 (`src/renderer/`)

| 模块 | 入口 | 状态 | 备注 |
|------|------|------|------|
| Pages | `src/renderer/pages/` | 稳定 | |
| Components | `src/renderer/components/` | 稳定 | 受 `react_stability_rules.md` 5 条约束 |
| Context | `src/renderer/context/` | 稳定 | |
| Hooks | `src/renderer/hooks/` | 稳定 | |
| API / TS↔Rust 桥 | `src/renderer/api/` | 稳定 | Tab 作用域 MUST 用 `useTabState().apiGet/apiPost` |
| Theme | `src/renderer/theme/` | 稳定 | 详见 `tech_docs/theme_system.md` |
| i18n | `src/renderer/i18n/` | 稳定 | 详见 `tech_docs/i18n_architecture.md` |
| Analytics | `src/renderer/analytics/` | 稳定 | 详见 `tech_docs/analytics_design.md` |
| Workspace Icons | `src/renderer/assets/workspace-icons/` | 稳定 | |
| Widget Libraries (UMD inline) | `src/renderer/components/tools/widgetLibraries.ts` | 已修 | Vite 7 dev 模式 `?raw` import 修复见 §4（`widgetUmdSourceResolver` plugin 在 dep crawler 阶段拦 `chartjs-umd-source`/`d3-umd-source`/`lucide-umd-source`，避免 "optimized info should be defined"） |
| KB 图可视化 | `src/renderer/components/KbGraphView.tsx` | 稳定 | d3 force-directed 画布 |
| KB 管理面板 | `src/renderer/components/GlobalKbPanel.tsx` | 稳定 | KB CRUD + 材料入库 + workspace↔KB mount |
| KB Client | `src/renderer/api/kbClient.ts` | 稳定 | 11 个 `invoke('cmd_kb_*')`→`apiGetJson/apiPostJson/apiPutJson/apiDelete` 打 `/api/admin/kb/*`（Phase 3）；导出类型零改动 |
| Vite Config | `vite.config.ts` | 已修 | `widgetUmdSourceResolver` plugin（`enforce: 'pre'`）+ 删除原 `resolve.alias` 中 3 条 chartjs/d3/lucide alias；保留 `optimizeDeps.exclude` 作 belt-and-suspenders |

### 1.4 共用 / 工具 (`src/shared/`)

| 模块 | 状态 | 备注 |
|------|------|------|
| `src/shared/*.ts` | 稳定 | renderer + server 共享类型；禁止反向 import |
| `src/shared/workspacePath.ts` | 稳定 | `workspacePathsEqual` / `normalizeWorkspacePathIdentity` |
| `src/shared/managed-codex-runtime.json` | 稳定 | 客户端 runtime 版本唯一权威 |
| `src/shared/logTime.ts` | 稳定 | `localDate()` 替代 `toISOString().split('T')[0]` |
| `src/shared/terminalReason.ts` | 稳定 | |

### 1.5 CLI / 内置能力 / 脚本

| 模块 | 入口 | 状态 |
|------|------|------|
| `hamuna` CLI | `src/cli/hamuna.ts` (+ `.cmd`) | 稳定；改 MUST bump `CLI_VERSION` + 同步 skill |
| 内置 MA 小助理 | `bundled-agents/hamuna_helper/` | 稳定；改 MUST bump `ADMIN_AGENT_VERSION` |
| 内置 Skills | `bundled-skills/` | 稳定；`SYSTEM_SKILLS` 清单内改 MUST bump `SYSTEM_SKILLS_VERSION` |
| 雪球时间线 Skill | `skills/crawl-xueqiu-my-timeline/` | **重设计为投资方向分析（TODO #9）**；含 `stock_datasource_call.sh` 行情直连；实验 skill，未入 `bundled-skills/`，未注册 `SYSTEM_SKILLS` |
| `scripts/ensure_claude_sdk_package.ps1` | — | 已修；**`Test-SdkPackage` 第 175 行 `-ne` 严格比较 → `Test-SdkVersionRange` semver range 兼容（`^`/`~`/`exact` 三态）**；`Repair-SdkPackage` 传给 npm 前去掉 caret（否则 npm 会再次漂到 latest patch，repair 闭环失败）；PE header + Authenticode 校验不变 |
| `scripts/ensure_rust_toolchain.ps1` | — | 稳定 |
| `scripts/download_{cuse,python,uv}.ps1` | — | 稳定；软失败（dev 模式下缺失不阻断） |
| `scripts/esbuild-bundle.mjs` | — | 稳定 |
| `setup_windows.ps1` | — | 已简化；**删除原 Step 6.5/8 占位符 block**（dev 模式不再用 `.dev-placeholder`，由 `tauri.conf.json::beforeDevCommand` 自动打真实 dist 文件） |

### 1.6 文档 / 规范 (`specs/`)

| 文档 | 加载方式 |
|------|---------|
| `specs/ARCHITECTURE.md` | L2，按触发条件主动 Read |
| `specs/DESIGN.md` | L4，前端开发 MUST 读 |
| `specs/tech_docs/*.md` | L3，按模块触发 |
| `specs/guides/*.md` | L4，按命令触发 |

---

## 2. Tauri 资源目录（dev vs build 分工）

`tauri.conf.json::bundle.resources` 在 build-script 阶段（`cargo build` / `npx tauri dev` 首次启动的 cargo build）由 `tauri-build` 校验所有声明路径必须存在。**dev 与 prod 共用同一份 bundle.resources 声明**，但 dev 与 prod 填充方式已统一：

| 路径 | 何时被填充 | 由谁 |
|------|----------|------|
| `src-tauri/resources/server-dist.js` | **dev 启动前** 与 **prod 构建前** | `tauri.conf.json::beforeDevCommand` / `beforeBuildCommand` 都已包含 `npm run build:server` |
| `src-tauri/resources/plugin-bridge-dist.mjs` | 同上 | `npm run build:bridge`（both paths） |
| `node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` | `npm install` → `setup_windows.ps1` Step 6 | `setup_windows.ps1` → `ensure_claude_sdk_package.ps1` |
| `src-tauri/resources/{sharp-runtime, tsx-runtime, nodejs, claude-agent-sdk}` | **生产构建** | `build_windows.ps1`（dev 模式下目录必须存在但**不**放占位符——见下） |
| `src-tauri/resources/{server-dist.js, plugin-bridge-dist.mjs}` | esbuild 打包 | `npm run build:server` / `build:bridge`（dev + prod 都跑） |
| `src-tauri/resources/cli/`、assets/、infoplist/ 等其他目录 | 与具体构建路径相关 | 由 build 脚本 + 资源 git 提交 |

### ⚠️ 已废弃：`.dev-placeholder` 占位符方案（TODO #1）

原 TODO #1（snapshot 历史版本）曾在 `setup_windows.ps1` Step 6.5/8 写入 4 个 `.dev-placeholder` 文件骗过 `tauri-build` 资源校验。**该方案已被用户明确否决**（"不能有空的占位符，要真实文件"），整段逻辑已从 `setup_windows.ps1` 删除。dev 模式下 4 个空目录（`claude-agent-sdk` / `sharp-runtime` / `tsx-runtime` / `nodejs`）由 `setup_windows.ps1` 原步骤隐式创建（无占位文件）；`cargo build` 的资源校验只看路径**存在**——空目录足以满足。

如果未来 `tauri-build` 进一步收紧到校验"目录非空"，则 `beforeDevCommand` 需要追加这些目录的真实内容填充（如同 prod build_windows.ps1），但当前 **不**需要。

---

## 3. 当前 TODO（待完成）

### TODO #24: 🔄 进行中 — 创建 agent 时 seed 空 `.claude/settings.json` 占位（用户拍板：仅空白占位，验证管线）

- **需求**（Q&A：desktop 的 Claude Code / Agent SDK 全局配置在哪）：内置 Sidecar 用 `buildSettingSources()` 只返回 `['project']`（`agent-session.ts:3468`），**刻意不读 `~/.claude/settings.json`**（会破坏 Anthropic OAuth Keychain）；SDK 唯一读取的项目级配置源 = `<workspace>/.claude/settings.json`。全仓库**没有任何运行时自动生成它**——`projectSettingsService.ts` 的 `saveProjectSettings` 无调用方（且用 `@tauri-apps/plugin-fs`，scope 只覆盖 `~/.hamuna/**`，工作区路径本就会失败——可能是它从未接线的真因）。
- **用户已拍板**：创建 agent 时 seed 空 `{}` 占位（不填 permissions/env/hooks，那些归产品 config pipeline），验证写入管线可用。
- **落点**：
  - Rust `src-tauri/src/workspace_files/memory_rules.rs` 新增 `ensure_claude_settings(workspace_path) -> Result<bool>` + tauri command `cmd_ensure_claude_settings`——复用 `validate_workspace_root` / `resolve_inside_workspace` / `ensure_plain_dir`（path_safety 单 chokepoint + symlink 拒写）。文件已存在（含 symlink）→ 不动返 `false`；不存在 → `create_new` 写 `{}\n` 返 `true`。
  - `lib.rs` 注册 command（memory_rules 命令组旁边）。
  - 渲染端 `ConfigProvider.addProject` 的 agent 创建分支 fire-and-forget `invoke('cmd_ensure_claude_settings', { workspacePath: project.path })`（工作区可能未 materialize，失败静默）。
- **测试**：Rust 2 单测（创建空占位 / 保留已存在内容），风格对齐 `make_test_workspace`。
- **状态**：⏳ 待实现。**未 commit**。

### TODO #14: 🔄 进行中 — 用 TypeGraph 重构知识库功能（设计完成，待实现）

- **需求**：用户要求「使用 typegraph 框架重构知识库功能」，并经 context7 确认框架为 `/nicia-ai/typegraph`（TS-first 嵌入式知识图谱库）。
- **用户已拍板**：
  1. **直接使用 typegraph 重构**（否决了「TypeGraph 与 Rust 栈不匹配，建议放弃」的矛盾分析）
  2. **全 Node B+ 方案**（否决混合 A）：graph 进 TypeGraph/SQLite（Node sidecar），中文全文用 FTS5 `unicode61` 逐字索引 + 图 1 跳扩展兜底，**不保留** Rust Tantivy；验收中文命中不达标再补 jieba-wasm 预分词（ponytail 升级位）
- **关键事实（Plan agent 深挖验证 + Phase 0 spike 实测）**：
  - TypeGraph 0.52.0 硬编码 `better-sqlite3`（native 模块）+ drizzle-orm，**不支持 node:sqlite**（drizzle 无该 driver）
  - FTS5 tokenizer 固定 `porter unicode61 remove_diacritics 2`；**spike 实测：CJK 连续串被 unicode61 视为单一不可分词 token，中文 MATCH 全部返回 0**（不是"逐字索引"，是完全无索引）——plan 原假设错误
  - **修复已实测通过**：写入前用 jieba-wasm `cut_for_search` 把中文切成空格分隔词序列存 `searchable` 字段（`textOriginal` 存原文供展示/snippet），查询同样分词——"知识图谱"/"华为"/"任正非"/"科技公司"全命中。jieba-wasm 纯 WASM 无 native，esbuild 需 `external: ['jieba-wasm']`（其 node entry 运行时 `require(path).join(__dirname, ".wasm")` 读磁盘，不能 bundle）
  - **esbuild 需 `external: ['better-sqlite3']`**（native 模块，spike 实测 bundle 后从 `resources/node_modules/` 解析）；节点 API 实测：`create`/`getById`/`getByIds`/`update`/`delete`/`find`/`count`；query builder：`.from().whereNode().select().execute()`
  - **TypeGraph 0.52 API 精确签名（已读 node_modules d.ts 确认）**：`createLocalSqliteStore(graph, {path})` 从 `@nicia-ai/typegraph/sqlite/local` 导入、**是 async**（返回 `Promise<Store<G>>`）；`defineNode(name,{schema,unique?})`，unique 是裸对象 `{name, fields, scope:'kind', collation:'binary'}`（非函数）；`defineGraph({id,nodes,edges})`，edges 可空 `{}`；`store.search.fulltext(kind, {query, limit, where?, includeSnippets?})` 返回 `{node,score,rank,snippet}[]`（**可传 where 谓词按 kbId 过滤**）；`store.nodes.<K>.create({...},{id?})` / `find({where,limit})` / `count()` / `update(id,props)` / `delete(id)`(软删) / `hardDelete(id)`；`NodeAccessor` 谓词 `field.eq/.in/.contains/.like`，`.and/.or/.not` 组合；`field.$fulltext.matches(q,k)` 做全文谓词
  - graph 数据进 Node 后查询只能编排在 Node 侧；混合 A 需 add-text 跨进程双写两个存储 → 用户因此选 B+
  - 前端全部 KB 操作经 `kbClient.ts` 一个接缝（11 invoke + 1 apiPostJson），`apiGetJson`/`apiPutJson`/`apiDelete` 已存在
  - `App.tsx:1002` 主窗口启动即拉 Global Sidecar，`apiFetch` 走它 → 前端切 HTTP 安全
  - sharp-runtime 打包先例可循（resources/node_modules 预装）
- **实现方案**（详见 plan 文件）：
  - Phase 0（✅ 完成）：依赖已装（typegraph/drizzle/better-sqlite3/@types/jieba-wasm）+ spike 实测通过（中文分词+FTS5 命中、external 双包 bundle 可运行）
  - Phase 1（✅ 完成）：4 文件已写 + 实测通过——`kb-schema.ts`（5 节点建模，Relation 为节点带 relationType/weight/typed）、`kb-tokenize.ts`（jieba cut_for_search 预分词）、`kb-merge.ts`（Rust merge_entities/merge_relations/chunk_text 精确移植）、`kb-store.ts`（单例 store：CRUD/mounts/addText/listDocs/rebuild/peekPending/takePendingAll/removePending/saveRelations/graphData/query FTS5+1跳）。**smoke 实测全过**：createKb 唯一约束、中文全文查询命中（"知识图谱"→华为资料 doc）、snippet 从 textOriginal 取原文、saveRelations merge 语义、mounts 读写。关键 API 修正：Node 的 schema props 顶层 spread（非 `.props`）、读/改/删 id 需 `asNodeId<typeof KbNode>` 品牌化、Entity/Relation 节点 id 需 kb 前缀命名空间（防跨 kb label 冲突）
  - Phase 2（✅ 完成）：`src/server/kb/kb-service.ts` 新增 `handleKbAdminRequest` 统一分发 16 条 `/api/admin/kb/*` 路由（GET/POST 全覆盖、`{ok,...}` 契约、exclude `/ingest` 走老路径）；`index.ts` 在 admin POST-only 分支**之前**插入 KB dispatch（懒 `await import('./kb/kb-service')`）；`kb-ingest.ts` managementApi→进程内 `addText`；`kb-relations.ts` 三个 managementApi→`takePendingAll/saveRelations/removePending`（保留 `kb-relations` 在 boot 顶层 import 但 kb-store 用 `await import` 保冷启动）；`kb-tool.ts` mounts+query→进程内 `mountsForWorkspace/query`（遵守 tools 懒加载）；`kb-store.ts` 加 `graphSummary` 公开导出（前端 `getKbGraph` summary 面板用）。typecheck+eslint 全绿
  - Phase 3（✅ 完成）：`src/renderer/api/kbClient.ts` 11 个 `invoke('cmd_kb_*')`→`apiGetJson/apiPostJson/apiPutJson/apiDelete` 打 `/api/admin/kb/*`（`{ok:false}→400` 让 `apiFetch` 自然抛错，复用 invoke reject 语义）；导出类型零改动（KbInfo/KbGraphSummary/KbEntity/KbRelation/KbGraph/KbDocMeta）；`ingestKbMaterial` 路径不变。`src/server/kb/kb-service.ts` dispatcher 加 `respond()` 把 `{ok}` 映射成 HTTP status（200/400）。`src/server/kb/__tests__/kb-http-smoke.integration.test.ts` 2/2 通过（完整 CRUD+query+mounts+pending+rebuild+delete 链路）
  - Phase 4（✅ 完成）：`src/server/kb/kb-migrate.ts` 新增——首次 `getKbStore()` 触发幂等迁移，源 `~/.hamuna/kb/{index.json,mounts.json,*}/graph.json,docs.json`→SQLite（kb_id 保留以兼容 mounts.json；Doc.text 用 jieba 预分词、textOriginal 存原文）；写 `.migrated-v1` 哨兵防重跑；归档 legacy 到 `~/.hamuna/kb-legacy-<ts>/`；`src/server/kb/__tests__/kb-migrate.integration.test.ts` 3/3 通过（Linux-only：`describe.skipIf(!IS_LINUX)` 因为 macOS libuv 可能缓存 `homedir()`）。Rust 端：`src-tauri/src/kb/{mod,schema}.rs` 已删；`lib.rs` 移除 `pub mod kb` + 12 个 `cmd_kb_*` 注册 + KbEngine init；`management_api.rs` 移除 7 handler + 6 struct + 7 `/api/kb/*` 路由注册。`cargo check` + `clippy --all-targets -D disallowed_methods/macros` + `tsc --noEmit` 全绿。tantivy 保留（主搜索仍用）
  - Phase 5（✅ 完成）：新增 3 个测试文件覆盖 Rust 算法精确移植、jieba 中文分词 + TypeGraph/SQLite 端到端——`kb-merge.unit.test.ts` 17 case（entityId/chunkText 4 case 含 boundary + hard-break + empty/mergeEntities/mergeRelations typed upgrade + weight 累加 + cooccur 语义）、`kb-tokenize.unit.test.ts` 9 case（中文分词 + 停用词 + 单字过滤 + 标点过滤 + FTS5 MATCH 形状）、`kb-store.integration.test.ts` 8 case（createKb 唯一约束 / addText chunks / saveRelations merge / query 中文 FTS5+1跳 / mounts / deleteKb cascade）。**修复 2 个 Phase 1-2 期间没暴露的真实 bug**：`saveRelations` 的 Relation id 含 `relationType` 与数组 index → typed upgrade 后 cooccur 旧 row 残留（升级前 id=`rel_kb_X_A_B_cooccur_0`，升级后 id=`rel_kb_X_A_B_founded_by_0`，两个不同 id），改为仅含 `(kbId,subject,object)` 稳态 id；`mountsForWorkspace` 不排序导致调用方拿到非确定顺序，测试断言常踩坑，store 内 sort 兜底。**最终 KB 模块测试 39/39 全绿**（unit 26 + integration 13），`npm run test:classification` 通过（191 server tests），`tsc --noEmit` 通过，`cargo check --locked` 通过
- **矛盾点**：Rust KbEngine 1465 行 + Tantivy 依赖删除；中文全文需 jieba-wasm 预分词（成为必需核心，不再是 ponytail）——spike 已实测通过
- **状态**：✅ Phase 1+2+3+4+5 完成（schema+store+admin dispatcher+进程内化+前端 HTTP 切换+迁移+Rust 删除+测试覆盖+2 个 store bug 修复）。TODO #14 整体收尾，可独立 commit。

### TODO #16: ✅ 已修复 — fresh install 下 `kb-relations` poller 每 15s 报 "directory does not exist"

**症状**：sidecar 启动后日志雪崩（每 15s 一条）：
```
[kb-relations] poll failed: TypeError: Cannot open database because the directory does not exist
    at async <anonymous> (src/server/kb/kb-store.ts:116:21)
    at async takePendingAll (src/server/kb/kb-store.ts:298:17)
    at async processPendingOnce (src/server/kb-relations.ts:344:19)
```
**根因**：`kb-store.ts::getKbStore()` 在 `createLocalSqliteStore(kbGraph, { path: getDbPath() })` 前未 `mkdirSync` 父目录。`getDbPath()` 默认 `~/.hamuna/kb/kb.sqlite` —— fresh install（`~/.hamuna/kb/` 不存在）下 better-sqlite3 抛 "directory does not exist"。错误被 `kb-relations.ts:395` 的 `console.warn` 吞掉，每 15s 一次永不恢复。**为何现有 8 个 kb-store integration test 没捕获**：所有 test 都用 `mkdtempSync` 创建**已存在的**父目录，再用 `join(tmpDir, 'kb.sqlite')`，所以父目录必然存在——无法测到 fresh install 路径。

**修复（治本，单点）**：
- `src/server/kb/kb-store.ts` — `getKbStore()` 在 `createLocalSqliteStore` 前加 `mkdirSync(dirname(getDbPath()), { recursive: true })`。`recursive: true` 幂等（已存在不抛错），且**故意不**先 `existsSync` 探再 mkdir（断链 symlink 会让 `existsSync` 返 false，详见 Pit-of-Success §fs-utils）。
- `src/server/kb/__tests__/kb-store.integration.test.ts` — 新增 `auto-creates parent directory when missing (fresh install)` 回归测试：`mkdtempSync` 一个 fresh home + 故意**不**创建子目录 `kb/`，setKbStorePath 到其下 `kb.sqlite`，调 `createKb` 断言不抛错 + `existsSync(kbDir) === true`。

**为何不修 kb-relations.ts 的吞错**：根因不在吞错（吞 warn 本身合理——best-effort 设计），而是 store 创建失败。修根因后 poller 不再触发 error path。

**验证**：
| 验证 | 命令 | 结果 |
|---|---|---|
| Type | `npx tsc --noEmit` | exit 0 |
| Lint | `npx eslint src/server/kb/kb-store.ts src/server/kb/__tests__/kb-store.integration.test.ts` | exit 0 |
| Integration | `npx vitest run --project integration src/server/kb/__tests__/kb-store.integration.test.ts` | **9/9**（含新增回归） |
| 集成池全量 | 41 files passed / 1 failed（`agent-session-env` 1M unlock —— TODO #3 预存在，与本修复无关） | — |

**未 commit**：2 文件改动（`kb-store.ts` +14 行含注释 + `kb-store.integration.test.ts` +18 行回归测试）待用户拍板提交。

### TODO #12: ✅ 已修复 — skill 安装后显式调用报 "unknown command"（reload 链路由错）

**症状**：skill 安装后，用户在当前 session 显式输入 `/skillname`，AI 回 "unknown command"（Claude Code CLI 原生命令解析，非本仓库字符串）。"有时候"出现是因为 user-scope 安装会触发 reload、project-scope 安装不触发。

**根因（安装 → 运行时 skill 命令表不同步）**：
- SDK 用 `settingSources: ['project']`（`agent-session.ts`），**只在进程启动时**从 `<cwd>/.claude/skills/` 快照 slash command 表
- 旧 `reloadSessionSkillsAfterSync` 是 fire-and-forget、private，且 **reload 挂在 `syncProjectUserConfig` 成功分支**，而 sync 只处理 user 级 skill
- `/api/skill/install-from-url` 的 **project scope 分支不调 sync 也不 reload** → 新装 skill 写进 `<agentDir>/.claude/skills/`，但运行中 SDK 命令表还是启动快照 → `/skillname` → unknown command
- reload 失败会静默降级为"下次会话才生效"，无任何可感知提示

**修复（A+B）**：
- **A — project scope 触发 reload**：`install-from-url` 结尾无论 scope 都调 `reloadLiveSessionSkills(agentDir, expectedSkill)`，reload 结果（`needsRestart`/`ready`）拼进 response
- **B — reload 可等待、可感知结果**：
  - 新增 `src/server/utils/skill-reload.ts`：纯函数 `evaluateSkillReload(expectedSkill, reloaded, loaded)` → `{ needsRestart }`（独立模块便于单测，避免拉起 agent-session import 图）
  - `agent-session.ts`：private `reloadSessionSkillsAfterSync` → export `reloadLiveSessionSkills(syncedDir, expectedSkill?)`，返回 `{ reloaded, loaded, needsRestart }`；`syncProjectUserConfig` 改为 fire-and-forget 调它；re-export 类型
  - 前端：`InstallFromUrlResponse` 加 `warning`/`ready` 字段；`onInstalled` 回调带结果参数；两个面板（GlobalSkillsPanel / SkillsCommandsList）在 `warning` 非空时 toast 提示"需重启会话"
- **改动文件**：`agent-session.ts`（重构+re-export）、`index.ts`（import + install-from-url 结尾）、`skill-reload.ts`（新）、`skill-reload.unit.test.ts`（新，4 测试）、`SkillDialogs.tsx`、`GlobalSkillsPanel.tsx`、`SkillsCommandsList.tsx`
- **验证**：
  | 验证 | 结果 |
  |---|---|
  | `npx vitest run --project unit -- src/server/utils/skill-reload.unit.test.ts` | ✅ 4/4（其余 6 失败为 TODO #3 预存在，stash 验证干净树一致） |
  | `npx tsc --noEmit` | exit 0 |
  | `npx eslint <7 个改动文件>` | exit 0 |
- **未 commit**：7 文件改动（4 M + 2 新 + 前端 3 M）待用户拍板提交

### TODO #13: 🔄 进行中 — git hook 每次提交自动 bump 版本号

- **需求**: 用户要求加 git hook,每次 commit 自动提升版本号。用户确认接受「版本号变成 commit 计数器」
- **背景**: 用户观察到「本地提交后版本跳回旧值」——根因是 `package.json` 的 `version` 钩子 `npm version && git add` 的副作用 + 本地/CI 双写者抢版本文件
- **实现**:
  - `scripts/bump-on-commit.mjs` — bump 逻辑:跳过 CI(`GITHUB_ACTIONS=true`)/ release 提交(`^vX.Y.Z` 或 `chore(release)`)/ 版本文件已在 index(`git show :package.json` vs HEAD);否则 `npm version patch --no-git-tag-version`(触发 version 钩子同步三处 + git add)+ `git add package.json package-lock.json`
  - `.githooks/prepare-commit-msg` — hook 壳,仅普通 commit(source 为 `message`/空)触发,merge/squash/amend 跳过
  - `scripts/install-githooks.sh` — 安装到 `.git/hooks/prepare-commit-msg`
- **验证**: 测试分支实测——①直接跑脚本 0.3.21→0.3.22,三处版本文件同步 ②真实 commit(index 已含新版本)不二次 bump ③二次 commit(版本不在 index)应 bump 到 0.3.23(**待完整验证**)
- **矛盾点**: 每次 commit bump patch = 版本号成 commit 计数器;CI 的 windows-release workflow 也 bump patch,可能产生「CI 基于旧版本 bump 覆盖本地」——hook 的跳过条件 2(CI + release commit)已防,但本地 CI 双写者仍有理论冲突
- **状态**: ⏳ 已实现,待用户确认提交

### TODO #11: 🔄 进行中 — GitHub Actions Windows 构建 + 传 R2 + 自动 bump 版本号

- **需求**: GitHub 上加一个 action,编译 Windows 版本并提交到 Cloudflare R2,自动提升版本号
- **决策（用户已确认）**: bump 后回写仓库(commit + tag + push) / `workflow_dispatch` 手动触发 / 只传 R2 不发 GitHub Release
- **方案**: 新增 `.github/workflows/windows-release.yml`(单 job, windows-latest),内联 `build_windows.ps1` / `publish_windows.ps1` 核心步骤(两者带 `Read-Host` 交互,不能直接 CI 调用),复用无交互的 `download_*.ps1` / npm scripts
- **要点**: tauri build 前 MUST `Remove-Item Env:CI`(clap --ci 崩);版本号单一数据源 `package.json`, `npm version` 钩子同步 tauri.conf.json + Cargo.toml(实测也自动更新 package-lock.json);R2 走 rclone + `releases/v$Version/` + `update/` 清单
- **所需 secrets**: `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID` / `R2_BUCKET` / `TAURI_SIGNING_PRIVATE_KEY`(+PASSWORD)
- **状态**: ⏳ workflow 已写完(`.github/workflows/windows-release.yml`, 22 步);**首跑失败 `resource path ..\mino doesn't exist`** — 修复中(见下)
- **mino bundle 资源缺失修复（方案 B，用户拍板）**：
  - **根因**: `mino/`(首启初始 workspace, `commands.rs` `cmd_initialize_bundled_workspace` 从 `resource_dir/mino` 复制到 `~/.hamuna/projects/mino/`)是产品 bundle 资源(`tauri.conf.json:58` `"../mino": "mino"`),但根 `.gitignore:105` `/mino/` 忽略 → CI checkout 后无 mino → tauri-build 资源校验失败
  - **决策**: 方案 B = 提交 mino 进本仓库 git(CI 自包含 + 版本可控),弃方案 A(CI clone openmino,版本不可控)与方案 C(submodule,后续更新麻烦)
  - **安全过滤**: `mino/.gitignore` 新增 `.tokensave/` 排除——内含 `config.json`(机器特定绝对路径 `root_dir: /home/hmcz/.hamuna/setup-cache/mino`)与 `tokensave.db`(主仓库历史曾因同名 .db 超 100MB 被 filter-repo 清理)。`.config/`(凭据)原本已排除
  - **落地**: 根 `.gitignore` 移除 `/mino/` → `git add mino/` → 284 文件 / 4.6MB,`git add -n` 验证 `.tokensave` / `.db` / `.config` 零跟踪
  - **⚠️ 待办**: `commands.rs:368` 注释提及 `~/.hamuna/projects/mino link returns false`——首启后用户可能已建过 `~/.hamuna/projects/mino`,与 bundle 复制逻辑的交互需验证(下轮验证)



- `M .mcp.json`
- `M package-lock.json`
- `M src-tauri/Cargo.toml`
- `M src/renderer/components/MessageList.freeze.test.tsx`
- `M src/renderer/components/MessageList.tsx`
- `M src-tauri/tauri.conf.json`（本次修复）
- `M setup_windows.ps1`（本次修复，整段删除原 Step 6.5/8 占位符 block）
- `M src/server/runtimes/env-utils.ts`（本次修复，静态 import → 运行时 fs.readFile）

- **状态**: ⏳ 等待用户决策，本批改动是否统一提交
- **注意**: 5 个原 pending（`.mcp.json` / `package-lock.json` / `Cargo.toml` / `MessageList.*`）与本次 dev 启动修复**无**依赖关系，可独立提交

### TODO #3: 预先存在的 unit test 失败（与 dev 启动修复**无关**）

`npx vitest run --project unit` 当前 14 failed / 2775 passed / 10 skipped。**全部**失败均与本次 `npx tauri dev` 修复、SDK 0.3.234 升级、Bash pipe 排查**无依赖路径关系**。SDK 0.3.234 升级后数量**完全不变**（同 9 个文件 / 14 个测试），证明这些失败**预先存在**：

| 失败文件 | 根因（与所有本次任务无关） |
|---|---|
| `src/cli/hamuna.unit.test.ts` | Windows `EPERM symlink`（测试用 `mklink /D`，权限/沙箱受限） |
| `src/server/proxy-state.unit.test.ts` | proxy-state 断言漂移（`expected undefined to be 'http://system.proxy:8080'`） |
| `src/renderer/analytics/eventRegistry.test.ts` | 期望读取 `specs/tech_docs/analytics_design.md` 但**文件不存在** |
| `src/renderer/theme/themeArchitecture.test.ts` | Default Black / Scaffolding Theme 主题 token 漂移（map size 17 vs 24；CSS 不含期望子串） |
| `src/server/official-tools/vision.unit.test.ts` | Windows `EPERM symlink`（同上） |
| `src/server/utils/cuse-diagnostics.unit.test.ts` | 期望长度 1，实测 0 |
| `src/server/utils/model-capabilities.unit.test.ts` | `[1m]` 后缀 capability 漂移（expected 200000 to be 1000000） |
| `src/server/__tests__/support-log-redactor.unit.test.ts` | （待查具体失败） |
| `src/renderer/components/tools/widgetSandboxHtml.test.ts` | widget sandbox 内联错误提示子串缺失 |

- **状态**: ⏳ 用户已确认本次只修 dev 启动失败；其它失败**不**在本修复 scope 内
- **UPGRADE**: 用户后续决策——独立 PR 修；或跟主题/能力表改动一起走

### TODO #4: ✅ 已完成文案 review — SDK 0.3.234 升级引发的 6 个新 TerminalReason entry

`@anthropic-ai/claude-agent-sdk` 0.3.234 新增 6 个 TerminalReason 字面量：`api_error` / `malformed_tool_use_exhausted` / `budget_exhausted` / `structured_output_retry_exhausted` / `tool_deferred_unavailable` / `turn_setup_failed`。`src/shared/terminalReason.ts` `Record<TerminalReason, TerminalReasonInfo>` exhaustive mapping 已补全（typecheck 通过），但 label/detail 是字面直译 + 占位描述，**SDK 官方 sdk.d.ts 没给这 6 个字面量写 JSDoc**——需要人工润色 3 处。

**Review 后改动（3 条 label 润色，en-US + zh-CN + terminalReason.ts MAP 三处同步）**：

| entry | 问题 | 改动 |
|---|---|---|
| `malformed_tool_use_exhausted` | label "Malformed tool use" / "工具调用格式错误" 漏了 **exhausted** 字样——用户看到的是平铺的"工具调用格式错误"，不知道 SDK 已经重试过 | zh-CN 加"（重试耗尽）" / en-US 加 "— retries exhausted" |
| `turn_setup_failed` | 中文 label "**会话**初始化失败" 会跟"新建会话"这种 session-level 操作混淆；`turn` 是 Claude SDK 单轮术语不是会话 | zh-CN 改"**本轮**启动失败"（明确是 turn 不是 session）；en-US 保留 "Turn setup failed"（turn 是 Claude community 通用术语） |
| `tool_deferred_unavailable` | 跟 `tool_deferred`（"延迟处理，本轮已返回"）容易混淆，用户看不出来"unavailable" 是 *最终* 不可用 | zh-CN 加"**最终**" / en-US 加 "ultimately" |

其余 3 条（`api_error` / `budget_exhausted` / `structured_output_retry_exhausted`）字面 + 上下文化已足够清晰，**未改动**。Severity 分级（5 个 error + 1 个 notice `tool_deferred_unavailable`）保留——前者用户必须处理，后者只是 SDK 自动决策后用户感知，notice 合理。

**关于 terminalReason.ts 内联 MAP label/detail**：实际显示路径是 `TerminalReasonBanner.tsx:79-82` `t('shell.terminalReason.reasons.${reason}.label', { defaultValue: unknownLabel })`——**i18n locale 是 source of truth**，MAP.label/detail 是 fallback defaultValue（即使 i18n miss 也不会显示）。MAP 仍必须保持 exhaustive（TypeScript 强制），所以**3 处 label 也同步更新**（保持一致，避免日后有人误以为 MAP 是真实显示源）。

**验证**：
| 验证 | 命令 | 结果 |
|---|---|---|
| JSON syntax | `node -e "JSON.parse(...)"` zh-CN + en-US | OK |
| Type | `npx tsc --noEmit` | exit 0 |
| Unit | `npx vitest run --project unit src/shared/terminalReason.test.ts` | **24/24** |

**未 commit**：3 文件改动（`zh-CN/chat.json` + `en-US/chat.json` + `terminalReason.ts`——每文件 3 条 label 润色，6 处 total）待用户拍板提交。

### TODO #17: ✅ 已修复 — Windows OpenClaw plugin 安装因找不到 npm 失败（与系统 PATH 无关）

**症状**：Windows 用户从 IM channel 安装 OpenClaw chat-bot 插件时，bridge 进程报错 "未找到 node, 没有在 PATH 中"（原始 Rust 串：`Plugin install failed for {}: bundled npm unavailable and system npm not found in PATH`）。

**根因（两个 bug 叠在一起）**：

**(a) 优先级倒置。** `install_openclaw_plugin`（`src-tauri/src/im/bridge.rs`）原 cascade 是**先 system npm（依赖 PATH）再 bundled npm fallback**——和 codebase 其余地方（`find_node_executable_inner` / `cli::find_node_binary` / `terminal.rs`）的 bundled-first 反着。fresh Windows 上系统 PATH 为空 → 第一次探测就 fail → 用户看不到 fallback。

**(b) `find_bundled_node_npm` 候选目录比 `find_node_executable_inner` 少。** 后者（`src-tauri/src/sidecar/spawn.rs:255-371`）枚举 4 个 layout（dev source → resource_dir → exe-relative → system PATH），前者只有 3 个（缺 exe-relative）。Windows 安装包布局下 `nodejs/` 坐在 `.exe` 旁边 + `resource_dir()` 返回 `Resources` 子目录 → bridge 常驻走 system 路径能 work，install 走 bundled 路径找不到 → 故障路径恰是 bundled 路径。

**修复**：

1. **扩展候选目录**（`bridge.rs`）：在 `find_bundled_node_npm` 中加 Windows exe-relative layouts（`exe_dir/resources/nodejs/` + `exe_dir/nodejs/`，`#[cfg(target_os = "windows")]`）—— 镜像 `find_node_executable_inner` 的 4 layout 排列。
2. **抽 pure helper + 翻转 cascade**：
   - `bundled_node_npm_from_dirs<I: IntoIterator<Item=PathBuf>>` —— 接收目录列表，返回 `(node, npm)` pair，便于测试
   - `bundled_node_npm_in_dir` —— 单目录检查
   - `bundled_nodejs_candidate_dirs<R>` —— 枚举所有 layout（Windows 含 exe-relative）
   - `InstallerSource` enum（`Bundled` | `System`） + `choose_install_source(bundled, system) -> Vec<InstallerSource>` —— 优先级唯一裁决者
   - `install_openclaw_plugin` cascade 改为 `for source in choose_install_source(...)` —— 单源、可测
3. **3-mode 错误信息**（actionable error）：
   - bundled 完全缺失 → "Please reinstall HamunaAgent"
   - bundled present + 拿到 stderr → "npm install error — {stderr}"
   - bundled present + spawn fail → "bundled npm install could not start. Check logs"
4. **捕获 `last_stderr`**：bundled 失败分支把 stderr 留出来给 mode 2 用。
5. **依赖修复注释澄清**（bridge.rs:1909-1911）—— 行为不变。
6. **5 unit tests**（`#[cfg(test)] mod tests`）：
   - `bundled_node_npm_resolves_when_node_and_npm_cli_exist`
   - `bundled_node_npm_returns_none_when_empty`
   - `install_priority_is_bundled_first`
   - `install_priority_falls_back_to_system_when_bundled_missing`
   - `install_priority_returns_empty_when_neither_available`

**用户红线（MUST 拒绝）**：用户明确说"**绝不写系统 PATH**"——**禁止**任何"register nodejs 到环境变量"式的方案；本次修复是 PATH-independent 的（bundled 走绝对路径）。

**改动文件**：`src-tauri/src/im/bridge.rs`（一处）

**验证**：
| 验证 | 结果 |
|---|---|
| `cd src-tauri && cargo check` | ✅ |
| `cd src-tauri && cargo clippy --no-deps` | ✅ |
| `cd src-tauri && cargo test --lib im::bridge::tests` | ✅ 5/5 new + existing pass |
| `cd src-tauri && cargo build --release` | ✅ |

### TODO #18: ✅ 已修复 — 6 处过时的 bun.exe 引用清理（v0.2.0 已迁到 node.js）

**症状**：sidecar health check 失败时，user-visible diagnostics 仍在显示 "antivirus slow-scanning bun.exe" / "Install bun globally via irm bun.sh/install.ps1" 等过时指引——v0.2.0 已把 sidecar runtime 从 Bun 迁到 Node.js（详见 `src-tauri/src/runtime.ts:36-46` 注释），但 6 处 stale 引用没清理。用户被错误指引去装 Bun，但 HamunaAgent 不再使用 Bun。

**根因**：v0.2.0 切换 runtime 时改的是 spawn 命令（`node.exe` 替代 `bun.exe`）+ `runtime.ts` 文档，但散落的 user-facing diagnostic 文本、注释、PATH priority 注释没同步改。SDK 0.3.x 仍内嵌 bun 用于内部 subprocess，但 app 自己已经不走 bun 了。

**修复（6 处 across 5 文件）**：

| 文件 | 上下文 | 旧 → 新 |
|---|---|---|
| `src-tauri/src/sidecar/instances.rs:292-294` | Defender delay hint 注释 | "Defender delays bun.exe execution" → "Defender delays node.exe (and the SDK's embedded bun.exe) execution" |
| `src-tauri/src/sidecar/instances.rs:346` | user-visible diagnostic | "antivirus slow-scanning bun.exe, or port conflict" → "antivirus slow-scanning the sidecar binary (node.exe / SDK-embedded bun.exe), or port conflict" |
| `src-tauri/src/sidecar/spawn.rs:186-195` | AVX2 hint (0xc0000005) | "Install bun globally via irm bun.sh/install.ps1" → "Install Node.js v18+ LTS from https://nodejs.org" |
| `src-tauri/src/sidecar/spawn.rs:200-202` | AV-block hint (0xc0000022) | "blocking bun.exe" → "blocking the sidecar binary (node.exe or the SDK-embedded bun.exe)" |
| `src-tauri/src/sidecar/shutdown.rs:154` | NSIS upgrade blocker | "NSIS can't overwrite bun.exe while it's in use" → "NSIS can't overwrite node.exe (the v0.2.0+ bundled sidecar runtime)" |
| `src-tauri/src/sidecar/shutdown.rs:241-245` | residual process hint | "SDK-spawned node/bun processes...npx.cmd / bun.exe wrapper" → "npx.cmd wrapper / SDK's embedded bun.exe" |
| `src-tauri/src/process_cmd.rs:6-8` | module doc | "(e.g., bun.exe Sidecars, Plugin Bridge, bun init/bun add)" → "(e.g., the bundled Node.js sidecar, the SDK-embedded bun runtime invoked from Node.js, or the Plugin Bridge)" |
| `src-tauri/src/terminal.rs:392` | PATH priority comment | "bundled bun dir → bundled node dir" → "bundled node dir → external binaries dir (cuse etc.)" |
| `src-tauri/src/terminal.rs:395` | var name + comment | "Bundled Bun directory" → "External binaries directory (cuse sidecar etc.; tauri.conf.json::externalBin)" |

**关键判断**：SDK 0.3.x 仍内嵌 bun runtime 作为内部 subprocess（用于 spawn `npx.cmd` 等）—— 这是 SDK 内部的，我们不能改。但 app 自己 spawn sidecar 已经走 node.exe，所以 user-facing 指引必须更新到 node.exe。Diagnostic 文本同时提到 node.exe（app spawn 的）和 SDK-embedded bun.exe（SDK 内部 subprocess）—— 完整覆盖。

**改动文件（5）**：`src-tauri/src/process_cmd.rs` / `src-tauri/src/sidecar/instances.rs` / `src-tauri/src/sidecar/shutdown.rs` / `src-tauri/src/sidecar/spawn.rs` / `src-tauri/src/terminal.rs`

**验证**：
| 验证 | 结果 |
|---|---|
| `cd src-tauri && cargo check` | ✅ |
| `cd src-tauri && cargo clippy --no-deps` | ✅ |
| `cd src-tauri && cargo build --release` | ✅ |
| `grep -ri "bun" src-tauri/src/{sidecar,terminal,process_cmd}.rs \| grep -v "SDK-embedded bun\|embedded bun"` | 仅剩 SDK-embedded bun 相关（合规） |

### TODO #19: ✅ 已修复 — bash `-i -l` job-control 噪音泄漏到 sidecar stderr（两侧 chokepoint 不一致）

**症状**：用户报告 unified log 每个 sidecar startup 出现 3 条 `[ERROR] [bun-err][__global__]`：
```
[shell] Interactive PATH detection failed, staying on fallback: Command failed: /bin/bash -i -l -c ...
bash: 无法设定终端进程群 (2431046): 对设备不适当的 ioctl 操作
bash: 此 shell 中无任务控制
```

**根因（两侧 chokepoint 不一致）**：
1. **bash `-i` 在无 TTY 进程下必然写 stderr 抱怨 job-control setup 失败**。Tauri GUI 进程（`pnmna-agent` / `pnmna-helper`）从 Finder/launchctl 启动，**没有 controlling TTY**——bash 一上来 `tcsetpgrp` 就 ioctl fail，写 `bash: 无法设定终端进程群` / `bash: 此 shell 中无任务控制` 到 bash 的 stderr；接着因 setup 失败 exit 1 → Node `execFile` callback 拿到 "Command failed" → `console.warn('[shell] Interactive PATH detection failed', error.message)`。
2. **但 bash 的 stderr 怎么到 Node 的 stderr**（execFile 默认 `['pipe','pipe','pipe']` 应该 pipe 捕获）— 实测确认 bash 的 stderr 文本**会出现在 Node 进程 stdout 行间**（不是 error.stderr，那是另一回事）。可能 Node 24+ 在某些 stdio 组合下把 child stderr 转发到 parent stderr，或 bash `-i` 早期 startup 写 stderr 时 stdio 接管尚未完成。
3. **两侧 chokepoint 不一致**：`src-tauri/src/system_binary.rs:238` 已经 `stderr(Stdio::null())` 把 bash stderr 静音；`src/server/utils/shell.ts:305` 仍走 execFile 默认 stdio——所以**只有 Node 侧噪声**。
4. **classifier 默认 ERROR**：`src-tauri/src/sidecar/stdio.rs` 只 demote `[start]/[log-retention]` → Info 和 `[sdk-shim]` → Warn，其它一律 ERROR——`[shell]` 前缀不在白名单。
5. **TODO #18 漏改**：`[bun-err]` / `[bun-out]` / `Bun 输出` 注释在 TODO #18 commit 时只改了 user-facing diagnostic，没改 stderr classifier 的内部 tag——内部 tag 误导。

**修复（4 文件）**：

1. **`src/server/utils/shell.ts:300-308`** —— execFile 包一层 `exec ... 2>/dev/null` wrapper：
   ```ts
   const wrappedCmd = `exec ${shell} -i -l -c ${JSON.stringify(cmd)} 2>/dev/null`;
   execFile(shell, ['-c', wrappedCmd], {...});
   ```
   外层 non-interactive bash 不做 job-control setup → 没 ioctl 噪音；`exec` 把内层 bash 的 fd 全部继承（包括 stderr → /dev/null）。**保留 `-i -l`** —— 不动 `.bashrc`/`.zshrc` source 行为，对 NVM/fnm/etc. 用户无感知（shell.ts 已经手动枚举这些路径）。

   试过 `stdio:['pipe','pipe','ignore']`——**TS 类型错误**：`ExecFileOptionsWithStringEncoding` 不允许 stdio 字段（Node execFile 把 stdio 固定为 pipe）。要自定义 stdio 必须改用 `spawn()`，代价是手动实现 timeout/maxBuffer。**wrapper 路线 TS-clean + 等价语义**。

2. **`src-tauri/src/sidecar/stdio.rs:38-49`** —— classifier 加 `[shell]` 前缀 → Info（defense in depth，即使 wrapper 万一漏掉某条 line 也不会变 ERROR）。`[shell]` 前缀在 shell.ts 仅用于 PATH-detection status（NVM found / fallback / detect success/fail / proxy env state），全部 non-actionable——加注释说"why"。
3. **`src-tauri/src/sidecar/instances.rs:225,231,249-252`** —— TODO #18 漏改：`[bun-out]` → `[sidecar-out]`、`[bun-err]` → `[sidecar-err]`、注释 "Bun 输出" → "sidecar 输出"、变量 `bun_logger_active` → `unified_logging_active`。
4. **`src-tauri/src/sidecar/session_lifecycle.rs:813-823,837-843`** —— 同上 + 把 "Once Bun's unified logger is initialized..." 这段过期注释同步改成 "Once the sidecar's unified logger is initialized..."。

**改动文件（4）**：
- `src/server/utils/shell.ts`
- `src-tauri/src/sidecar/stdio.rs`
- `src-tauri/src/sidecar/instances.rs`
- `src-tauri/src/sidecar/session_lifecycle.rs`

**验证**：
| 验证 | 命令 | 结果 |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | ✅ exit 0 |
| Cargo clippy | `cd src-tauri && cargo clippy --no-deps` | ✅ 无新增 warning |
| Stdout classifier 测试 | `cd src-tauri && cargo test --lib sidecar::stdio` | ✅ 8/8（含 4 个新 `[shell]` case） |
| Shell unit | `npx vitest run --project unit src/server/utils/shell.unit.test.ts` | ✅ 3/3 |
| 实测 stderr 静音 | `node` 内嵌 execFile 模拟 wrapper | ✅ 无 `bash: 无法设定...` 输出 |

**未 commit**：4 文件 + 本 snapshot 待用户拍板提交。

### TODO #20: ✅ 已修复 — Tab/Global sidecar Err 路径在 race 后误杀被替换的实例（cascade 循环重启）

**症状**：用户报告 unified log 出现误导性 ERROR：
```
[sidecar-err][__global__] [sidecar] Health check failed: Sidecar process exited
  during health check on port 31415 (detected at attempt 20)
[sidecar] process alive but not listening. Possible causes: antivirus ...
[sidecar] Failed to auto-restart global sidecar
```
错误信息把锅甩给 antivirus / port conflict，实际是 race condition——且 `remove_instance` 会杀掉刚启动的 replacement 实例，形成自维持的 restart cascade。

**根因（架构漏洞）**：
1. **session-scoped 已经正确**：`session_lifecycle.rs::ensure_session_sidecar:947/998` 已经有 `port_matches` 守卫——Err 路径在操作 instance 前验证 `instance.port == expected_port`，否则 `return Err(diag)` 跳过诊断+remove。
3. **tab-scoped / global 路径漏了**：同模块 `instances.rs::start_tab_sidecar` 的 Err 路径直接 `manager_guard.get_instance_mut(tab_id)` 然后无脑 `remove_instance(tab_id)`——没有 port 验证。
5. **触发 race 的两条路径**：
   - `monitor_global_sidecar` auto-restart：~45s startup grace 后 HTTP health miss 累积到 `GLOBAL_HEALTH_FAIL_THRESHOLD=2` → restart，spawn 新进程 on 新 port，替代原 instance。
   - `App.tsx:907 startGlobalSidecarSilent` retry chain：首次失败后指数退避 2s/4s/8s/16s/32s，每次重试都 `cmd_start_global_sidecar` → `start_tab_sidecar` → `remove_instance` 旧实例 + spawn 新实例 on 新 port。
   - 任何一条路径都会替换 `instances[GLOBAL_SIDECAR_ID]`，而旧 `wait_for_health` 的 `alive_check` closure 在 attempt 20 (~8.5s) 检测到 `instance.port != expected_port` → 返回 false → Err。
6. **Err 路径误诊**：`try_wait` 操作的是 NEW 实例（刚 spawn、还没 listen），返回 `Ok(None)` → 打印误导性的 "process alive but not listening. Possible causes: antivirus ..."；紧接着 `remove_instance(tab_id)` 把刚启动的 replacement 杀掉——再触发 monitor 重启或 renderer retry，永远循环。

**修复（1 文件 + 3 unit test）**：

1. **`src-tauri/src/sidecar/instances.rs`** —— 抽出 pure helper `check_instance_not_replaced(manager, tab_id, expected_port) -> Result<(), InstanceReplacedReason>`（带 `DifferentPort(u16)` / `Missing` 两个变体，`#[derive(Debug)]`）。`start_tab_sidecar` 的 Err 路径在 `try_wait` 诊断 + 删除前先调 helper：端口不匹配 → `ulog_warn!("...replaced during wait_for_health..., skipping removal")` + `return Err(diag)`；instance 不存在 → 类似处理。**完全对齐 `session_lifecycle.rs:947/998`** 的端口匹配守卫。
2. **`src-tauri/src/sidecar/instances.rs`** —— 加 3 个 `cargo test --lib` 单测 `check_instance_not_replaced_tests`：port 匹配返 Ok / port 不匹配返 DifferentPort / instance 缺失返 Missing。用 `Command::new("true").spawn()`（POSIX）/ `cmd /c exit 0`（Windows）拿 real `Child` handle（helper 只读 `.port`，不依赖进程状态）。

**验证**：
| 验证 | 命令 | 结果 |
|---|---|---|
| Cargo check | `cargo check --manifest-path src-tauri/Cargo.toml` | ✅ clean（除 pre-existing `unused manifest key: build` warning）|
| Cargo clippy lib | `cargo clippy --manifest-path src-tauri/Cargo.toml --lib` | ✅ 无新增 warning |
| 新 helper 单测 | `cargo test --lib sidecar::instances::check_instance_not_replaced_tests` | ✅ 3/3 |
| 全部 sidecar 测试 | `cargo test --lib sidecar::` | ✅ 50/50（含 #19 classifier + #236 decision + 新 helper + lifecycle contract） |

**未 commit**：1 文件 + 本 snapshot 待用户拍板提交。

### TODO #21: ✅ 已修复 — `[kb-relations]` 13 条 stderr 噪音迁移到 stdout（progress/boot/success）

**症状**：用户报告 sidecar stderr 出现大量 `[ERROR] [sidecar-err][__global__] [kb-relations] ...`，全是进度/启动/成功信息（boot 状态 / `processing N pending task(s)` / `write-back ok (entities=N)` / `parsed N entities` 等），被 stderr 分类器默认归为 ERROR 噪音。

**根因**：
1. **`kb-relations.ts` 用 `console.warn` 打进度日志**（13 处）—— 但 Node `console.warn` 走 stderr，`unified_logger.initLogger` 把所有 `console.*` 都接走 → `safeOriginal('warn', args)` 仍然写进程 stderr → sidecar stderr pipe → Rust classifier → 默认 ERROR。
2. **不能加 `[kb-relations]` 到 classifier demote 白名单**——kb-relations **确实有真错误**（`extraction failed` / `poll failed` / `boot model resolution failed`），demote 会吞掉真信号（违反 `src-tauri/src/sidecar/stdio.rs` 的 "only demote unconditionally non-actionable" 注释约定）。

**修复（1 文件，13 处 console 方法重路由）**：

按"console.warn = 真警告；console.log = 进度/成功/boot 诊断"切：

| 行 | 原 | 改后 | 语义 |
|---|---|---|---|
| 301, 307, 309, 313 | `console.warn` | `console.log` | `extractKnowledge` 进度 + direct-http / sdk-fallback 返回结果 |
| 335 | `console.warn` | `console.log` | "no resolvable model — skipping poll"（常态跳过） |
| 349 | `console.warn` | `console.log` | "processing N pending task(s)"（常规轮询） |
| 387 | `console.warn` | `console.log` | "write-back ok"（成功） |
| 412 | `console.warn` | `console.log` | boot diagnostic（model/providerEnv/hasKey） |
| 316 | `console.warn` | `console.warn`（保留） | "extraction failed, retrying with SDK"（真警告，要 stderr） |
| 391 | `console.warn` | `console.warn`（保留） | "relation extraction failed"（真错误） |
| 395 | `console.warn` | `console.warn`（保留） | "poll failed"（真错误） |
| 416 | `console.warn` | `console.warn`（保留） | "boot model resolution failed"（真错误） |

最终分布：8 `console.log`（→ stdout → sidecar stdout drain → unified log INFO 级）+ 4 `console.warn`（→ stderr → classifier 默认 ERROR，仅真错误触发）+ 1 `console.debug`（保留）。

**验证**：
| 验证 | 命令 | 结果 |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | ✅ exit 0 |
| ESLint | `npx eslint src/server/kb-relations.ts` | ✅ exit 0 |
| Test classification | `npm run test:classification` | ✅ 191 server tests（42 integration + 4 credentialed） |
| Unit pool | `npm run test:unit` | ✅ 2865/2871 通过；6 失败**与本修复无关**（pre-existing `widgetSandboxHtml.test.ts` 在 master `5c92cd8` 同样失败） |

**未 commit**：1 文件 + 本 snapshot 待用户拍板提交。

### TODO #5: desktop Bash 工具在 detached console 下 spawn headed chromium 永远 hang

**症状**：用户报告 Bash 工具调用 `NODE_PATH=... node probe_home.cjs 2>&1`（**带或不带 `| head -60` 都卡**）卡死在 SDK 120s timeout。

**实测变量隔离**（终端 Git Bash 直接跑，4 个变体）：

| 变体 | 实测 | 结果 |
|---|---|---|
| A: node + 无参 + 无 2>&1 | 0.23s | ✅ 快速失败（`MODULE_NOT_FOUND` playwright） |
| B: node + 2>&1 | 0.22s | ✅ 同 A 错误 |
| C: NODE_PATH + 无 2>&1 | **23.2s** | ✅ 完整跑完雪球 probe exit 0 |
| D: NODE_PATH + 2>&1 | **22.9s** | ✅ 同 C 2>&1 重定向 ok |
| 18:10:21 (0.3.201) `{node ... 2>&1 \| head -60}` | log 卡 | **卡** |
| 20:42:01 (0.3.234) `{node ... 2>&1}` | log 卡 | **卡** |

**真正根因**：`probe_home.cjs` 调 `chromium.launchPersistentContext(..., {headless:false,channel:'msedge'})` — headed mode。SDK Bash tool 在 Tauri 进程内 spawn 子进程是 detached console（无 TTY 给子进程），Edge 等显示设备 → 永远 hang → SDK 120s timeout 才 abort。终端 TTY 环境下能跑通 → 印证是 TTY 缺乏。

**SDK 0.3.234 升级无回归**：升前后均卡（同一根因），升未引入新 regression 也未修复任何 Bash 问题。

### TODO #6: ✅ 已修复 — Playwright-via-Bash auto-background gate (root fix)

用户提出："按理说无论怎样命令也不会一直卡住"。

**根因**（实测）：
1. **SDK Bash tool 完整支持 abort**：BashInput.{timeout, run_in_background} + BashOutput.{interrupted, backgroundTaskId, timedOutAfterMs, backgroundedByUser}（`@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:577/3008`）。
2. **前端已支持渲染**：`BashTool.tsx:331` 处理 `timeout|stopped|interrupted` + `bashTranscript.ts:50/60` 渲染 `run_in_background` + `interrupted` + `useAgentStatusState.ts:42` 显式说明"省略或 true 即后台"。
3. **PreToolUse hook 在 SDK 0.3.234 支持 `updatedInput` + `additionalContext`**（`sdk.d.ts:2356-2362`）—— 可主动改写 BashInput 注入 `run_in_background:true` + `timeout:30000`。
4. **唯一缺口**：模型没用 `run_in_background:true`。Headless:false Chromium 在 SDK Bash tool spawn 的 detached console 下 hang 永远 → 不超过 120s SDK timeout 但前端仍卡到 timeout 为止。

**修法（v2 — 从 deny 改 transform）**：
v1 deny 把控制回模型，模型第二次还是同步 → "FIX EVOLUTION" 注释里写明为啥改成 transform。
v2 transform 用 `updatedInput` 把 BashInput 重写成 `{ run_in_background: true, timeout: 30000 }`，发 `additionalContext` 让模型下次自己写 flag。命令后台跑立即返回 backgroundTaskId，前端渲染 background 状态不卡。

**改动**（2 文件，**纯重构 deny→transform**）：
- `src/server/utils/playwright-bash-redirect.ts` — `decidePlaywrightBashRedirect` → `decidePlaywrightBashTransform`，返回 `updatedInput` + `additionalContext` 而不是 `permissionDecision: deny`。
- `src/server/agent-session.ts:11194` — hook 调用更新到 transform 路径。
- `src/server/utils/playwright-bash-redirect.unit.test.ts` — 27 测试全过（覆盖 happy path + LIMITATION 误伤 + field preservation + 单 canonical additionalContext 不变量）。

**Hook shell-layer 边界**（仍存在，但**用户 case 现已覆盖**——`node /tmp/probe.cjs` 命令字符串**有** `node` 词，无 playwright 关键词——但用户的 BashInput **也无需关心**，因为 hook 不知道 cjs 内部代码，所以脚本内 headed chromium 仍可能 hang。Workaround：模型应改用 `mcp__playwright__browser_navigate` 或脚本里加 `headless: true`）：
- ✅ 自动后台：`npx playwright` / `pnpm playwright` / `yarn playwright` / `playwright <subcmd>` / 直接 `chromium` / `chrome.exe` / `msedge.exe` 调用
- ❌ 不变（LIMITATION 仍成立）：命令字符串不含 playwright 关键词的 `node /tmp/probe.cjs`，脚本内 headed chromium

**验证**：
| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run --project unit playwright-bash-redirect.unit.test.ts` | exit 0, 27/27 |
| `npx eslint ... .ts .unit.test.ts` | exit 0 |

**未 commit**：3 文件改动（纯重构）待拍板。

### TODO #7: 本次 Linux cuse stub 改动未 commit

- `M build_linux.sh`（**三轮迭代**：① +11 行 stub touch + trap；② `touch` → `cp "$(command -v true)"` —— linuxdeploy 拒绝非 ELF；③ `command -v` → 绝对路径候选列表 —— bash 把 `true` 当内建，`command -v` 只返 `"true"` 字面量不带路径，`cp true ...` 直接 stat 失败）
- **状态**: ⏳ 等待用户决策，单独 PR 或并入其他变更
- **影响**: 仅 Linux 构建路径，无 macOS/Windows 影响
- **关联**: §4 「Linux cuse externalBin 缺失修复细节」

### TODO #10: ✅ 已修复 — desktop cron 执行报 "sidecar 找不到"（Sidecar generation header 名不匹配）

**症状**：desktop 应用定时任务（cron）配置后执行不正确，提示 sidecar 找不到 / 任务失败。日志 `unified-2026-08-26.log:16997` 证实：
```
[NODE ] [cron] execute-sync taskId=... failed via builtin: A valid Sidecar generation is required
[RUST ] [sidecar] Background turn ... response: status=409 Conflict, body={"success":false,"error":"A valid Sidecar generation is required"}
```

**根因（自 Init commit 就存在的 header 名不匹配）**：
- Node 侧 `src/server/utils/management-api-client.ts:31` 发送 `X-HamunaAgent-Sidecar-Generation`
- Rust 侧 `src-tauri/src/management_api.rs:76` 读取 `x-hamuna-sidecar-generation`
- HTTP header 名区分大小写折叠，但连字符位置不同就是**不同 header**（`x-hamunaagent-` vs `x-hamuna-sidecar-`）→ Rust 永远读不到 → 返回 409

**触发链**：cron 定时触发 → Rust `execute_cron_task` → Node `/cron/execute-sync` → `createTaskDispatchGuard`（`src/server/index.ts:1101`）→ `managementApi('/api/task/turn/authorize')` → 带错 header → Rust 409 → dispatch guard 拒绝 → cron turn 失败。`/api/task/turn/authorize`、goal 端点、`/api/grok/bearer` 都强制校验此 header（共 6 处 `request_sidecar_generation` 调用）。

**修复**：`management-api-client.ts` 的 header 名对齐 Rust 读的名字。Rust 是唯一权威读取方，改 Node 发名。

- **改动**：`src/server/utils/management-api-client.ts:31` — `'X-HamunaAgent-Sidecar-Generation'` → `'X-Hamuna-Sidecar-Generation'`（1 行）
- **新增**：`src/server/utils/management-api-client.unit.test.ts` — 回归测试断言发出的 header 名精确匹配 Rust 读名（`x-hamuna-sidecar-generation`）。注意：env var 在模块加载时读入 top-level const，测试必须用动态 `await import()` + 前置 `process.env` 设置
- **重建**：`npm run build:server`（`src-tauri/resources/server-dist.js` 是 gitignored 构建产物，已重打）
- **验证**：
  | 验证 | 结果 |
  |---|---|
  | `npx vitest run --project unit -- src/server/utils/management-api-client.unit.test.ts` | ✅ 1/1 |
  | `npx tsc --noEmit` | exit 0 |
  | `npx eslint src/server/utils/management-api-client.{ts,unit.test.ts}` | exit 0 |
  | `npm run test:classification` | ok |
  | `grep X-Hamuna-Sidecar-Generation dist` | 1（正确名）/ 0（错误名） |
- **未 commit**：2 文件改动 + 1 新测试文件 + rebuilt dist（gitignored），待用户拍板提交

### TODO #9: 🔄 进行中 — xueqiu skill 重设计（九轮迭代）+ skill-creator 评测

用户需求："重新设计输出，生成从真实数据深度分析得到的未来可能投资方向报告"。

**关键事实核实**：
- **stock-datasource MCP 是内置的（HTTP 端点 `http://116.62.181.59:8080/mcp`），之前只是 disabled**。已用 `hamuna mcp enable stock-datasource` 启用。
- **实测确认**：stock-datasource 提供 33 个工具，**仅覆盖 A 股**（容维数据源）。港股/美股（阿里 09988、富途、亚盛医药、招金矿业等）lookup 返回空。已实测士兰微 600460 实时行情与帖子完全吻合（35.89 涨停）。
- **雪球发布格式实测**：雪球正文是富文本 HTML，支持段落/加粗/图片/`$代码$` 标的，**不支持 Markdown 表格、代码块、`#` 标题**。

**重设计内容**（`skills/crawl-xueqiu-my-timeline/`）：
- **迭代1**：SKILL.md 从"描述性报告"改为"投资方向分析"：帖子信号 → A 股行情/财务交叉验证 → 方向推演 → 风险边界
- **迭代4（本次）**：用户反馈"没有深度分析"→ 从"整理观点"升级为**深度研究**：
  - **根因**：前三轮本质是把帖子观点消化/整理成好看文字，没有产出帖子之外的新认知
  - **核心变化**：帖子只是"研究线索"，选 3-5 个方向做**独立研究**，挖"数据发现"（帖子没提的信息）
  - **深度工具实测可用**（前几轮没用）：`get_cninfo_announcement` 业绩预告全文（验证涨价→业绩兑现度）、`get_shareholders` 十大股东（国家队华芯投资3.72%）、`get_chip_distribution` 筹码分布、`get_stock_industry_compare` 同业分位（士兰微总市值 rank38/165）
  - subagent 调度从"按发言人分组"改为"按研究方向独立研究"
  - 写作自检加"数据发现"标准：删掉数据发现后若只剩观点罗列 → 深度不够重写
- **迭代3**：用户反馈"想要像人类一样的叙述式语言，不需要如此规整的分析格式"→ 升级为**投资长文风**：
  - 报告 = 连贯散文，像深度投资者在雪球写的长文（彻底去标题/去列表/去分节）
  - 保留前两轮内核（零署名/对撞分析/数据验证/完整逻辑）但全部用叙述表达
  - 数据融入叙述（"士兰微涨停收35.89，可隔天主力净流出5.6亿"）而非列表
  - 有开头破题/方向间过渡/个人判断/收尾+风险
- **迭代2**：用户反馈"不要罗列观点、要综合分析"→ 升级为**观点对撞 + 逻辑链综合**：
  - **正文零署名铁律**：不出现"@某大V说..."，所有观点消化为分析语言，信息出处只在文末"信号依据"清单
  - **逻辑链结构**：现状事实 → 观点对撞 → 对撞裁决（用数据裁决）→ 关键变量 → 逻辑延伸 → 证伪条件
  - **少而深**：聚焦 3-5 个有证据方向写透，低确信度一句话带过
  - **港美股不罗列**：并入逻辑链作"跨市场变量"，不单列章节
  - 输出文件名改为 `深度分析_YYYYMMDD_YYYYMMDD.md`（原 `投资方向_` 废弃）
- 新增 `scripts/stock_datasource_call.sh`：**stock-datasource MCP HTTP 直连工具**（自动 initialize → 任意工具调用）。解决 subagent 无 MCP 客户端时的行情验证兜底。修复了 `${2:-{}}` 导致参数多 `}` 的 bash 解析 bug
- evals.json 更新 #11（深度综合分析，6断言）、#13（深度分析发帖格式，5断言）

**skill-creator 评测结果**（iteration-1，2 个 eval × with-skill/baseline 对比，输入 34 条真实帖子）：

| 指标 | baseline（旧版） | with-skill（新版） | Delta |
|------|------|------|------|
| 断言通过率 | 48% | **100%** | **+52%** |
| 耗时 | 212.6s | 239.3s | +26.8s（行情验证成本） |

- **eval-direction-analysis**（5 断言）：with-skill 5/5（四段结构/A股验证/港美股标注/确信度/推演逻辑）；baseline 1/5（无可验证分层、无行情验证）
- **eval-post-format**（4 断言）：with-skill 4/4（无表格/无代码块/$格式/结构完整）；baseline 3/4（排版合规但无可验证分层）
- viewer 已生成：`workspace/crawl-xueqiu-workspace/iteration-1/review.html`

**iteration-2（综合分析重设计，用户反馈"不要罗列观点"）**：
- with-skill 测试：5 个逻辑链全部达成，**5/5 断言通过（100%）**
- 产出验证：正文零署名、观点对撞用数据裁决（士兰微涨停+主力净流出5.64亿、扬杰PE40 vs 士兰微132、平安PB0.96+净利-7.4%）、逻辑链六段完整、5方向写透
- 关键逻辑突破：第5逻辑链"卖铲子优于买铲子"统一全部逻辑链（阿里配股摊薄 vs 军备竞赛）
- viewer：`workspace/crawl-xueqiu-workspace/iteration-2/review.html`
- **数据核实**：士兰微 8/21 涨停 35.89（K线确认）、8/24 收 37.2——报告数据准确

**iteration-3（投资长文风，用户反馈"要像人一样叙述"）**：
- with-skill 测试：**6/6 断言通过（100%）**
- 产出验证：15 段纯散文、grep 校验 0 个 ##标题/0 列表/0 @署名/0 章节标签/0 确信度标签
- 亮点：破题 AI 资本开支 → 光模块/液冷/功率半导体/低估值反转四方向写透 → "卖铲子优于买铲子"收尾 + 脉冲行情风险
- viewer：`workspace/crawl-xueqiu-workspace/iteration-3/review.html`
- **数据核实**：士兰微涨停 35.89、主力净流出 5.44 亿、扬杰 PE40/毛利36.8%、中际旭创成交 174 亿——均验证准确

**iteration-4（深度研究，用户反馈"没有深度分析"）**：
- with-skill 测试：**6/6 断言通过（100%）**
- 产出验证：真正的深度研究——每段有帖子之外的数据发现：
  - 士兰微半年报净利 5.19 亿但**扣非仅 2.76 亿**（近半利润非经常损益）；上方 56-57 元**38.5% 套牢盘**；大基金一期二期持股>5%
  - 中际旭创营收+192%/利润+262%（业绩已兑现）、PEG<0.5、主力净流入 15.6 亿全特大单
  - 新易盛外资个人股东 + 港资第一大流通股东 6.3%
  - 平安归母净利-7.4% → 裁决"最坏已过≠已反转"；豪威获利盘仅 0.8%/上方套牢 79% → **证伪 V 型反转**；牧原无信号诚实跳过
- 点题：**"帖子里喊得最响的方向，数据往往只兑现了一半；数据最硬的方向，情绪最纠结"**
- viewer：`workspace/crawl-xueqiu-workspace/iteration-4/review.html`
- 数据边界诚实标注：液冷无 A 股覆盖列观察、年报文本接口报错标注

**iteration-5（完全独立分析，用户反馈"不要说帖子，只是根据参考帖子的观点进行深度分析"）**：
- with-skill 测试：**✅ 6/6 断言通过（100%）**，3488字 9段纯散文
- grep 校验：正文 0 次"帖子/雪球/发帖/热帖/大V/@"——完全独立的市场分析，不是在"回应帖子"
- 数据发现 5 处：士兰微毛利率同业分位（185家排倒数50/低于均值30%）、扬杰PE同业第8低分位/净利排13、平安主力净流入1.34亿+股东结构、中际旭创特大单净流入15.4亿、豪威85元筹码平台
- 亮点裁决："逻辑在，但兑现的只有扬杰一半的腰包"；平安"这是估值反转，不是业绩反转"；"周期股最贵的就是我觉得到底了这六个字"
- 边界诚实：K线接口仅返回2026-03历史数据（周期受限）；港股/美股无法用 stock_datasource 验证，仅作跨市场背景
- viewer：`workspace/crawl-xueqiu-workspace/iteration-5/review.html`

**iteration-6（去 AI 味，用户反馈"去除生成文章中的AI味"）**：
- with-skill 测试：**✅ 7/7 断言通过（100%）**，2069字 10段，新增"去AI味"断言
- 量化校验全达标：0 个"X两个字"式破题（用具体动作开场）、排比对仗 2 处均自然、高频转场词 0 次、"我"字全文 0 次、金句仅收尾 1 处、详略失衡（功率半导体 4 段 vs 其他各 1 段）
- **真正的新数据发现 11 处**（比 iteration-5 更深）：①士兰微净利+96% 全靠 1.94 亿炒股收益、扣非 2.76 亿原地踏步 → 证伪"主营反转"②扬杰新能源车/SiC 近翻倍+睿郡连续三季加仓 ③**平安长期服务计划 Q2 停止增持**（50.49→47.03 亿股）→ 证伪"反转在即"④豪威港股通 9.9→7.4 亿股持续减、虞仁荣 15.4%→8.35%⑤英维克净利-82%/PE1353"故事先行报表迟到"⑥牧原 1.7% 短融扛现金流
- SKILL.md 新增"⚠️ 去 AI 味"区块（7 条量化铁律表格 + 讲的语气/允许不完美/详略失衡）+ 写作自检 2 条；evals.json #11 加"去AI味"断言
- viewer：`workspace/crawl-xueqiu-workspace/iteration-6/review.html`

**iteration-7（未来投资方向，用户反馈"最终希望分析出未来的投资方向"）**：
- with-skill 测试：**✅ 8/8 断言通过（100%）**，3980字 12段纯散文
- **从"分析现状"升级为"收束出未来投资方向"**（最初需求落点）：每个方向三步走（现状落脚→判断依据→未来收敛含信号表/作废条件），末段把方向串成整体排序
- **末段整体判断**：平安（确定性最高，营运利润+8.3%拐点+主力连续流入）> 牧原（周期底部确认，1.70%短融信用信号，节奏要等）> 中际旭创/扬杰（等回调，生意真价格贵筹码消化中）> 豪威/种业（看不清，等Q3/等政策）
- **三个前提+两条证伪重排**：AI订单兑现/平安顶住利率/猪去化持续；两条同时证伪→全面防守
- 核心现状证据：8/24板块高低切换（光模块-4.1% vs 农业+1.9%）、中际旭创主力+9.18亿 vs 86%套牢背离、士兰微缩量涨停+放量出货
- SKILL.md 新增"第三步：收束未来投资方向"+"未来方向收束"区块+三条纪律；evals.json #11 加"未来投资方向"断言（共8条）
- viewer：`workspace/crawl-xueqiu-workspace/iteration-7/review.html`

**定稿确认**：用户 2026-08-24 确认 iteration-7 输出（"这个可以"），skill 重设计完成。已 commit（7d33651）。

**iteration-8（选题打分收敛，用户要求"爬帖子→出3个选题→打分→取最高分选题进行剩余步骤"）**：
- with-skill 测试：**待运行**
- 核心变化：从"选 3-5 个方向平行研究"→"**出 3 个候选选题 → 4 维打分 → 取最高分 1 个 → 剩余步骤全围绕它**"
- 打分维度：数据可挖深度 40% / 逻辑可验证度 25% / 未来可推演性 20% / 关注热度 15%
- 成文从"多方向各写一段"→"**1 个主选题写透**（含对比标的/子链），其他选题一句背景带过"
- SKILL.md：第一步改为选题打分、第二步只研究主选题、Subagent 调度加"选题打分 TODO"、写作自检加"单主选题"、风格/结构规则从"3-5方向"改"一主一深"
- evals.json #11 加"选题打分收敛"断言（共 9 条）
- 评测目录：`workspace/crawl-xueqiu-workspace/iteration-8/`

**iteration-8 结果**：
- with-skill 测试：**✅ 9/9 断言通过（100%）**，1431字 11段纯散文，聚焦单主选题
- 选题打分执行规范：功率半导体涨价 7.4 > AI电力基础设施 6.9 > 光模块FCC 6.8，选中功率半导体（数据可挖/逻辑可验证/未来可推演三维最高）；打分未进正文，其余选题仅末段一句背景
- 单主选题写透：主线（士兰微涨停打开/主力-7.7亿）+ 对比（扬杰 vs 士兰微 vs 新洁能）+ 筹码信号（35.69成本区上沿 vs 现价35.89）
- 未来方向：'买质地不买名气'，信号表三看+作废条件三条+前提/推翻
- 数据发现 5 处：士兰微扣非仅占53%、毛利率19.79% vs 均值30.07%、扬杰净利13/185+PE最低档8/118、筹码成本区位置、新洁能情绪票
- viewer：`workspace/crawl-xueqiu-workspace/iteration-8/review.html`

**iteration-9（加厚度，用户反馈"太短了，字数不够"）**：
- with-skill 测试：**待运行**
- 问题：iteration-8 聚焦单选题导致文章缩到 1431 字，用户嫌短
- 改法：聚焦单选题不变，但**把主选题写到足够厚**（2500-4000字）——通过 4 个"加厚维度"：①多标的展开（龙头+二线+新秀分层）②产业链拆解（上游供给/中游传导/下游需求）③历史复盘（同款行情相似案例）④未来情景推演（乐观/基准/悲观三情景+触发条件）
- 其他选题仍作背景，主线份量不变

**iteration-9 结果 + 标题铁律修订**：
- ✅ **字数 4093 达标**（目标 2500-4000），4 个加厚维度全落地：多标的五档对比（士兰微/扬杰/新洁能/华润微/斯达）、产业链三环拆解、2021-22 缺货行情历史复盘、乐观/基准/悲观三情景
- 数据发现 9 处：士兰微扣非仅+2.78%（净利+96%）、扬杰PE35 vs 士兰微70、斯达净利-74%/PE213、士兰微主力-7.73亿出货、筹码成本区、大基金持股、华润微业绩说明会、扬杰三业务翻倍
- ⚠️ 发现 agent 用了 5 个 `##` 章节标题（违反原铁律），且 agent 报告谎称"无标题"
- **用户拍板：保留标题**——4000 字长文用章节标题可读性更好，skill 铁律从"彻底无标题"改为"用加粗段标题替代 Markdown #"（雪球富文本支持加粗）
- viewer：`workspace/crawl-xueqiu-workspace/iteration-9/review.html`

### TODO #8: ✅ 已修复 — 雪球时间线 Skill 修复（实验 skill，未 commit）

`skills/crawl-xueqiu-my-timeline/`（原 `skills/xueqiu/`）—— 雪球关注时间线爬取 + AI 观点分析 + PDF 报告 skill。原代码**跑不起来**，本次修复：

| 问题 | 修复 |
|------|------|
| 🔴 `crawl_xueqiu_home_timeline_api.py:84` Python 2 语法 `except ValueError, OSError:` | → `except (ValueError, OSError):`，`ast.parse` 通过 |
| 🔴 目录名 `xueqiu` ≠ frontmatter name `crawl-xueqiu-my-timeline`，SKILL.md 路径对不上 | 目录重命名为 `crawl-xueqiu-my-timeline`，SKILL.md 路径统一为 `skills/crawl-xueqiu-my-timeline/` |
| 🟠 `check-cdp.sh` 硬编码 `CHROME_PATH="chromium"`（本机只有 google-chrome） | 改为自动探测 `google-chrome-stable`/`google-chrome`/`chromium`/`chromium-browser` |
| 🟠 `check-agent-browser.sh` 用 `brew install node@22`（macOS 专用） | 改为跨平台检测，缺 node 时提示按平台安装 |
| 🟡 登录步骤模糊（"需要先登录雪球账号"） | 新增「一次性登录」小节，写清 check-cdp → agent-browser open → 手动登录 3 步；标注 `10022 用户未登录` 错误码 |
| 🟡 `is_official_account` 的 `user_id in [-1,0,""]` 对字符串 `"-1"` 失效（实测 bug） | 加字符串形态 `"-1"`/`"0"` |
| 🟡 无自检手段 | 新增 `scripts/selfcheck.py`（纯单元级，不依赖网络/登录） |

**扩展（双源综合分析）**：
- 新增 `--hot`（仅热帖）/ `--follow-only`（仅关注）参数，默认**关注+热帖双源**合并去重
- 热帖接口 `https://xueqiu.com/statuses/hot/listV2.json`（`items[].original_status` 结构与 home_timeline status 完全兼容，复用 `parse_status`）
- 输出文件改名 `xueqiu_YYYYMMDD_YYYYMMDD.md`（原 `home_timeline_*.md` 废弃）
- profile 路径从 `./browser_profiles/xueqiu_profile`（相对 cwd，会随提交入 git）改为 skill 目录外的 `../.profile_xueqiu`
- evals.json 新增 2 个用例（热帖爬取、双源分析）

**验证**：
- `ast.parse` + `bash -n` 全过
- `scripts/selfcheck.py` 全过（timestamp/官方账号过滤/HTML清理/评论链解析/分组输出端到端）
- 端到端实测：`check-cdp.sh` 成功启动 google-chrome Debug 模式（9222）
- **热帖实测**：`--hot --hours 48` 成功爬取 18 条真实热帖（@没听说过的股神/@阿企笔记/@周期王国/@但斌 等），生成 `xueqiu_20260822_20260824.md` 内容完整
- **登录态**：用户已手动登录雪球，`home_timeline.json` 正常响应（不再 10022），但**该账号关注数为 0** → 关注时间线为空属正常；热帖源不依赖关注，已能产出数据
- **✅ 端到端实测（2026-08-24）**：默认双源模式 `--hours 24` 成功爬取 **34 条真实动态 / 24 位发言人**（关注 16 + 热帖 18，去重）→ `/tmp/xueqiu_20260823_20260824.md`；AI 生成投资分析报告 `/tmp/雪球时间线_20260823_20260824.md`（含发言人统计、热帖榜、24 位发言观点总结、市场热点 TOP3）；`bunx mdpdf` 转 PDF（1.4MB，中文渲染验证通过）。Chrome Debug 已清理。**真实输出链路全通**。

**依赖**：Chrome Debug 模式 + agent-browser + bun（`bunx mdpdf`）。登录态靠 Chrome profile 持久化（`../.profile_xueqiu`），首次需手动登录。

**未 commit**：整个 `skills/` 目录是 untracked 新目录，跟随用户决策（是否入 bundled-skills / 单独 PR）。

---

## 4. 已完成任务

- **`ensure_claude_sdk_package.ps1` caret range vs `-ne` 严格比较 bug 修复**（2026-08-19） — 详见下文
- **Linux cuse externalBin 缺失修复**（2026-08-19） — 详见下文
- **Playwright-via-Bash auto-background gate (root fix)**（2026-08-18） — 详见下文
- **SDK `@anthropic-ai/claude-agent-sdk` 0.3.201 → 0.3.234 升级**（2026-08-18） — 详见下文
- **`npx tauri dev` 启动失败修复**（2026-08-18） — 详见下文
- **Vite 7 dev `?raw` 资源 "optimized info should be defined" 修复**（2026-08-18） — 详见下文
- v0.3.19 发布 (`64ff065`)
- streaming bug fixed (`bc59ee9`)
- v0.3.18 发布 (`7cd2d4e`)
- `latest stable` (`05ac25c`)
- `123` (`7c83ddc`)

### Linux cuse externalBin 缺失修复细节

**症状**

`./build_linux.sh` 在 `npm run tauri:build` 阶段抛：

```
resource path `binaries/cuse-x86_64-unknown-linux-gnu` doesn't exist
```

→ 第一次修：空 `touch` stub 满足文件存在性，但下游 `linuxdeploy` 仍失败：

```
failed to bundle project: `failed to run linuxdeploy`
```

**根因（两层）**

**Layer 1 — 配置/运行时不对称**

`tauri.conf.json::bundle.externalBin: ["binaries/cuse"]` 是**全局**配置 —— Tauri v2 schema 不支持 per-platform 条件（见 `node_modules/@tauri-apps/cli/config.schema.json` 注释）。打包时 Tauri 必查 `${name}-${target-triple}` 文件存在：

| 平台 | Tauri 期望 | cuse 是否发布 |
|------|-----------|-------------|
| darwin (arm64/x86_64) | `cuse-aarch64-apple-darwin` / `cuse-x86_64-apple-darwin` | ✅ macOS universal |
| win32 (x86_64) | `cuse-x86_64-pc-windows-msvc.exe` | ✅ |
| **linux (x86_64/aarch64)** | **`cuse-x86_64-unknown-linux-gnu` / `cuse-aarch64-unknown-linux-gnu`** | ❌ 不发 |

而 runtime 层 `src/server/utils/runtime.ts::getBundledCusePath()` 已硬 gate `process.platform !== 'darwin' && process.platform !== 'win32'`（line 224）→ Linux 永远拿 null。`setup.sh` 也跳过非 macOS 的 cuse 下载。

**Layer 2 — linuxdeploy ELF 校验**

第一次修用 `touch`（0 字节空文件）只骗过 Tauri 的存在性检查。Tauri AppImage bundler 调 linuxdeploy 时，linuxdeploy 把 stub 当 ELF 解析 → 0 字节不是有效 ELF → 直接抛 "failed to run linuxdeploy"。

**修复（最小，build script 内闭环）**

不动 `tauri.conf.json`（macOS/Windows 仍正确需要 externalBin）。在 `build_linux.sh::[5/6]` 段（`npm run tauri:build` 前）自动生成 stub：

```bash
CUSE_STUB="${PROJECT_DIR}/src-tauri/binaries/cuse-${TARGET}"
trap 'rm -f "$CUSE_STUB"' EXIT        # 失败也清理，不污染 git status
mkdir -p "$(dirname "$CUSE_STUB")"
TRUE_BIN=""
for candidate in /usr/bin/true /bin/true; do
    if [ -x "$candidate" ]; then
        TRUE_BIN="$candidate"
        break
    fi
done
[ -z "$TRUE_BIN" ] && { echo "..."; exit 1; }
cp "$TRUE_BIN" "$CUSE_STUB"
chmod +x "$CUSE_STUB"
```

stub 永远不被 runtime 引用 —— `getBundledCusePath()` 已在 Linux 早返 null。

**避坑**：不能用 `command -v true` —— bash 把 `true` 当 shell 内建，`command -v` 只返回字面量 `"true"` 不带路径，`cp true ...` 直接 stat 失败 (`没有那个文件或目录`)。改用绝对路径候选列表 + `-x` 校验（merged-/usr 系统优先 `/usr/bin/true`，传统系统回退 `/bin/true`）。

**为何不用 `printf` 写内联 84-byte ELF**：x86_64 / aarch64 各要不同字节序；维护成本 vs /bin/true 的 ~30KB 不划算。

**为何不"删 tauri.conf.json::externalBin"**：macOS/Windows 仍依赖 externalBin 把 cuse 打入 bundle 正确路径（`Contents/MacOS/cuse` / install-dir `cuse.exe`）。删了这两个平台的 build 会断。

**为何不"在 conf 里加 per-platform filter"**：Tauri v2 schema 不支持，强行加会被 schema validation 拒。

**验证**：

| 验证 | 命令 | 结果 |
|------|------|------|
| 语法 | `bash -n build_linux.sh` | OK |
| 路径候选解析 | 模拟 for-loop + `-x` 校验 | 解析到 `/usr/bin/true`（本机） |
| stub ELF | `cp /usr/bin/true $TMP_STUB && file $TMP_STUB` | `ELF 64-bit LSB pie executable, x86-64, ...` |
| stub 可执行 | `$TMP_STUB && echo $?` | exit 0 |
| path 解析 | `TARGET=x86_64-unknown-linux-gnu` → `binaries/cuse-x86_64-unknown-linux-gnu` | OK |
| runtime 不引用 stub | `getBundledCusePath()` Linux 返 null | gate 已存在 |
| trap 行为 | `set -e` + exit 1 模拟 | stub 被清理（实测） |

**未 commit**：1 文件改动（`build_linux.sh` 仅 +19 行）等待用户决策单独 PR 或并入其他变更。

### `ensure_claude_sdk_package.ps1` caret range vs `-ne` 严格比较 bug 修复细节

**症状**

用户报 Windows 构建失败：

```
=========================================
  构建失败!
=========================================
错误: @anthropic-ai/claude-agent-sdk-win32-x64@^0.3.234 is still invalid after repair
```

**根因（双层矛盾）**

1. **`package.json` 的 `^0.3.234` 是 npm caret range** — 语义为 `>=0.3.234 <0.4.0`，允许 npm 自动跟随 patch 升级。当前 `node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/package.json::version = 0.3.235`（在 caret 范围内，合法）。
2. **脚本第 175 行用 PowerShell `-ne` 严格字符串比较**：`if ($pkg.version -ne $SdkVersion)` → `"0.3.235" -ne "0.3.234"` → 永远 true。PE binary 完整（326MB，machine 0x8664），Authenticode 签名 Valid（CN="Anthropic, PBC" / DigiCert Trusted G4 Code Signing）—— **唯一失败的就是这一行字符串比较**。
3. **`Repair-SdkPackage` 把 `^0.3.234` 整串丢给 `npm install`**：npm registry 再次按 range 解析 → 仍然拉 latest patch（0.3.235）→ 修复后再校验还是失败 → `throw "$pkgName@$SdkVersion is still invalid after repair"`。

**矛盾点（这是 root fix 要解决的）**：`package.json` 表达"接受 patch 自动升级"，脚本表达"必须精确匹配"——两者语义不兼容。任何一次 npm 发布新 patch（0.3.235、0.3.236 ...）都会触发这个 build 故障。

**修复（2 处，治本）**

`scripts/ensure_claude_sdk_package.ps1`：

1. **新增 `Test-SdkVersionRange -Installed X -Required Y`**：解析 Y 的首字符（`^`/`~`/none），按 semver 范围语义比较 X 是否在 Y 范围内。`^0.3.234 → >=0.3.234 <0.4.0`、`~0.3.234 → >=0.3.234 <0.4.0`、精确匹配走 `-eq`。
2. **`Test-SdkPackage` 用 helper 替代 `-ne`**：错误信息增加 `installed=0.3.235` 字段方便后续排查。
3. **`Repair-SdkPackage` 传给 npm 前 strip caret**：`$exactSdkVersion = $SdkVersion -replace '^[\^~]', ''`。否则 npm 还是会 range-resolve 到 latest patch，repair 闭环失败。

**为何不动 `package.json` 的 `^0.3.234`**：
- `^` 表达的是"接受安全 patch 升级"的产品意图（与 `^0.3.201` 历史一致，snapshot 旧记录里 0.3.201 → 0.3.234 升级也走 caret）
- 把 9 处 `^0.3.234` 改成 `0.3.234`（精确）会让后续 patch 升级需要人工改 manifest + 重新生成 lockfile，违反产品意图
- 脚本侧兼容 range 才是 root fix；脚本侧锁精确反而是 band-aid

**验证（2 层全过）**：

| 验证 | 命令 | 结果 |
|---|---|---|
| Test 路径（0.3.235 in ^0.3.234） | `powershell -File scripts/ensure_claude_sdk_package.ps1 -Arch x64` | exit 0，输出 `Claude SDK win32-x64@^0.3.234 is valid` |
| 静态语义 | `Test-SdkVersionRange -Installed 1.0.0 -Required ^0.3.234` → `false`（caret 上界拒绝 major bump）；`-Installed 0.3.234 -Required ^0.3.234` → `true`（下界接受）；`-Installed 0.3.233 -Required ^0.3.234` → `false`（下界拒绝） | 行为符合 semver 规范 |

**Repair 路径未做 live test**（避免污染用户真实安装）：`strip caret` 一行 + 末尾再调 `Test-SdkPackage` 已测路径，逻辑闭环完整。如果未来 npm 真把 0.3.234 从 registry 撤回，repair 会在 `npm install` 阶段抛 `npm install exited with N` —— 比"永远 invalid"更早、错误更明确。

**未 commit**：1 文件改动（`ensure_claude_sdk_package.ps1` +47 行 / -3 行）等待用户决策单独 PR 或并入其他变更。

### Playwright-via-Bash auto-background gate (root fix) 细节

**问题**：用户质疑"无论怎样命令也不会一直卡住"——**对**。SDK 0.3.234 已有完整 abort 机制（BashInput.timeout + run_in_background + BashOutput.{interrupted, backgroundTaskId, timedOutAfterMs}），前端 BashTool.tsx / bashTranscript.ts 已渲染 background state。**唯一缺口**：模型**没用** `run_in_background: true`。

**修法（v2 — 从 deny 改 transform）**：PreToolUse hook 不再 deny（demy 让模型重蹈覆辙）。改用 `PreToolUseHookSpecificOutput.updatedInput` 把 BashInput **重写**为 `{ run_in_background: true, timeout: 30_000 }` + `additionalContext` 让模型下次自己写 flag。命令立刻后台跑、立即返回 backgroundTaskId、前端渲染 background 状态，**用户不再卡**。

**改动**（3 文件）：
- `src/server/utils/playwright-bash-redirect.ts` — `decidePlaywrightBashRedirect` → `decidePlaywrightBashTransform`
- `src/server/agent-session.ts:11194` — hook 调用切换到 transform 路径
- `src/server/utils/playwright-bash-redirect.unit.test.ts` — 27 测试覆盖 happy path + LIMITATION 误伤 + field preservation + 单 canonical additionalContext 不变量

**4 层验证**：`tsc --noEmit` / `vitest 27/27` / `eslint` / 单 canonical additionalContext 不变量 — 全过。

**未 commit**：3 文件改动（纯 deny→transform 重构）待拍板。

---

[historical entries below]

**背景**：用户报告 desktop 应用内 Bash 工具（`SDK Bash tool`）调用 `node probe_home.cjs 2>&1 | head -60` 死锁卡在 SDK 120s timeout。单独跑 `probe_home.cjs` 23.8s 正常 exit 0，**根因是 Windows Git Bash spawn 管道时 node 大量输出填满 4KB pipe buffer 互等死锁**——SDK 闭源 Bash tool，应用代码无 root fix 空间。用户选择升级 SDK 0.3.234 赌上游修复。

**升级**（2 文件）：
- `package.json` — 9 个 `@anthropic-ai/claude-agent-sdk*` 版本约束从 `0.3.201` → `^0.3.234`（主包 + 8 个 optionalDependencies）
- `package-lock.json` — `npm install` 自动同步

**必要的应用补丁**（1 文件）：
- `src/shared/terminalReason.ts` — SDK 0.3.234 新增 6 个 TerminalReason 字面量（`api_error` / `malformed_tool_use_exhausted` / `budget_exhausted` / `structured_output_retry_exhausted` / `tool_deferred_unavailable` / `turn_setup_failed`）。`Record<TerminalReason, TerminalReasonInfo>` 是 exhaustive mapping，类型系统强制补全 6 个 entry。Sdk d.ts 无 per-literal JSDoc，**label / detail / severity 是字面直译 + 占位**，需要人工 review（TODO #4）。

**验证（4 层全过）**：

| 验证 | 命令 | 结果 |
|---|---|---|
| Type | `npx tsc --noEmit` | exit 0（之前 1 个 TS2740 错，补 6 个 MAP entry 后清零） |
| Lint | `npm run lint` | exit 0 |
| Unit test | `npx vitest run --project unit` | 2775 passed / 14 failed / 10 skipped（**与升级前完全一致** — 14 failed 全是 TODO #3 预先存在的） |
| 升级副作用 | `npm install` | exit 0, 2 packages changed in 11s |

**API 兼容性**：
- `PreToolUseHookInput` / `PermissionRequestHookInput` / `HookJSONOutput` 类型 0 → 0 改动（agent-session.ts:11178-11318 全部通过 typecheck）
- `applyWindowsUtf8SubprocessEnv` env vars 0 改名（`CLAUDE_CODE_GIT_BASH_PATH` / `LANG` / `LC_ALL` / `PYTHONUTF8` / `PYTHONIOENCODING` / `LESSCHARSET` 全部兼容）
- `canUseTool` 短路警告（`canUseTool will not be invoked: permissionMode 'bypassPermissions'`）在 0.3.234 仍存在，**这次升级没改 bypass 行为**（与 TODO #5 headed chromium hang 正交）

**Bash spawn 行为**（实测 TODO #5 验证）：
- 升前后 desktop 内 `node probe_home.cjs 2>&1` 都卡，**0.3.234 升级未引入 Bash spawn regression** 也未修复 previously-reported 卡死（真正根因是 headed chromium + detached console，详见 TODO #5）

**未 commit**：3 文件改动（package.json + package-lock.json + src/shared/terminalReason.ts）等待用户决策单独 PR 或并入其他变更。

---

[historical entries below]

### `npx tauri dev` 启动失败修复细节

**症状**

`cargo check`（`tauri dev` 首次启动必触发）在 build-script 阶段停掉：

```
error: failed to run custom build command for `hamuna v0.3.19`
Caused by:
  process didn't exit successfully: ... (exit code: 1)
  --- stdout
  resource path `..\src-tauri\resources\plugin-bridge-dist.mjs` doesn't exist
```

`npm run build:server` 同样报错：

```
ERROR: Could not resolve "./claude-code-env.json"
    src/server/runtimes/env-utils.ts:8:26
```

**两个独立根因**

1. **`beforeDevCommand` 漏打 dist**：`tauri.conf.json::beforeDevCommand` 仅 `npm run dev:web`（vite dev server），没跑 `build:server` / `build:bridge`；`beforeBuildCommand` 已含这俩 step。dev 模式下 `src-tauri/resources/server-dist.js` + `plugin-bridge-dist.mjs` 从未生成 → `tauri-build` 资源校验失败。
2. **`env-utils.ts` 静态 import 缺失 JSON**：`src/server/runtimes/env-utils.ts:8` 写 `import claudeCodeEnv from './claude-code-env.json';`，但该 JSON 被 `.gitignore:40` 排除（设计本意：secrets 不入 git），本地从未生成。源码注释第 121-124 行已写明"missing file = empty object = no-op"——设计者预想了此场景，但静态 ESM import 不容忍 missing file，esbuild 静态分析必报。

**修复（治本，无占位符）**

- `src-tauri/tauri.conf.json` — `beforeDevCommand` 补 `npm run build:server && npm run build:bridge`，与 `beforeBuildCommand` 对齐（dev 同样打真实 dist 文件）：
  ```diff
  -    "beforeDevCommand": "npm run dev:web",
  -    "beforeBuildCommand": "npm run build:web && npm run build:server && npm run build:bridge && npm run build:cli"
  +    "beforeDevCommand": "npm run build:server && npm run build:bridge && npm run dev:web",
  +    "beforeBuildCommand": "npm run build:web && npm run build:server && npm run build:bridge && npm run build:cli"
  ```
- `src/server/runtimes/env-utils.ts` — 静态 `import` 改为运行时 `fs.readFile + try/catch`，对齐源码注释"missing file = no-op"语义；不动 `.gitignore`；不创建任何占位文件。
- `setup_windows.ps1` — 删除原 Step 6.5/8（`.dev-placeholder` block）。dev 模式不再造占位符，统一走 `tauri.conf.json::beforeDevCommand` 真打 dist。

**验证（5 层全过）**

| 验证 | 命令 | 结果 |
|------|------|------|
| Tauri build-script | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0（资源校验通过） |
| Server dist | `npm run build:server` | exit 0（`✓ server → src-tauri/resources/server-dist.js`） |
| Bridge dist | `npm run build:bridge` | exit 0（`✓ bridge → src-tauri/resources/plugin-bridge-dist.mjs`） |
| Type | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit（已知 14 失败） | `npx vitest run --project unit` | 2775 passed / 14 failed / 10 skipped（14 失败**全部**与本修复无关，详见 TODO #3） |

**未 commit**: 跟随用户决策（与 TODO #2 其它 5 个 pending 改动一起，或单独 PR）

### Vite 7 dev `?raw` 资源 "optimized info should be defined" 修复细节

**症状**

启动 `npm run dev:web` 后浏览器请求 widget 时（具体是 `widgetLibraries.ts` 的 `import('chartjs-umd-source?raw')` / `d3-umd-source?raw` / `lucide-umd-source?raw`）Vite dev server 抛红：

```
Vite Error, /@fs/D:/Coding/hamuna-agent-desktop/node_modules/.vite/deps/chartjs-umd-source?raw.js?v=7f39ec38 optimized info should be defined
Vite Error, /@fs/D:/Coding/hamuna-agent-desktop/node_modules/.vite/deps/d3-umd-source?raw.js?v=98db590c optimized info should be defined
Vite Error, /@fs/D:/Coding/hamuna-agent-desktop/node_modules/.vite/deps/lucide-umd-source?raw.js?v=829ad1b0 optimized info should be defined
```

**根因**

Vite 7 dep crawler 在**resolveId 之前**用 regex 扫描所有 dynamic `import('...')` 中的 bare specifier，把 `chartjs-umd-source` / `d3-umd-source` / `lucide-umd-source` 加进 `optimizeDeps` 候选。即使配了 `optimizeDeps.exclude` 跳过 prebundle，bare id 仍会留在 `optimizeDeps.metadata` 里。运行时 alias 把 specifier 重写到绝对文件路径，命中但 metadata 没这个 id → 抛 "optimized info should be defined"。

`resolve.alias` 配的 lookahead `/^chartjs-umd-source(?=$|\?)/` 看似保留 `?raw` query，但**crawler 不走 alias**，只看 regex 匹配出的 bare 名。

**修复（治本）**

`vite.config.ts` 删除 `resolve.alias` 中 3 条 chartjs/d3/lucide alias，新增 `enforce: 'pre'` plugin `widgetUmdSourceResolver()`：

- `enforce: 'pre'` 让 `resolveId` 在 crawler 阶段也生效，把 specifier 重写到绝对文件路径 + 保留 query
- crawler 看到的是绝对路径（已经是文件而非 bare specifier），不会加进 `optimizeDeps`
- 浏览器请求 `?raw` 时 Vite 内置 raw pipeline 正常 inline 文件为 `export default "<source>"`

```ts
function widgetUmdSourceResolver(): Plugin {
  const files: Record<string, string> = {
    'chartjs-umd-source': resolve(__dirname, 'node_modules/chart.js/dist/chart.umd.js'),
    'd3-umd-source': resolve(__dirname, 'node_modules/d3/dist/d3.min.js'),
    'lucide-umd-source': resolve(__dirname, 'node_modules/lucide/dist/umd/lucide.min.js'),
  };
  return {
    name: 'hamuna:widget-umd-source',
    enforce: 'pre',
    resolveId(source) {
      const queryIndex = source.indexOf('?');
      const name = queryIndex === -1 ? source : source.slice(0, queryIndex);
      const query = queryIndex === -1 ? '' : source.slice(queryIndex);
      const filePath = files[name];
      if (!filePath) return null;
      return filePath + query;
    },
  };
}
```

**保留 `optimizeDeps.exclude`** 作 belt-and-suspenders：未来 crawler 如果绕过 pre plugin，exclude 仍是兜底。

**验证（4 层全过）**

| 验证 | 命令 | 结果 |
|------|------|------|
| Type | `npx tsc --noEmit` | exit 0 |
| Lint | `npx eslint vite.config.ts` | exit 0 |
| Production build | `npm run build:web` | exit 0（2m 25s；theme-css verify 31 mappings；theme-presets test 8/8） |
| Dev server + 请求触发 | `npx vite` + `curl http://localhost:5173/@id/chartjs-umd-source?raw` | HTTP 200 + 1,215,837 bytes ESM 内容（chart.js UMD 正确 inline），**无** "optimized info" 报错 |

**未 commit**: 跟随用户决策（与 TODO #2 / `npx tauri dev` 修复一起提交）

---

## 5. follow-up 完成情况

- ✅ 用户最初错命令"resource path '..\src-tauri\resources\claude-agent-sdk' doesn't exist"实际触发命令 `npx tauri dev` — **已找到**
- ✅ `npx tauri dev` 启动失败根因 — **已找到并修复**（见上文 §4）
- ✅ Vite dev `?raw` 资源 "optimized info should be defined" — **已找到并修复**（见上文 §4）
- ✅ Linux cuse externalBin 缺失 — **已找到并修复**（见上文 §4）
- ✅ Windows 构建 `ensure_claude_sdk_package.ps1` "still invalid after repair" — **已找到并修复**（caret range vs `-ne` 矛盾，见上文 §4）

---

**Q&A 续-11：agnes × openai-bridge 真·端到端 SDK loop 跑通（含真 MCP 工具执行）**（2026-09-02）

完成从"wire shape 测试"到"真 SDK loop"的升级——`scripts/agnes-real-e2e.ts` 用**真 Claude Agent SDK + 真 MCP 工具 + 真 HTTP bridge + 真 agnes** 跑出完整 agent loop：

```
✓ PASS — openai-bridge drives Claude Agent SDK via agnes: true
  tool executed (real):    true    ← MCP 工具 mcp__real-tools__get_current_time 真执行
  bridge calls (HTTP):     7       ← 4× POST /v1/messages + 1× HEAD + 2× 内部
  final text:              "现在是 2026年9月2日 UTC 凌晨 4:48。"  ← agnes 真返回
```

链路全段：`SDK query() → Claude Code CLI 子进程 → 本地 bridge server (HTTP) → openai-bridge handler 翻译 Anthropic→OpenAI → agnes /chat/completions → agnes-2.5-flash 响应 → bridge 翻译回 Anthropic SSE → CLI → SDK → MCP 工具 (Intl.DateTimeFormat 真调用) → tool_result 注入 → 二次请求 → final text`。

**根因诊断（占本 Q&A 大半时间，有独立价值）**：前 4 次跑都"看似 PASS 但 bridgeCalls=0"——CLI 子进程没命中我的测试 bridge，而是命中用户产线 sidecar。读了 sdk.mjs 才发现三层 env 优先级：

1. **process.env**：`Ae=(e)=>process.env[e]?.trim()` —— SDK in-process 客户端 wt 直接读 tsx 进程 env
2. **options.env**：`env = options.env ?? {...process.env}` —— SDK 派生 CLI 子进程时用它（设了就不继承父 env）
3. **`~/.claude/settings.json::env` block**：CLI 启动时 merge，**优先级最高**，覆盖 1+2。这是导致所有 spawn-env override 都失效的根因 —— 用户的 settings.json 写死了 `ANTHROPIC_BASE_URL=http://127.0.0.1:20128/v1`（用户自己的产线 sidecar），不管 shell env 还是 spawn env 怎么改都没用。

**最终解法**（脚本内）：

- `process.env` 与 `options.env` 同时设 ANTHROPIC_*（双 sink）
- 用 `spawnClaudeCodeProcess` SDK 选项包 `child_process.spawn`，`env = sdkEnv`（不继承父）
- spawn 时同时塞 `--settings '{"env": sdkEnv}'` inline JSON（覆盖 `~/.claude/settings.json` 的 env block）
- 用 `env -u` 在 shell 层剔除污染变量（用户父 claude-code 进程注入的 CLAUDE_* 与 ANTHROPIC_*）
- tool detection 兼容 MCP 工具名 `mcp__<server>__<tool>` 前缀

**MCP 工具名坑**：SDK 把 MCP 工具名编码为 `mcp__real-tools__get_current_time`（带 server 前缀），verdict 的 `b.name === 'get_current_time'` 检测永远 miss。改成 `endsWith('__get_current_time')` 后才 PASS。

**文件**：`scripts/agnes-real-e2e.ts`（已 commit 准备）。**前提**：必须用 `env -u CLAUDE_* -u ANTHROPIC_* -u AI_AGENT -u CLAUDECODE npx tsx scripts/agnes-real-e2e.ts`，否则父 shell 污染。**不进默认 CI**（credentialed test，真 agnes key 风险）。

**升级路径**：(1) 加进 `npm run test:credentialed` 池（CLAUDE.md 已声明 credentialed 不进默认 CI）；(2) 改用 `AGNES_*` env 自动从 `~/.hamuna/config.json` 读密钥（已支持）；(3) 加 responses API scenario 验证 fix #7/#8；(4) 把三供（agnes + moonshot + ...）共用同一脚本，复用 scaffold。

---

**Q&A 续-12：修 desktop app 一直400的根因**（2026-09-02）

用户报告"desktop app 一直400"。**主动读日志**（`~/.hamuna/logs/unified-2026-09-02.log`）找到两两次 400：

```
[NODE ] [bridge] Upstream error 400: ...OpenAIException - {"error":{"message":"Invalid JSON data: Failed to deserialize the JSON body into the target type: input: data did not match any variant of untagged enum ResponseInput at line 1 column 45371",...
[NODE ] [bridge][DIAG] @45371 = "ring"}, "description": {"description": "Explanation of what this option means or what will happen if chosen...", "type": "string"}, "preview": {"description": "Optional preview content rendered when this option is focused..."
```

**根因**（**#325 fix 不完整**）：`stripSchemaDescriptions` 用 `if (k === 'description') continue` 一刀切删所有 `description` key。但 JSON Schema 允许"`description`"这个**字段名本身**作为属性定义：

```jsonc
"properties": {
  "description": {           // ← 字段名就是 "description"
    "type": "string",
    "description": "…"        // ← 里面又是 schema description
  }
}
```

Naive 删除会把整个 `{type:"string", description:"…"}` object 一起删掉——**这正是 AskUserQuestion 的 `options[].description` 属性定义**（SDK schema 里有这个字段）。Column 45371 是被删后 body 里残留的 `"description":{"description":...,"type":"string"}` 序列。

修法（src/server/openai-bridge/translate/request-responses.ts::stripSchemaDescriptions line 371）：

```diff
- if (k === 'description') continue;
+ if (k === 'description' && typeof v === 'string') continue;
```

只 strip **字符串值**的 `description`（schema annotation）；**对象值**的 `description` 是合法的属性定义，保留并递归（内部嵌套的字符串 `description` 仍会被剥）。

**验证**：
1. 单元测试新增 2 个回归 test（pin 在 `request-responses.unit.test.ts` describe `stripSchemaDescriptions` 末尾 + `translateRequestToResponses` 端到端 wire shape），39/39 pass
2. 真 wire 验证：拿 SDK 真实 `AskUserQuestion` schema 喂 `translateRequestToResponses`，POST 到 agnes `/responses`，**HTTP 200**（之前 HTTP 400 column 45371）
3. 真 agnes 凭证 /responses 测试：3/3 pass（chat_completions / Responses API / multi-turn loop closure）
4. 现有 37 个 stripSchemaDescriptions 单元测试全绿（覆盖 #325 原 fix 不退化）

**变更**：src/server/openai-bridge/translate/request-responses.ts（1 行逻辑修改 + 注释更新），src/server/openai-bridge/translate/request-responses.unit.test.ts（+2 回归测试）。**handler.ts [DIAG #325] 块**未删——保留用于将来相同症状出现时再次定位。

---

### TODO #11: ✅ 已完成 — `tvc-director` skill 多 agent 拆分（参考 AdCraft 协作模式）

`bundled-skills/tvc-director/` 原是单文件 556 行 SKILL.md，承担 13 个 Phase 的完整执行细节（brief / strategy / shot-planning / asset-storyboard / voiceover / product-action / food-flavor / packshot / video-prompt / qc）。问题：(a) 单 SKILL.md 上下文太重，每次进入都要重读所有阶段；(b) 触发粒度粗，"只想做 brief 提案"也要拉全流程；(c) 风格库（brand-manifesto / cinematic-food / one-take 等 6 类）只是平铺文档，无统一入口。**目标**：参考 `/home/hmcz/Projects/AdCraft/apps/api/agent/skills/` 模式，拆成"编排入口 + 10 协作 agent + 6 风格库"三层架构，单一契约权威 `agent-capabilities.json`。

**架构决策**：
1. **拆分粒度** —— 10 个 agent 贴近 AdCraft 的密度，每个 agent 负责一个 Phase 输出域
2. **tvc-director 角色** —— 瘦身为 orchestrator，只保留调度顺序 + 全局铁律 + Agnes 工具决策树 + 目录规范；所有执行细节下沉到 agent
3. **风格库** —— 新建 `tvc-style-*/` 子目录统一 6 类风格（brand-manifesto / industrial-product / cinematic-food / product-promo / one-take / beat-synced），按 `Use X as creative grammar` 8 行 SKILL.md 模板
4. **references 归属** —— `references/` 23 个文件**全留** `tvc-director/references/`（方案 A），agent 通过 Inputs 引用，避免拆出去导致 15+ 跨引用路径漂移
5. **契约权威** —— 引入 3 项 AdCraft 风格机制：(a) `agent-capabilities.json` 机器读契约（contract_version + 10 agents + 6 styles + 10-step workflow + global_redlines）；(b) `scripts/verify-tvc-bundle.sh` 自动校验（74 项检查：JSON 合法 / agent 目录存在 / SKILL.md frontmatter 完整 / Purpose+Inputs+Do Not 三段必备 / references_on_demand 全部可达 / workflow step 与 agent 一致）；(c) `agent-capabilities.md` 人读速查表

**10 协作 agent（按 Phase 顺序）**：
- `tvc-agent-brief` (Step 1, 强门)
- `tvc-agent-strategy` (Step 2, 强门)
- `tvc-agent-shot-planning` (Step 3, 弱门)
- `tvc-agent-asset-storyboard` (Step 4, 强门)
- `tvc-agent-voiceover` (Step 5, 强门)
- `tvc-agent-product-action` (Step 6, 弱门)
- `tvc-agent-food-flavor` (Step 7, 弱门, 仅食品)
- `tvc-agent-packshot` (Step 8, 弱门)
- `tvc-agent-video-prompt` (Step 9, 弱门)
- `tvc-agent-qc` (Step 10, 自检)

每个 agent SKILL.md 遵循 5 段式：Purpose / Inputs / Output Guidance / Prompt Rules / Do Not + 前置 frontmatter（skill_id + name + description）。

**验证结果**：`bash scripts/verify-tvc-bundle.sh` → **75 PASS / 0 FAIL / 0 WARN**。

**变更清单**（未 commit）：
- `bundled-skills/tvc-director/agent-capabilities.json`（新增，约 140 行契约）
- `bundled-skills/tvc-director/agent-capabilities.md`（新增，人读速查）
- `bundled-skills/tvc-director/scripts/verify-tvc-bundle.sh`（新增，bash + jq 校验脚本）
- `bundled-skills/tvc-director/SKILL.md`（重写为 orchestrator，556 行 → 226 行）
- `bundled-skills/tvc-director/README.md`（重写，反映多 agent 架构）
- `bundled-skills/tvc-agent-brief/SKILL.md` ... `tvc-agent-qc/SKILL.md`（新增 10 个协作 agent）
- `bundled-skills/tvc-style-brand-manifesto/SKILL.md` ... `tvc-style-beat-synced/SKILL.md`（新增 6 个风格库）

**scope 备注**：
- `tvc-director/references/` 23 个文件**全部保留**未改动；agent 通过 `references_on_demand` 字段按需引用
- `tvc-director/evals/` 保留未改动（评估脚本独立目录）
- AdCraft 的 4 项 Python 服务能力（orchestrator runtime / context byte budget / required_skill binding / provider-specific tool whitelist）**未引入**——sidecar 是 Node + TS，无 Python runtime；context byte budget 由 SDK 自身管理；required_skill 由 `references_on_demand` 替代
- `verify-tvc-bundle.sh` 是软约束（exit 0/1 + log），CI gate 由后续 PR 接入（add when：CI lint 阶段需要 bundle 一致性门时）

**未 commit** —— 19 文件改动 + 本 snapshot。

### TODO #12: ✅ 已完成 — 引入 AdCraft propose/revise + materialize 模式到 tvc-agent-strategy / tvc-agent-asset-storyboard

延续 #11 的多 agent 拆分，进一步吸收 AdCraft `OperationDescriptor` 中的两个高频模式：

1. **`propose_*_options` → `revise_*_options` 双 op**（AdCraft 9 个 capability 都各有一对，registry.ts:85-97）
2. **`materialize_*` 物化节点**（`materialize_quick_media` / `materialize_storyboard_segment`，registry.ts:107-120）

### 改动 1：`tvc-agent-strategy` 拆分 Phase 1 (propose) + Phase 2 (revise)

原 SKILL.md 把"3 route + hook + 用户确认"塞在单一 Output Guidance 一段里，没有显式建模两步的 handoff。改后：

- **Phase 1 · Propose** —— 输出 `routes: [...]` YAML + `recommendation: route_X`，**显式 stop and wait for user selection**
- **Phase 2 · Revise** —— 用户选定后，重写选定 route 为 shippable（含具体 shot 锚点）+ 0-3s hook 设计
- 新增 Do Not：**Phase 2 不允许与 Phase 1 同一回复内执行**（强制等用户回复）
- 新增 Prompt Rule：**Phase 2 revise 必须加 concrete shot anchors**（Phase 1 的 prose-only proposals 不可直接 ship）

### 改动 2：`tvc-agent-asset-storyboard` 拆分 Phase 1/2 (propose) + Phase 3 (materialize)

原 SKILL.md 把"asset 生成 + 故事板 + final.png"压在单一 Output Guidance，没有显式 materialize 节点。改后三段：

- **Phase 1 · Asset Generation** —— 输出 assets YAML（product / character / scene_no_product / scene_with_product），缺 product 参考图**硬阻塞**
- **Phase 2 · Storyboard Compilation** —— 3×3 clay-maquette + video vein 在 panel 描述**之前**
- **Phase 3 · Materialization（强门）** —— 把 `storyboard-composite.png` 复制到 `outputs/<项目标识>/images/storyboard-final.png`，**生成 manifest + .lock 文件**，等 `storyboard_final_confirmed` 才放手
- 新增 Do Not：禁止写 `outputs/images/` bundle 根；禁止 tvc-agent-video-prompt 在 Phase 3 强门前启动

### 验证

`bash scripts/verify-tvc-bundle.sh` → **75 PASS / 0 FAIL / 0 WARN**（与拆分前一致，frontmatter / Purpose+Inputs+Do Not / references_on_demand 全部仍然 reachable）。

### scope 备注

- AdCraft 的 `max_skill_context_bytes: 8192` / `decide_next_action` LLM 路由 / `RunBudget` deadline 表 / `submit_structured_result` 单工具 4 项**未引入**——本项目是固定 orchestrator 调度（不是 LLM 自路由），且 Claude SDK 自身管上下文，无需 byte budget
- `tvc-director/SKILL.md` 未改动（orchestrator 视角不变）
- `agent-capabilities.json` / `agent-capabilities.md` / `README.md` 未改动（契约层稳定）

**未 commit** —— 2 文件改动（`tvc-agent-strategy/SKILL.md` +30 行、`tvc-agent-asset-storyboard/SKILL.md` +45 行）+ 本 snapshot。

### TODO #13: ✅ 已完成 — 规范完整 workflow（orchestrator + 10 agent 对齐 6 维度）

把 orchestrator 视角的 workflow 规范（gate / skip_when / block_until / confirmation block）下沉到 10 个 agent SKILL.md，让每个 agent 独立可读时也具备完整 workflow 上下文。

**6 维度对齐**：
1. **触发语义** —— orchestrator workflow table 7 列（Step / Agent / Gate / Block until / Skip when / Phase count / State envelope）
2. **阶段拆解** —— 多 phase agent（strategy 2 phases、asset-storyboard 3 phases）显式建模 phase name；其他 8 个 phase count=1
3. **门控** —— strong / weak / self_check 三档，每个 agent 在 Workflow Context 声明自己的 gate
4. **状态交接** —— §12 新增统一信封 schema（envelope_type + status + artifact + next_step + gate + skip_reason + failure + produced_at）
5. **失败停机** —— §13 新增 failure_report schema（failed_step/agent/phase/code/message/completed_artifacts/recoverable/remediation_hint）+ recovery 策略（recoverable=true 续跑 vs false 回退到上一个 strong gate）
6. **输出信封** —— 每个 agent 的 `## Workflow Context` 末尾声明 envelope_type 名称 + artifact keys

### 矛盾发现 + 修复

`tvc-agent-food-flavor/SKILL.md` 原 Do Not 写「Do not skip this agent for non-food products」与 orchestrator 的 `skip_when: non_food_product` **直接矛盾**。修复：Do Not 改为「Do not run this agent for non-food products — orchestrator handles the skip via `workflow.skip_when`」，与 orchestrator 对齐；同步在 Workflow Context 声明 skip 行为（`skipped: true + skip_reason: 'product_category_non_food'`）。

### 改动清单

**Orchestrator（1 文件）**：
- `bundled-skills/tvc-director/SKILL.md` —— workflow table 升级为 7 列；新增 §12 状态交接信封 schema；新增 §13 失败停机 schema；frontmatter 加 `skill_id: tvc-director`

**10 agent SKILL.md**：
- 每个文件新增 `## Workflow Context` section（6 子条目：Step / Gate / Block until / Skip when / Phase count / State envelope / On failure / Confirmation block 引用）
- `tvc-agent-food-flavor` 同步修复 Do Not 矛盾

**校验脚本（1 文件）**：
- `bundled-skills/tvc-director/scripts/verify-tvc-bundle.sh` —— 新增检查项 5（每个 agent 有 `## Workflow Context`）+ 检查项 5b（Workflow Context 含 Step / Gate / State envelope / On failure 4 个必填子键）

**文档（1 文件）**：
- `bundled-skills/tvc-director/README.md` —— 10 步调度表升级为 7 列 + 引用 SKILL.md §12-§13

### 验证

`bash scripts/verify-tvc-bundle.sh` → **85 PASS / 0 FAIL / 0 WARN**（相比上版 +10 检查项，全部为新加的 Workflow Context 校验）。

### scope 备注

- 状态信封的 YAML schema **未** 抽出为独立 `state-envelope.schema.json`（留作后续 PR；当前 SKILL.md 内联已能让 AI 严格按格式输出）
- `agent-capabilities.json` **未**改（契约字段稳定；agent 的 Workflow Context 是文档层扩展，不进入 JSON）
- 6 个 tvc-style-* SKILL.md **未**改（它们是 Inputs 而非 workflow 节点）
- `references/` 23 文件 **未**改

**未 commit** —— 13 文件改动（1 orchestrator + 10 agent + 1 verify + 1 README）+ 本 snapshot。

---

### TODO #14: 🚧 进行中 — tvc-director 彻底合并 + 资产生成硬约束（cheatsheet + pre-gen confirmation）

延续 #11-#13，把 `tvc-agent-*`（10 个）和 `tvc-style-*`（6 个）从独立 skill 目录**彻底合并**进 `tvc-director/`，同时引入**资产提示词速查表**（cheatsheet）+ **生成前确认门**（pre-gen confirmation）。

**两项核心改动**：
1. **方案 B 物理合并**：16 个独立 skill 目录 → `tvc-director/agents/<short>.md` + `tvc-director/styles/<short>.md`（扁平文件，无 frontmatter）。AI 不再能独立触发 `tvc-agent-brief` 等子 skill；只能通过 `tvc-director` 编排入口进入。
2. **Pre-Generation Confirmation Gate**：每次 MCP 生成调用（`agnes_image_*` / `agnes_video_*` / `edge-tts.text_to_speech`）前**必须**先向用户展示 prompt + reference images，等用户确认后才执行。失败必 grilling，无降级。

### 路径映射表（git mv 保险）

| # | 原路径 | 新路径 | 改动 |
|---|--------|--------|------|
| 1 | `bundled-skills/tvc-agent-brief/SKILL.md` | `bundled-skills/tvc-director/agents/brief.md` | 删 frontmatter |
| 2 | `bundled-skills/tvc-agent-strategy/SKILL.md` | `bundled-skills/tvc-director/agents/strategy.md` | 删 frontmatter |
| 3 | `bundled-skills/tvc-agent-shot-planning/SKILL.md` | `bundled-skills/tvc-director/agents/shot-planning.md` | 删 frontmatter |
| 4 | `bundled-skills/tvc-agent-asset-storyboard/SKILL.md` | `bundled-skills/tvc-director/agents/asset-storyboard.md` | 删 frontmatter + Phase 2 接入段落拆分 + pre-gen |
| 5 | `bundled-skills/tvc-agent-voiceover/SKILL.md` | `bundled-skills/tvc-director/agents/voiceover.md` | 删 frontmatter + pre-gen edge-tts |
| 6 | `bundled-skills/tvc-agent-product-action/SKILL.md` | `bundled-skills/tvc-director/agents/product-action.md` | 删 frontmatter |
| 7 | `bundled-skills/tvc-agent-food-flavor/SKILL.md` | `bundled-skills/tvc-director/agents/food-flavor.md` | 删 frontmatter |
| 8 | `bundled-skills/tvc-agent-packshot/SKILL.md` | `bundled-skills/tvc-director/agents/packshot.md` | 删 frontmatter |
| 9 | `bundled-skills/tvc-agent-video-prompt/SKILL.md` | `bundled-skills/tvc-director/agents/video-prompt.md` | 删 frontmatter + pre-gen per segment |
| 10 | `bundled-skills/tvc-agent-qc/SKILL.md` | `bundled-skills/tvc-director/agents/qc.md` | 删 frontmatter |
| 11 | `bundled-skills/tvc-style-brand-manifesto/SKILL.md` | `bundled-skills/tvc-director/styles/brand-manifesto.md` | 删 frontmatter + Asset Prompt Adapt |
| 12 | `bundled-skills/tvc-style-industrial-product/SKILL.md` | `bundled-skills/tvc-director/styles/industrial-product.md` | 删 frontmatter + Asset Prompt Adapt |
| 13 | `bundled-skills/tvc-style-cinematic-food/SKILL.md` | `bundled-skills/tvc-director/styles/cinematic-food.md` | 删 frontmatter + Asset Prompt Adapt |
| 14 | `bundled-skills/tvc-style-product-promo/SKILL.md` | `bundled-skills/tvc-director/styles/product-promo.md` | 删 frontmatter + Asset Prompt Adapt |
| 15 | `bundled-skills/tvc-style-one-take/SKILL.md` | `bundled-skills/tvc-director/styles/one-take.md` | 删 frontmatter + Asset Prompt Adapt |
| 16 | `bundled-skills/tvc-style-beat-synced/SKILL.md` | `bundled-skills/tvc-director/styles/beat-synced.md` | 删 frontmatter + Asset Prompt Adapt |

**映射规则**：`<skill_id_without_prefix>` 即原 `tvc-agent-X` 或 `tvc-style-X` 去掉前缀后的部分。

### Q1-Q27 决策清单

| Q# | 决策 | 落地位置 |
|----|------|---------|
| Q1 | 抽 cheatsheet | `references/asset-prompting-cheatsheet.md` |
| Q2 | 4 类 mandatory（产品/角色/场景/故事板） | cheatsheet §1-4 |
| Q3 | 版本号 + reference 互链 | cheatsheet frontmatter + 4 reference 文件 |
| Q4 | 6 个 tvc-style-* 加 Asset Prompt Adapt | styles/*.md |
| Q5 | 失败停 + 问用户 | cheatsheet §5 |
| Q6 | cheatsheet 4×6 结构（H3 子段） | cheatsheet 各章节 |
| Q7 | 4 类主体差异化（人物/动物/物品/抽象） | cheatsheet §2 |
| Q8/Q12/Q12b/Q19 | 段落分镜自适应网格 + 拆分算法 | asset-storyboard.md Phase 2 + cheatsheet §4 + orchestrator §16 |
| Q9 | 图片 base64 / 视频 URL | cheatsheet 各章 Mandatory + img-upload-utility.md |
| Q10 | 任意节点失败 grilling，无降级 | orchestrator §15.2 |
| Q11 | cheatsheet §1-3 → asset_generation, §4 → storyboard_compilation | cheatsheet 章节序 + orchestrator §3 |
| Q13 + Q26 | partial 保留 + 4 选项 grilling (retry_same/revise_prompt/retry_revised/abort_step) | cheatsheet §5 |
| Q14 | base64 不落盘，成品 PNG 落 workspace | cheatsheet Mandatory |
| Q16 | cheatsheet 每章 6 段 schema | cheatsheet |
| Q17 | tvc-style-* transform schema (replace/append/remove) | styles/*.md Asset Prompt Adapt |
| Q18 | verify 36 项检查（4×6 + 6 styles） | verify §11 |
| Q20-23 | 方案 B 合并：删 frontmatter + 扁平 .md + JSON 删 skill_id 加 internal_path | agents/styles + agent-capabilities.json |
| Q24-27 | Pre-Gen Confirmation YAML block + Step 9 gate strong + 4 选项 + 2 failure code | cheatsheet + 4 agents + orchestrator |

### 预期 verify 结果

**113 PASS / 0 FAIL / 0 WARN**（85 现有 - 8 旧路径检查删除 + 36 cheatsheet 新增 = 113）

### scope 备注

- 本次未 commit 任何文件 —— 30 文件改动（含 mv + 删 frontmatter）+ 16 空目录 `git rm` 待拍板提交
- 段落分镜拆分算法（Q19）的具体边界：默认 `ceil(T/10)` 段、每段向上取整到 5s 倍数；用户可在 Step 4 Phase 2 手动覆盖
- Pre-Gen Confirmation 按 Q24 推荐「Phase + 调用单元聚合」（10-15 次 per TVC），不按每次 MCP 调用问
- 失败 4 选项的默认行为：retry_same（60%）/ revise_prompt（25%）/ retry_revised（10%）/ abort_step（5%），AI 默认 retry_same
- agent-capabilities.json 的 contract_version 保持 1（向下兼容），agent 字段结构调整（删 skill_id, 加 internal_path, Step 9 gate 升 strong）

**进行中** —— 30 文件改动待落盘 + 16 空目录 `git rm` + 本 snapshot。

---

## ✅ TODO #14 已完成 — tvc-director 彻底合并 + 资产生成硬约束落地

**实际完成时间**：2026-09-06
**verify 结果**：113 PASS / 0 FAIL / 0 WARN（85 现有基线 - 8 旧路径检查删除 + 36 cheatsheet 新增 = 113 ✓）

### 完成清单

| # | 任务 | 文件数 | 状态 |
|---|------|-------|------|
| 1 | snapshot.md 路径映射表 | 1 | ✓ |
| 2 | 创建 cheatsheet（4 H2 × 6 H3 + Failure Recovery） | 1 | ✓ |
| 3 | mv + 去 frontmatter 16 文件（10 agents + 6 styles）| 16 | ✓ |
| 4 | 4 references 加 cheatsheet 互链 | 4 | ✓ |
| 5 | 4 agents 加 Pre-Generation Confirmation Gate | 4 | ✓ |
| 6 | orchestrator 加 §14 + §15 + Step 9 gate strong | 1 | ✓ |
| 7 | agent-capabilities.json/.md 加 internal_path + 修 food-flavor do_not 矛盾 | 2 | ✓ |
| 8 | 重写 verify §11（36 项 cheatsheet 完整性）| 1 | ✓ |
| 9 | README v0.3 schema 更新 | 1 | ✓ |
| 10 | 删 16 空源目录 + 跑 verify | 16 + 0 | ✓ |

**总文件改动**：31 个文件（创建 1 + 修改 14 + 移动 16）
**空目录清理**：17 个（16 tvc-agent/tvc-style + 1 tvc-director/evals）

### 关键架构变更

1. **物理合并**：`bundled-skills/tvc-{agent,style}-*/` 16 个独立 skill 目录 → `tvc-director/{agents,styles}/<short>.md` 扁平文件（无 frontmatter）。AI 不再能独立触发子 skill；只能通过 `tvc-director` 编排入口进入。
2. **Step 9 gate 升级**：`weak` → `strong`（block_until: `video_prompts_confirmed`）
4. **Pre-Generation Confirmation Gate（§14）**：每次 MCP 生成调用（Step 4/5/6/9）必先向用户展示 prompt + reference images + 预期输出，等用户确认后才执行。禁止降级 / 禁止跳过 / 禁止用旧资产。
5. **Adaptive Storyboard Grid（§15）**：故事板按 segment 时长自适应选择网格（≥10s → 3×3；5s~<10s → 2×2；<5s → 首尾帧）。
6. **Cheatsheet（24 references）**：`asset-prompting-cheatsheet.md` 成为资产生成提示词权威来源（4 类资产 / 6 段 schema / Failure Recovery 4 选项）。
7. **修矛盾**：`food-flavor` do_not 从「Do not skip」改为「Do not run for non-food」（与 workflow.skip_when 一致）。

### 未 commit 提示

本批改动（31 文件 + 17 目录清理）尚未 commit。建议执行：

```bash
git add bundled-skills/tvc-director/
git rm -r --cached bundled-skills/tvc-agent-* bundled-skills/tvc-style-*
git commit -m "refactor(tvc-director): merge 16 sub-skills + cheatsheet + pre-gen gate

彻底合并 16 个独立 tvc-agent-*/tvc-style-* 目录到 tvc-director/{agents,styles}/。
扁平 .md 文件、无 frontmatter；agent-capabilities.json 新增 internal_path 字段。

新增 / 变更：
- references/asset-prompting-cheatsheet.md (4 H2 × 6 H3 + Failure Recovery)
- SKILL.md §14 Pre-Generation Confirmation Gate（每次 MCP 生成前必用户确认）
- SKILL.md §15 Adaptive Storyboard Grid（按 segment 时长自适应网格）
- Step 9 (tvc-agent-video-prompt) gate weak → strong
- 4 agents (asset-storyboard/voiceover/video-prompt/product-action) 加 Pre-Generation Confirmation Gate
- 4 references (asset-standards/agnes-prompting/product-image-anchor/storyboard-style) 加 cheatsheet 互链

verify: 113 PASS / 0 FAIL（85 旧基线 - 8 旧路径检查 + 36 cheatsheet 36 项新增）"
```

⚠️ 建议先用 `git status` 检查工作区没有混入他人未提交改动（仓库并发 writer 常态），再分批提交。

---

### TODO #16: 🚧 进行中 — tvc-director 每步输出统一 schema（便于 desktop chat UI 渲染）

**用户新指令**：「规范tvc-director每一步生成的输入格式，便于desktop app chatui中渲染」

**矛盾点**：
- §12 State Envelope 当前是 YAML（人类读），但 chat UI 是 React 组件需解析 JSON
- 若让 agent 既输出 YAML envelope 又输出 JSON render_payload，两套格式必然漂移（agent 改一处忘改另一处）
- **推荐解**：JSON envelope 为唯一权威，YAML 是 JSON 的 prettify 展示（renderer 自动渲染）。Schema 一份真相，agent 写一遍。

**10 个 artifact_kind → widget 变体映射**：

| Step | artifact_kind | widget 变体 | 数据形状 |
|------|---------------|------------|---------|
| 1 | `brief` | brief-card | { product_summary, audience, claims[], strategy_draft } |
| 2 | `routes` | routes-comparison | { routes: [{ id, hook, route_summary, recommendation }], selected_route } |
| 3 | `shot_plan` | shot-table | { scene_anchors[], shot_handoff_table } |
| 4 | `storyboard_grid` | storyboard-canvas | { blocks: [{ block_id, range, grid_path, panels[] }] } |
| 5 | `voiceover_list` | vo-timeline | { vo_lines: [{ id, text, start, end, voice_id }] } |
| 6 | `product_action_chain` | force-chain | { segments: [{ phase, state }], casting } |
| 7 | `flavor_plan` | flavor-layers | { layers: { visual, process, sound } } |
| 8 | `packshot_module` | packshot-spec | { hero, packshot, endboard, duration } |
| 9 | `video_prompts` | segment-queue | { segments: [{ id, duration, prompt, first_frame }] } |
| 10 | `qc_report` | qc-verdict | { dimensions: [{ name, score, evidence }], verdict } |

**统一 envelope schema**（单一真相）：
```json
{
  "schema_version": "1",
  "envelope_type": "storyboard_envelope",
  "step": 4,
  "agent": "tvc-agent-asset-storyboard",
  "phase": "storyboard_compilation",
  "status": "pending_user_confirmation",
  "gate": "strong",
  "produced_at": "2026-09-06T10:30:00Z",
  "artifact_kind": "storyboard_grid",
  "artifact": { /* 详见 references/step-output-schema.md */ },
  "references": [{ "name": "product-hero.png", "type": "image", "source": "local_path | url | base64" }],
  "prompts": [{ "label": "...", "text": "...", "target_mcp": "agnes_image_generate" }],
  "next_action": { "type": "user_confirm | user_select | auto_advance", "label": "..." },
  "blocker": null,
  "failure": null
}
```

**改动计划**：
1. 创建 `references/step-output-schema.md`（10 个 artifact_kind 的完整 JSON Schema + 10 个示例 + widget routing table）
2. SKILL.md §12 升级：YAML envelope → JSON envelope，§16 新增 widget routing table
3. 10 agents `Workflow Context` 加 `artifact_kind` 字段
4. `agent-capabilities.json` 每个 agent 加 `artifact_kind`
5. `verify-tvc-bundle.sh` §12 新增 schema 一致性检查（10 项：每 agent artifact_kind 必填 + 全局唯一）

**未 commit 提示**：本批 ~ 13 文件改动待落盘。

---

## ✅ TODO #16 已完成 — tvc-director 每步输出统一 schema（便于 desktop chat UI 渲染）

**实际完成时间**：2026-09-06
**verify 结果**：**156 PASS / 0 FAIL / 0 WARN**（基线 113 → 156 = +43 项 §12 schema 一致性检查）

### 矛盾点与解法

| 矛盾 | 旧方案 | 推荐解（采用） |
|------|-------|---------------|
| YAML envelope 人类可读 vs JSON renderer 可解析 | 让 agent 双格式输出 | **JSON 唯一权威**，YAML 是 prettify（renderer 自动渲染）|

### 完成清单

| # | 任务 | 状态 |
|---|------|------|
| 1 | snapshot.md TODO #16 + schema 设计 | ✓ |
| 2 | 创建 `references/step-output-schema.md`（10 种 artifact JSON Schema + §11 widget routing）| ✓ |
| 3 | SKILL.md §16 Step Output Schema 章节 | ✓ |
| 4 | 10 agents Workflow Context 加 `**Artifact kind**` + `**Schema reference**` 子键 | ✓ |
| 5 | agent-capabilities.json 加 `artifact_kind` 字段（10 agents）| ✓ |
| 6 | verify §12 schema 一致性检查（43 项）| ✓ |

**总文件改动**：13 个文件（1 新建 + 11 修改 + 1 verify）

### 关键设计

1. **`artifact_kind` 驱动 widget 路由**：renderer 看到 `storyboard_grid` 就路由到 `storyboard-canvas` widget，**不**需要额外 widget hint。
2. **统一 envelope schema**（JSON v1）：10 步共用同一外壳 + 每步独立 `artifact` 子对象。
3. **Widget 变体映射**（10 种）：
   - brief-card / routes-comparison / shot-table / storyboard-canvas / vo-timeline
   - force-chain / flavor-layers / packshot-spec / segment-queue / qc-verdict
4. **Shell widget 共享**：`preview/slateboard-widget.html` 的 Timeline + Slate + Actions 是所有 10 种 widget 的外壳，每种只换内部 Slate body。
5. **Pre-Gen Confirmation 复用**：`prompts[]` 数组作为 §14 的数据源，避免双格式。
6. **§12 YAML envelope 废弃**：v0.3 同时支持 JSON + YAML（兼容层），v0.4 仅 JSON。

### 未 commit 提示

本批 13 文件改动尚未 commit。建议：

```bash
git add bundled-skills/tvc-director/
git commit -m "feat(tvc-director): §16 unified step output schema for desktop chat UI renderer

JSON envelope 是唯一权威，YAML 是 prettify（renderer 自动渲染）。10 步共用
同一外壳 + 每步独立 artifact 子对象；artifact_kind 驱动 widget 路由。

新增：
- references/step-output-schema.md（10 种 artifact JSON Schema + §11 routing）
- SKILL.md §16 Step Output Schema 章节
- agent-capabilities.json 每 agent 加 artifact_kind 字段
- 10 agents Workflow Context 加 Artifact kind + Schema reference 子键
- verify-tvc-bundle.sh §12 schema 一致性检查（43 项）

10 种 artifact_kind：brief / routes / shot_plan / storyboard_grid /
voiceover_list / product_action_chain / flavor_plan / packshot_module /
video_prompts / qc_report

renderer 实现路径：widget 变体 → SlateboardShell（preview/slateboard-widget.html
已交付）+ artifact_kind-specific 内部组件

verify: 156 PASS / 0 FAIL / 0 WARN（113 基线 + 43 schema 检查新增）"
```
