// icon-generator/source/ui.js — Phase 2 v0.4 demo.
// Runs inside the iframe MiniAppRunner sandbox (allow-scripts allow-same-origin
// allow-forms; no popups / no top-nav). No third-party CDN, no fetch to
// outside the host's CSP allow-list.
//
// Phase 2 v0.4 ships this UI but NOT the Rust invokes (`cmd_miniapp_ai_complete`
// / `cmd_miniapp_context_files` were cut in the 13→2 invoke reduction). The
// handlers below call `window.parent.postMessage` to bridge back to the host;
// Phase 3 wires those messages to the Rust invokes. Until then the Generate
// button uses a deterministic placeholder so the UI is testable end-to-end.
//
// Bubble Claim flow (`continue-chat-btn`) uses the BubbleClaimBridge we wired
// in MiniAppRunner: this MiniApp posts `chat.claimComposer` with the bound
// nonce + appId, the host verifies and surfaces a composer draft in Chat.

const APP_ID =
  document.querySelector('meta[name="x-miniapp-id"]')?.getAttribute('content') || 'icon-generator';

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
let nonce = null;

// Mint a Bubble Claim nonce in sync with the host. MiniAppRunner re-mints on
// appId change; if `__bubbleClaimNonce__` is already injected we use it,
// otherwise we generate our own and the host discards the message (defense
// in depth — never trust a nonce the MiniApp invents unilaterally).
nonce =
  window.parent?.__bubbleClaimNonce__ ||
  `nonce-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

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
  ctx.fillStyle = '#2563eb';
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
els.genBtn.addEventListener('click', () => {
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
