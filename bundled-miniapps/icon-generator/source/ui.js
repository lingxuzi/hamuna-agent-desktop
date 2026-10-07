// icon-generator/source/ui.js
// Runs inside the iframe MiniAppRunner sandbox (allow-scripts allow-same-origin
// allow-forms; no popups / no top-nav). No third-party CDN, no fetch to
// outside the host's CSP allow-list.
//
// `window.app` is injected by the host before this file runs (see
// `appRuntimeScript.ts`): use `app.storage` for persistence and
// `app.shell.exec` / `app.fs.*` for the capabilities `meta.json` grants. There
// is NO `app.ai` — the host has no AI bridge for MiniApps, so a "generate with
// AI" button here must hand the work to Chat via Bubble Claim instead.
//
// Bubble Claim flow (`continue-chat-btn`) uses the BubbleClaimBridge we wired
// in MiniAppRunner: this MiniApp posts `chat.claimComposer` with the bound
// nonce + appId, the host verifies and surfaces a composer draft in Chat.

const APP_ID =
  document.querySelector('meta[name="x-miniapp-id"]')?.getAttribute('content') || 'icon-generator';

// Persisted state goes through `app.storage` (the host-injected `window.app`).
// The template used to point at `window.__miniappStorage`, which never existed
// in the host — every `get` threw a TypeError and the selection silently reset
// on reload. `app.storage` is backed by the app's own `storage.json`.
const storage = {
  get: (key) => app.storage.get(key),
  set: (key, value) => app.storage.set(key, value),
};

// ───── tiny in-iframe helpers ──────────────────────────────────────────
// Phase 2 v0.4 has no Rust `cmd_miniapp_ai_complete`; the demo uses a
// deterministic palette so the UI can be exercised end-to-end. Phase 3
// replaces these with calls through `app.ai.chat` (the host bridges to
// `cmd_miniapp_ai_complete` → gemini-image-tool SSE).
const PLACEHOLDER_VARIANTS = ['🎨', '🖌️', '✏️', '🎭', '🎪', '🎬'];
const hashString = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const els = {
  prompt: document.getElementById('prompt-input'),
  genBtn: document.getElementById('gen-btn'),
  grid: document.getElementById('candidate-grid'),
  canvas: document.getElementById('icon-output'),
  editBtn: document.getElementById('edit-btn'),
  continueChatBtn: document.getElementById('continue-chat-btn'),
  exportBtn: document.getElementById('export-btn'),
  refInput: document.getElementById('ref-input'),
  refStatus: document.getElementById('ref-status'),
  status: document.getElementById('status'),
};

const ctx = els.canvas.getContext('2d');
let selectedIdx = null;
/** 当前这一轮的候选，主题切换后重绘要用 —— drawSelected 只吃一个 icon。 */
let currentVariants = [];
let nonce = null;
/** Claims raised before the host's `host.ready` arrived. */
const pendingClaims = [];

// The host mints a Bubble Claim nonce per iframe session and posts it as
// `host.ready` once the frame's document has loaded. A MiniApp must NOT invent
// its own: `verifyBubbleClaim` rejects any claim whose nonce doesn't match, so
// a self-minted nonce means every claim is silently dropped.
//
// Claims raised before `host.ready` arrives are held in `pendingClaims` and
// flushed the moment the nonce shows up.
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const data = event.data;
  if (!data || data.kind !== 'host.ready' || typeof data.nonce !== 'string') return;
  nonce = data.nonce;
  const queued = pendingClaims;
  pendingClaims.length = 0;
  queued.forEach(sendBubbleClaim);
});

const setStatus = (msg) => {
  els.status.textContent = msg;
};

// ───── candidate generation (placeholder until Phase 3) ────────────────
function generateCandidates(prompt) {
  const seed = hashString(prompt || 'default');
  const out = [];
  for (let i = 0; i < 4; i++) {
    out.push(PLACEHOLDER_VARIANTS[(seed + i) % PLACEHOLDER_VARIANTS.length]);
  }
  return out;
}

function renderCandidates(variants) {
  currentVariants = variants;
  els.grid.innerHTML = '';
  variants.forEach((icon, i) => {
    const cell = document.createElement('div');
    cell.className = 'candidate';
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('data-variant', String(i));
    cell.setAttribute('aria-label', `candidate ${i + 1}`);
    cell.textContent = icon;
    cell.addEventListener('click', () => selectVariant(i, variants));
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectVariant(i, variants);
      }
    });
    els.grid.appendChild(cell);
  });
}

function selectVariant(idx, variants) {
  selectedIdx = idx;
  [...els.grid.children].forEach((c, i) =>
    c.classList.toggle('selected', i === idx),
  );
  drawSelected(variants[idx]);
}

function drawSelected(icon) {
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  // 画布的 fillStyle 读不到 CSS 变量，只能在绘制那一刻把 token 取出来用。
  // 之前这里写死 '#2563eb'：宿主换主题后图标预览仍是一块蓝，与整个应用脱色。
  // 取不到 token 时保持上一次的 fillStyle —— 赋值空串是非法值，会被静默忽略。
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--hamuna-accent')
    .trim();
  if (accent) ctx.fillStyle = accent;
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.font = '160px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, els.canvas.width / 2, els.canvas.height / 2);
}

// ───── Bubble Claim ────────────────────────────────────────────────────
// Posts a `chat.claimComposer` envelope to the host. The host's
// BubbleClaimBridge verifies source === iframe.contentWindow + nonce +
// appId before forwarding to Chat's composer.
function postBubbleClaim({ draft, attachments }) {
  // Not ready yet — the host hasn't handed us a nonce. Queue rather than drop,
  // so a fast click right after mount still reaches the Chat composer.
  if (!nonce) {
    pendingClaims.push({ draft, attachments });
    return;
  }
  sendBubbleClaim({ draft, attachments });
}

function sendBubbleClaim({ draft, attachments }) {
  const payload = {
    appId: APP_ID,
    draft,
    ...(attachments ? { attachments } : {}),
  };
  window.parent.postMessage(
    {
      kind: 'chat.claimComposer',
      nonce,
      payload,
    },
    '*',
  );
}

// ───── wire UI ─────────────────────────────────────────────────────────
els.genBtn.addEventListener('click', async () => {
  const prompt = els.prompt.value.trim();
  if (!prompt) {
    setStatus('Enter a prompt first.');
    return;
  }
  setStatus('Generating…');
  els.genBtn.disabled = true;
  // Placeholder until Phase 3 wires `cmd_miniapp_ai_complete`.
  const variants = generateCandidates(prompt);
  renderCandidates(variants);
  selectedIdx = null;
  // Persist the last prompt so a reload resumes where the user left off.
  try {
    await storage.set('lastPrompt', prompt);
  } catch (e) {
    setStatus('Could not save prompt: ' + (e && e.message ? e.message : 'unknown error'));
  }
  setStatus('Pick a candidate to edit or export.');
  els.genBtn.disabled = false;
});

els.editBtn.addEventListener('click', () => {
  if (selectedIdx === null) {
    setStatus('Pick a candidate first.');
    return;
  }
  setStatus('Edit support lands in Phase 3 (cursor transform + filter API).');
});

els.continueChatBtn.addEventListener('click', () => {
  if (selectedIdx === null) {
    setStatus('Pick a candidate first.');
    return;
  }
  const prompt = els.prompt.value.trim();
  postBubbleClaim({
    draft: `Continue editing icon-generator's icon — prompt was "${prompt}"`,
    attachments: [],
  });
  setStatus('Draft pushed to Chat composer.');
});

els.exportBtn.addEventListener('click', () => {
  if (selectedIdx === null) {
    setStatus('Pick a candidate first.');
    return;
  }
  els.canvas.toBlob((blob) => {
    if (!blob) {
      setStatus('Export failed.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `icon-generator-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported.');
  }, 'image/png');
});

els.refInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  // Phase 2 v0.4 doesn't have `cmd_miniapp_context_files` invoke yet; show a
  // friendly status. Phase 3 will post a `contextFiles.upload` claim and the
  // host will save it via saveToolAttachment.
  els.refStatus.textContent = `Selected: ${file.name} (upload wired in Phase 3)`;
});

// 宿主换主题 / 换亮暗后，token 已经被改写，但画布是位图，不会自己更新。
// 没有这一行，预览会一直停在上一个主题的颜色上，直到用户点了别的候选。
app.onAppearanceChange(() => {
  if (selectedIdx !== null && currentVariants[selectedIdx] !== undefined) {
    drawSelected(currentVariants[selectedIdx]);
  }
});

// Restore the last prompt on mount. A storage failure is non-fatal — the app is
// fully usable without persistence, so degrade instead of blocking the UI.
(async () => {
  try {
    const last = await storage.get('lastPrompt');
    if (typeof last === 'string' && last) els.prompt.value = last;
  } catch {
    /* no persisted prompt */
  }
})();
