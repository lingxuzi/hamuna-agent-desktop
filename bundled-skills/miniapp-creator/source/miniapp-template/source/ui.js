// ui.js — MiniApp interaction logic.
//
// `window.app` is injected by the host BEFORE this file runs, so you can call
// `app.storage` / `app.fs` / `app.shell` directly. No handshake, no nonce, no
// hand-rolled postMessage.
//
// Capabilities are permission-gated by meta.json; a denied call rejects with
// `err.code === 'PERMISSION_DENIED'`. Always surface failures in the UI —
// silently swallowing them is the most common way a MiniApp looks broken.
document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('app');
  if (root) root.textContent = 'Hello from MiniApp';

  // Persisted state example. `app.storage` needs no permission declaration;
  // it is always scoped to this app's own storage.json.
  try {
    const visits = (await app.storage.get('visits')) || 0;
    await app.storage.set('visits', visits + 1);
  } catch (err) {
    console.warn('[miniapp] storage unavailable:', err && err.message);
  }
});
