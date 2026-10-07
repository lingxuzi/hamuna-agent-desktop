/**
 * MiniApp iframe 侧 `window.app` runtime（对齐 OpenBitFun `miniapp-dev` 设计）。
 *
 * 注入到 srcDoc 的 `<head>`，在 MiniApp 自己的 `ui.js` 之前执行，因此
 * `ui.js` 里可以直接 `await app.storage.get(...)`，无需自己处理握手。
 *
 * 职责边界：runtime 只做**协议编码**（调用 → postMessage，回应 → Promise），
 * 真正的权限判定与执行全在宿主（`appBridge.ts`）。这样 runtime 可以在
 * `connect-src 'none'` 的 iframe 里工作 —— 它不出网。
 *
 * 为什么 nonce 由宿主铸造、runtime 不自造：`host.ready` 之前的调用必须排队，
 * 否则 iframe 加载竞态会让首批调用静默丢失。规则与
 * `bubbleClaimBridge.ts::verifyBubbleClaim` 一致。
 */

import { APP_CALL_KIND, APP_RESULT_KIND } from '../../../shared/miniapp/app-protocol';
import { THEME_TOKEN_STYLE_ID } from './theme-tokens';

/**
 * 标记本段 runtime 脚本的结尾。
 *
 * 宿主需要它来把「作者第一段脚本」在最终 srcDoc 里的起始行号算出来，再作为
 * `authorLineOffset` 传回 `buildAppRuntimeScript`（原因见该函数参数注释）。
 * 用注释而不是标识符：它必须对 JS 解析器完全不可见，又不能包含会提前闭合
 * `<script>` 元素的序列。
 */
export const APP_RUNTIME_END_MARKER = '/*__hamuna_runtime_end__*/';

/**
 * 数出「本段 runtime 结束、作者第一段脚本内容开始」之前，文档共有多少行。
 *
 * 浏览器把内联脚本的语法错误报在**整份拼装文档**的坐标上，而宿主在作者代码
 * 前面插了主题 CSS 与本段 runtime（作者自己的 style.css 也排在两者之间）。
 * 不换算的话，作者会拿到自己 180 行文件里的「第 1168 行」——一个指不到处的
 * 位置比没有位置更糟。
 *
 * 必须由拼装方在**字符串上**算，不能在 iframe 里遍历 DOM：解析错误触发时，
 * 出错的那段脚本还没进 `document.scripts`（实测 offset 恒为 0）。
 *
 * 注意锚点取的是标签内的**内容**起点而非 `<script` 本身 ——
 * `inline_miniapp_siblings` 产出的是 `<script>\n…content…`，标签自己那一行
 * 不属于作者代码；差这一行，报出来就是「第 80 行」而不是真实的「第 79 行」。
 *
 * @param documentText 已注入 runtime 的完整 srcDoc
 * @returns 行号偏移；找不到锚点时返回 0（此时横幅宁可不报行号也不报错的）
 */
export function countAuthorLineOffset(documentText: string): number {
  const markerAt = documentText.indexOf(APP_RUNTIME_END_MARKER);
  if (markerAt < 0) return 0;
  const scriptAt = documentText.indexOf('<script', markerAt);
  if (scriptAt < 0) return 0;
  let contentStart = documentText.indexOf('>', scriptAt) + 1;
  if (documentText.charCodeAt(contentStart) === 10) contentStart++;
  let lines = 0;
  for (let i = 0; i < contentStart; i++) {
    if (documentText.charCodeAt(i) === 10) lines++;
  }
  return lines;
}

/**
 * 生成 runtime 脚本文本。
 *
 * 刻意写成不依赖任何 bundler runtime 的经典脚本：MiniApp iframe 的 CSP 是
 * `script-src 'unsafe-inline'` —— **不含** `'self'`，iframe 是 opaque origin，且兄弟
 * 文件早在 Rust 侧就内联掉了。本段以字符串内联注入，用模板字面量而非 import/export。
 *
 * @param appId 绑定到本 iframe 的应用 id；每条请求都会带上，宿主据此防冒名。
 * @param authorLineOffset 本段 runtime 结束、作者第一段脚本开始之前，文档里共有
 *   多少行。由宿主（MiniAppRunner）按最终拼装结果算出 —— 见下方说明为什么不能
 *   在 iframe 里自己数。
 */
export function buildAppRuntimeScript(appId: string, authorLineOffset = 0): string {
  const safeAppId = JSON.stringify(appId);
  return `(function () {
  'use strict';
  if (window.app) return; // 幂等：srcDoc 重建时不会重复注入

  // 哨兵：让下面 authorLineOffset() 能认出「哪段内联脚本是本段 runtime」，
  // 从而把作者代码的起始行号算出来。见该函数注释。
  var __hamuna_app_runtime__ = true;

  var APP_ID = ${safeAppId};
  var nonce = null;
  var pending = {};   // id -> {resolve, reject}
  var listeners = { event: [], appearance: [], locale: [], agent: [] };

  function mintId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // 参考文档给 app.ai.chat 配了 onChunk / onDone / onError 回调，但回调函数过不了
  // postMessage 的结构化克隆。撞上那堵墙时作者看到的是一句"参数不可克隆"，
  // 不知道该往哪改。这里先拦下来，给一句能照着做的说明。
  // 以 reject 而不是 throw 收场：作者多半写的是 await app.ai.chat(...).catch(...)，
  // 同步抛出接不住。
  function callbackRejection(method, opts) {
    if (!opts || typeof opts !== 'object') return null;
    for (var key in opts) {
      if (typeof opts[key] === 'function') {
        var err = new Error(
          'app.' + method + ' does not support callback options (' + key +
          '): functions cannot cross the iframe postMessage boundary. ' +
          'Await the returned text instead, or poll app.storage for progress.'
        );
        err.code = 'APP_UNSUPPORTED_CALLBACK';
        return err;
      }
    }
    return null;
  }

  // 取消类 API 的入参归一：参考文档给的是位置参数（app.ai.cancel(streamId)），
  // 但早期文档示例也出现过 { run_id }。两种都收，且**只有字符串被采纳** ——
  // 静默把 undefined 当 runId 送去，副作用是"取消打空却不报错"，作者无从察觉。
  function runIdOf(id) {
    if (typeof id === 'string') return id;
    if (id && typeof id === 'object' && typeof id.run_id === 'string') return id.run_id;
    return undefined;
  }

  // 宿主未就绪时的调用先入队。host.ready 到达后统一冲刷 —— iframe 解析完成前
  // 发的 postMessage 会被浏览器丢弃，排队是唯一可靠做法。
  var queued = [];

  function dispatch(method, params) {
    return new Promise(function (resolve, reject) {
      var frame = { method: method, params: params, resolve: resolve, reject: reject };
      if (!nonce) { queued.push(frame); return; }
      send(frame);
    });
  }

  function send(frame) {
    var id = mintId();
    pending[id] = frame;
    try {
      window.parent.postMessage({
        kind: ${JSON.stringify(APP_CALL_KIND)},
        nonce: nonce,
        id: id,
        payload: { method: frame.method, params: frame.params, appId: APP_ID }
      }, '*');
    } catch (e) {
      // postMessage 走结构化克隆，克隆不了的值会在这里抛。最常见的来源是作者
      // 按参考文档给 app.ai.chat 传回调（onChunk / onDone / onError）—— 函数
      // 不可克隆。
      //
      // 为什么必须在这里兜住而不只是"文档别这么写"：flush 队列那条路径是从
      // host.ready 的 message listener 里调的，不在 Promise executor 内。抛错
      // 会变成 listener 里的未捕获异常，作者那侧的 Promise **永远不 settle** ——
      // 表现是"点了没反应，也不报错"，比直接失败难查一个量级。哪怕这条调用
      // 最终注定要失败，也必须以 reject 收场。
      var err = new Error(
        'app.' + frame.method + ' arguments are not structured-cloneable: ' +
        ((e && e.message) || String(e))
      );
      err.code = 'APP_CALL_NOT_SERIALIZABLE';
      frame.reject(err);
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var d = event.data;
    if (!d || typeof d !== 'object') return;

    if (d.kind === 'host.ready' && typeof d.nonce === 'string') {
      nonce = d.nonce;
      // 宿主启动参数：appearance / locale / 平台，放在 ready 里一并下发，
      // 避免 runtime 自己去猜宿主主题。
      if (d.env && typeof d.env === 'object') {
        applyEnv(d.env);
      }
      queued.splice(0).forEach(send);
      emit('event', { type: 'ready' });
      return;
    }

    if (d.kind === ${JSON.stringify(APP_RESULT_KIND)}) {
      if (typeof d.nonce !== 'string' || d.nonce !== nonce) return;
      var frame = pending[d.id];
      if (!frame) return;
      delete pending[d.id];
      if (d.ok) frame.resolve(d.result);
      else {
        var err = new Error((d.error && d.error.message) || 'app call failed');
        err.code = (d.error && d.error.code) || 'HOST_ERROR';
        frame.reject(err);
      }
      return;
    }

    // 宿主主动事件（主题 / 语言变更 / Agent 流式输出）
    // 先 applyEnv 再 emit：监听者通常在自己的 handler 里重新渲染，而 app.t()
    // 读的是 env.locale。若先 emit，回调跑起来时 env 还是旧语言，onLocaleChange
    // 只能让作者自己拼字符串绕开 app.t —— 那就等于白给了一个"语言变了"的通知。
    // applyEnv 内部跳过 undefined，畸形事件不会把 env 洗成 undefined。
    if (d.kind === 'app.event' && typeof d.type === 'string') {
      if (d.type === 'theme.change') {
        applyEnv({ appearanceMode: d.appearanceMode });
        applyThemeTokens(d.tokenCss);
        emit('appearance', d);
      }
      else if (d.type === 'locale.change') { applyEnv({ locale: d.locale }); emit('locale', d.locale); }
      // agent.* 走独立通道：Agent 的流式 delta 频率很高，混进通用 event
      // 会让只想监听主题变更的作者被迫过滤大量无关负载。
      else if (d.type.indexOf('agent.') === 0) emit('agent', d);
      else emit('event', d);
    }
  });

  function emit(channel, payload) {
    (listeners[channel] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error('[app] listener failed', e); }
    });
  }

  function on(channel, fn) {
    if (typeof fn !== 'function') return function () {};
    (listeners[channel] = listeners[channel] || []).push(fn);
    return function () {
      listeners[channel] = listeners[channel].filter(function (f) { return f !== fn; });
    };
  }

  var env = {
    appearanceMode: 'dark',
    locale: 'en-US',
    platform: 'unknown',
    workspaceDir: '',
    appDataDir: ''
  };

  function applyEnv(next) {
    for (var k in next) {
      if (Object.prototype.hasOwnProperty.call(next, k) && next[k] !== undefined) {
        env[k] = next[k];
      }
    }
  }

  // 宿主切主题 / 亮暗时下发的新 token CSS，改写首屏那个 <style> 的内容。
  //
  // 用 textContent 而不是 innerHTML：style 元素按 HTML 规范走 fragment parsing
  // 的 RAWTEXT 模式，两者其实等价，但 textContent 的意图没有歧义。真正要紧的是
  // **复用同一个元素**（首屏 srcDoc 里那个）—— 每次推送都新建一个的话，用户切二十
  // 次主题就多二十个 style 标签。（变异验证：去掉复用，本条的 style 数量断言会红。）
  //
  // 元素本不该不存在 —— 首屏烤进了 srcDoc。仍兜一层 createElement：runtime 是所有
  // MiniApp 共享的同一段脚本，宿主改版或作者删掉那个 style 后，主题变更不该静默失效。
  function applyThemeTokens(css) {
    if (typeof css !== 'string' || css === '') return;
    // 无 DOM 环境直接跳过，和 readThemeTokens() 同一个惯例。这里抛出去会变成
    // message listener 里的未捕获异常，把后面 emit('appearance') 一起吞掉 ——
    // 作者的 onAppearanceChange 会静默失灵，比样式没刷新更难查。
    if (typeof document === 'undefined') return;
    var el = document.getElementById(${JSON.stringify(THEME_TOKEN_STYLE_ID)});
    if (!el) {
      el = document.createElement('style');
      el.id = ${JSON.stringify(THEME_TOKEN_STYLE_ID)};
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css;
  }

  // ── 能力门面 ────────────────────────────────────────────────────────────
  // 每个方法都直连宿主；权限不足时宿主 reject，runtime 原样抛出（带 code），
  // 作者据此提示用户，而不是静默失败。
  var app = {
    appId: APP_ID,
    mode: 'hosted',

    get appearanceMode() { return env.appearanceMode; },
    get locale() { return env.locale; },
    get platform() { return env.platform; },
    // 两个路径 getter。宿主已经把它们放进 host.ready 的 env，但之前这里
    // 没有对应的 getter —— 作者按 api-reference 写 app.workspaceDir 拿到
    // undefined，fs.writeFile(path) 于是拼出 "undefined/x"。这类"声明了但
    // 没有出口"的字段比缺字段更难排查：类型检查不报错，运行时才炸。
    get workspaceDir() { return env.workspaceDir; },
    get appDataDir() { return env.appDataDir; },

    fs: {
      readFile: function (p, o) { return dispatch('fs.readFile', { path: p, opts: o || null }); },
      writeFile: function (p, d, o) { return dispatch('fs.writeFile', { path: p, data: d, opts: o || null }); },
      appendFile: function (p, d) { return dispatch('fs.appendFile', { path: p, data: d }); },
      readdir: function (p, o) { return dispatch('fs.readdir', { path: p, opts: o || null }); },
      mkdir: function (p, o) { return dispatch('fs.mkdir', { path: p, opts: o || null }); },
      rm: function (p, o) { return dispatch('fs.rm', { path: p, opts: o || null }); },
      rmdir: function (p) { return dispatch('fs.rmdir', { path: p }); },
      unlink: function (p) { return dispatch('fs.unlink', { path: p }); },
      stat: function (p) { return dispatch('fs.stat', { path: p }); },
      lstat: function (p) { return dispatch('fs.lstat', { path: p }); },
      access: function (p) { return dispatch('fs.access', { path: p }); },
      copyFile: function (a, b) { return dispatch('fs.copyFile', { from: a, to: b }); },
      rename: function (a, b) { return dispatch('fs.rename', { from: a, to: b }); }
    },

    shell: {
      exec: function (cmd, o) { return dispatch('shell.exec', { command: cmd, opts: o || null }); }
    },

    net: {
      fetch: function (url, o) { return dispatch('net.fetch', { url: url, opts: o || null }); }
    },

    os: {
      info: function () { return dispatch('os.info', null); }
    },

    storage: {
      get: function (k) { return dispatch('storage.get', { key: k }); },
      set: function (k, v) { return dispatch('storage.set', { key: k, value: v }); },
      remove: function (k) { return dispatch('storage.remove', { key: k }); }
    },

    // 宿主 AI：复用宿主已配置的 Provider，MiniApp 不需要（也不应该）持有 Key。
    // 模型无工具、无文件系统访问 —— 纯文本能力。需要读写文件请用 app.agent。
    ai: {
      complete: function (prompt, o) {
        var bad = callbackRejection('ai.complete', o);
        if (bad) return Promise.reject(bad);
        return dispatch('ai.complete', {
          prompt: prompt,
          run_id: o && o.run_id,
          model: o && o.model,
          opts: o || null
        });
      },
      chat: function (prompt, o) {
        var bad = callbackRejection('ai.chat', o);
        if (bad) return Promise.reject(bad);
        return dispatch('ai.chat', {
          prompt: prompt,
          run_id: o && o.run_id,
          model: o && o.model,
          opts: o || null
        });
      },
      // 中止一个在途的 complete/chat。补全可能跑满 60s，作者必须有办法停。
      // 返回 {cancelled:boolean, inflightCount:number}：cancelled=false 表示
      // 该 runId 已经结束（正常结果，不是错误）。
      //
      // 两种入参都收：参考文档写的是位置参数 app.ai.cancel(handle.streamId)，
      // 只认 {run_id} 的话照文档写的作者会拿到 undefined —— 取消静默打空，
      // 而不是报错。接受字符串是向后兼容的超集。
      cancel: function (id) {
        return dispatch('ai.cancel', { run_id: runIdOf(id) });
      },
      getModels: function () { return dispatch('ai.getModels', null); }
    },

    // MiniApp 自有隐藏 Agent 会话：有工具、能读写工作区、多轮有状态。
    // 与 ai 的权限开关相互独立（meta.permissions.agent.enabled）。
    agent: {
      // 参考文档给的是 ensureSession({sessionName, appDataWorkspace})。本项目
      // 没有 sessionName（会话 id 由 miniapp_<appId>_<runId> 决定），但
      // appDataWorkspace 要**接住** —— 之前这里无参硬传 null，作者传了就在
      // iframe 这层被吞掉，后面 renderer 与 sidecar 谁都看不见，表现为
      // "我明明挑了子目录，run 却跑在 appdata 根上"。
      // 注意：本文件整体是一个模板字符串，注释里不能出现反引号。
      ensureSession: function (o) {
        return dispatch('agent.ensureSession', { appDataWorkspace: o && o.appDataWorkspace });
      },
      run: function (prompt, o) {
        return dispatch('agent.run', {
          prompt: prompt,
          run_id: o && o.run_id,
          model: o && o.model,
          timeout_ms: o && o.timeout_ms,
          // 参考文档把 ensureSession 的返回值回传过来。传了就必须对得上
          // 本 MiniApp 的会话（sidecar 侧校验），不会再被静默忽略。
          sessionId: o && o.sessionId,
          appDataWorkspace: o && o.appDataWorkspace
        });
      },
      // turnText 是 run 的语义化别名：强调"接上一轮继续说"，让作者不必
      // 自己记住 run_id —— 隐藏会话天然有上下文。
      turnText: function (text, o) {
        return dispatch('agent.turnText', {
          prompt: text,
          run_id: o && o.run_id,
          model: o && o.model,
          timeout_ms: o && o.timeout_ms,
          sessionId: o && o.sessionId,
          appDataWorkspace: o && o.appDataWorkspace
        });
      },
      cancel: function (id) {
        return dispatch('agent.cancel', { run_id: runIdOf(id) });
      },
      // 订阅流式事件。回调收到 { type, text?, runId? }，其中 type 是
      // 'agent.delta' / 'agent.complete' / 'agent.stopped' / 'agent.error' 之一。
      //
      // 刻意**同步**返回退订函数而不是 Promise：它是事件订阅 API，作者写
      // "const off = app.agent.onEvent(fn)" 就能拿到清理句柄。注册的同时向
      // host 发一次握手，把 Agent sidecar 与 SSE 通道拉起来 —— 否则这条通道
      // 没有生产者，就成了"能注册却永远收不到事件"的空壳。
      onEvent: function (fn) {
        if (typeof fn !== 'function') return function () {};
        var off = on('agent', fn);
        dispatch('agent.onEvent', null).catch(function () {
          // 握手失败不阻断注册：host 稍后仍可能通过 app.event 推事件，
          // 而让这里抛错会让作者以为整个订阅失效。
        });
        return off;
      }
    },

    dialog: {
      open: function (o) { return dispatch('dialog.open', o || null); },
      save: function (o) { return dispatch('dialog.save', o || null); },
      // 两种写法都收：对象形态 message({message, kind})，以及
      // message(text, {kind})。后者是 SKILL.md 教给作者的写法，此前这里只取
      // 第一个参数，于是那句调用把文本和 kind **一起**丢掉，宿主收到裸字符串
      // → asRecord 变 {} → INVALID_PARAMS。两种形态在宿主侧汇合成同一个信封，
      // 作者不必知道内部是哪一种。
      message: function (text, opts) {
        if (typeof text === 'string') {
          var merged = {};
          var k;
          for (k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) merged[k] = opts[k];
          merged.message = text;
          return dispatch('dialog.message', merged);
        }
        return dispatch('dialog.message', text || null);
      }
    },

    clipboard: {
      readText: function () { return dispatch('clipboard.readText', null); },
      writeText: function (t) { return dispatch('clipboard.writeText', { text: t }); }
    },

    // 自定义 worker 方法（meta.permissions.node.enabled 必须为 true）
    call: function (method, params) { return dispatch('call.call', { method: method, params: params === undefined ? null : params }); },

    on: on.bind(null, 'event'),
    onAppearanceChange: function (fn) { return on('appearance', fn); },
    onLocaleChange: function (fn) { return on('locale', fn); },
    onActivate: function (fn) { return on('event', function (p) { if (p && p.type === 'activate') fn(p); }); },
    onDeactivate: function (fn) { return on('event', function (p) { if (p && p.type === 'deactivate') fn(p); }); }
  };

  // 多语言挑选：locale → en-US → zh-CN → 首值 → fallback（与 OpenBitFun 一致）
  app.t = function (table, fallback) {
    if (table && typeof table === 'object') {
      if (table[env.locale] !== undefined) return table[env.locale];
      if (table['en-US'] !== undefined) return table['en-US'];
      if (table['zh-CN'] !== undefined) return table['zh-CN'];
      for (var k in table) {
        if (Object.prototype.hasOwnProperty.call(table, k)) return table[k];
      }
    }
    return fallback;
  };

  window.app = app;
  ${APP_RUNTIME_END_MARKER}

  // ── 脚本错误可见化 ──────────────────────────────────────────────────────
  //
  // 装在这里（app 脚本之前）而不是宿主侧，是因为**解析错误只有浏览器知道**。
  // 一个不能解析的 ui.js 会被整个丢弃：不绑定任何 listener、不执行任何 render，
  // 页面原样留下静态 HTML —— 没有异常、没有 console 错误、没有失败态。
  // 实测一个真实生成产物就是这样：标题、三个统计块、输入框全都正常显示，
  // 而 6 条待办一条都没渲染，截图评审看到的是"朴素但完整"而不是"根本没跑"。
  //
  // 之所以之前没人发现：宿主不注入全局 error handler，MiniApp 又跑在 sandbox
  // iframe 里，错误既不冒泡到宿主文档也没有 unhandledrejection 兜底。
  //
  // 只用 addEventListener，不同时赋 window.onerror —— 两者会各报一次同一条错误
  // （实测如此），横幅会重复。
  //
  // 刻意不吞掉错误：不 preventDefault、不 stopPropagation，console 里仍留原始
  // 报错。这里只**额外**给人看一眼，不改变浏览器的错误语义。
  var errorSurfaceInstalled = false;
  // 浏览器报的 lineno 是**拼装后整份文档**的行号：宿主把作者的 style.css 与
  // ui.js 内联进 srcdoc 之前，先注入了主题 CSS 和本段 runtime。作者看到的
  // 1100 多行在自己 180 行的文件里根本不存在 —— 报一个指不到处的行号比不报
  // 更糟，作者会照着找一个永远不存在的 bug。
  //
  // 偏移量由宿主按**最终拼装结果**算好后传进来，而不是在 iframe 里遍历 DOM 数：
  // 解析错误触发时，出错的那段脚本还没进 document.scripts（实测 offset 恒为 0），
  // 而且作者的 style.css 就排在本段 runtime 与 ui.js 之间，只数 runtime 之前的
  // 部分会漏掉整整一份 CSS（实测漏 500 多行）。只有拼装方知道确切的行数。
  var AUTHOR_LINE_OFFSET = ${Math.max(0, authorLineOffset)};

  function showScriptError(message, line, col) {
    if (errorSurfaceInstalled) return;   // 只报第一条：首个错误最有诊断价值
    errorSurfaceInstalled = true;
    // 换算不回正数就干脆不给行号，宁可少说也不要指错地方。
    var authorLine = line == null ? null : line - AUTHOR_LINE_OFFSET;
    if (authorLine == null || authorLine < 1) authorLine = null;
    try {
      var host = document.createElement('div');
      host.id = 'hamuna-app-error';
      // 用 iframe 里已经注入的主题 token，不写死颜色：换主题时横幅跟着换。
      var title = document.createElement('strong');
      title.textContent = 'MiniApp 脚本未能运行';
      var detail = document.createElement('div');
      detail.textContent = String(message || 'unknown error');
      var where = document.createElement('div');
      where.textContent = (authorLine ? 'ui.js 第 ' + authorLine + ' 行' : '')
        + ' · 该文件被浏览器整体丢弃，页面只剩静态 HTML';
      detail.style.marginTop = '6px';
      detail.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
      detail.style.whiteSpace = 'pre-wrap';
      detail.style.wordBreak = 'break-word';
      where.style.marginTop = '6px';
      where.style.opacity = '0.75';
      where.style.fontSize = '12px';
      host.appendChild(title);
      host.appendChild(detail);
      host.appendChild(where);
      host.setAttribute('style', [
        'position:fixed',
        'inset:auto 12px 12px 12px',
        'z-index:2147483647',
        'padding:12px 14px',
        'border-radius:8px',
        'border:1px solid var(--hamuna-error, #b3261e)',
        'background:var(--hamuna-bg-elevated, #fff)',
        'color:var(--hamuna-text-primary, #1c1612)',
        'box-shadow:0 8px 24px rgba(0,0,0,0.18)',
        'font:13px/1.5 var(--hamuna-font-sans, system-ui, sans-serif)',
      ].join(';'));
      (document.body || document.documentElement).appendChild(host);
    } catch (e) {
      // 横幅画不出来也不能连累原始错误：它是附加信息，不是错误通道。
    }
  }
  window.addEventListener('error', function (ev) {
    // resource 错误（img/fetch 等）没有 message，交给作者自己处理，不算脚本挂掉。
    if (!ev || typeof ev.message !== 'string' || !ev.message) return;
    showScriptError(ev.message, ev.lineno, ev.colno);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    showScriptError('Unhandled promise rejection: ' +
      ((r && (r.message || r.stack)) || String(r)), null, null);
  });
})();`;
}
