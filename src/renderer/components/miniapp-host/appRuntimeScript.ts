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

/**
 * 生成 runtime 脚本文本。
 *
 * 刻意写成不依赖任何 bundler runtime 的经典脚本：MiniApp iframe 的 CSP 是
 * `script-src 'unsafe-inline' 'self'`，本段以字符串内联注入，用模板字面量而非
 * import/export。
 *
 * @param appId 绑定到本 iframe 的应用 id；每条请求都会带上，宿主据此防冒名。
 */
export function buildAppRuntimeScript(appId: string): string {
  const safeAppId = JSON.stringify(appId);
  return `(function () {
  'use strict';
  if (window.app) return; // 幂等：srcDoc 重建时不会重复注入

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
    window.parent.postMessage({
      kind: ${JSON.stringify(APP_CALL_KIND)},
      nonce: nonce,
      id: id,
      payload: { method: frame.method, params: frame.params, appId: APP_ID }
    }, '*');
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
    if (d.kind === 'app.event' && typeof d.type === 'string') {
      if (d.type === 'theme.change') emit('appearance', d);
      else if (d.type === 'locale.change') emit('locale', d.locale);
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
    platform: 'unknown'
  };

  function applyEnv(next) {
    for (var k in next) {
      if (Object.prototype.hasOwnProperty.call(next, k) && next[k] !== undefined) {
        env[k] = next[k];
      }
    }
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
        return dispatch('ai.complete', {
          prompt: prompt,
          model: o && o.model,
          opts: o || null
        });
      },
      chat: function (prompt, o) {
        return dispatch('ai.chat', {
          prompt: prompt,
          model: o && o.model,
          opts: o || null
        });
      },
      cancel: function () { return dispatch('ai.cancel', null); },
      getModels: function () { return dispatch('ai.getModels', null); }
    },

    // MiniApp 自有隐藏 Agent 会话：有工具、能读写工作区、多轮有状态。
    // 与 ai 的权限开关相互独立（meta.permissions.agent.enabled）。
    agent: {
      ensureSession: function () { return dispatch('agent.ensureSession', null); },
      run: function (prompt, o) {
        return dispatch('agent.run', {
          prompt: prompt,
          run_id: o && o.run_id,
          model: o && o.model,
          timeout_ms: o && o.timeout_ms
        });
      },
      // turnText 是 run 的语义化别名：强调"接上一轮继续说"，让作者不必
      // 自己记住 run_id —— 隐藏会话天然有上下文。
      turnText: function (text, o) {
        return dispatch('agent.turnText', {
          prompt: text,
          run_id: o && o.run_id,
          model: o && o.model,
          timeout_ms: o && o.timeout_ms
        });
      },
      cancel: function (o) {
        return dispatch('agent.cancel', { run_id: o && o.run_id });
      },
      onEvent: function (fn) { return on('agent', fn); }
    },

    dialog: {
      open: function (o) { return dispatch('dialog.open', o || null); },
      save: function (o) { return dispatch('dialog.save', o || null); },
      message: function (o) { return dispatch('dialog.message', o || null); }
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
})();`;
}
