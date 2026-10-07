// Git Graph demo ui.js — talks to the MiniApp worker pool via postMessage.
//
// Wire protocol: parent → iframe (worker.call) and iframe → parent
// (worker.result). The host (`MiniAppRunner` + `workerCallBridge.ts`)
// verifies the iframe identity before forwarding to
// `/api/miniapp/worker/call`. Method allow-list is enforced in
// `WORKER_METHOD_ALLOWLIST['git-graph']`.

(function () {
  const appIdMeta = document.querySelector('meta[name="x-miniapp-id"]');
  const appId = appIdMeta ? appIdMeta.getAttribute('content') : 'git-graph';

  const cwdInput = document.getElementById('cwd-input');
  const loadBtn = document.getElementById('load-btn');
  const graphEl = document.getElementById('commit-graph');
  const logEl = document.getElementById('commit-log');
  const branchSelect = document.getElementById('branch-select');
  const checkoutBtn = document.getElementById('checkout-btn');
  const statusEl = document.getElementById('status');

  let nextId = 1;

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', !!isError);
  }

  function mintNonce() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `nonce-${Date.now()}-${Math.random()}`;
  }

  function mintId() {
    return `req-${Date.now()}-${nextId++}`;
  }

  // `window.app` is injected by the host before this script runs (see
  // `appRuntimeScript.ts`). It owns the nonce and the request/response pairing,
  // so this MiniApp no longer hand-rolls a postMessage protocol — which is how
  // the previous version silently lost calls made before `worker.ready`.
  function workerCall(method, params) {
    return app.call(method, params);
  }

  async function loadRepo() {
    const cwd = (cwdInput.value || '').trim();
    if (!cwd) {
      setStatus('Enter a repository path', true);
      return;
    }
    setStatus('Loading…');
    loadBtn.disabled = true;
    try {
      const [log, status] = await Promise.all([
        workerCall('git.log', { cwd, max: 50 }),
        workerCall('git.status', { cwd }),
      ]);
      renderLog(log);
      renderBranches(status);
      setStatus(`Loaded ${log.all.length} commits`);
    } catch (e) {
      setStatus(e.message || String(e), true);
    } finally {
      loadBtn.disabled = false;
    }
  }

  function renderLog(log) {
    if (!log || !Array.isArray(log.all)) {
      graphEl.textContent = '(no commits)';
      logEl.innerHTML = '';
      return;
    }
    // Mini graph: dot + line for each commit
    graphEl.textContent =
      log.all
        .map((entry) => {
          const hash = entry.hash.slice(0, 7);
          return `* ${hash} ${entry.message || ''}`;
        })
        .join('\n') || '(no commits)';

    logEl.innerHTML = '';
    for (const entry of log.all) {
      const li = document.createElement('li');
      const hash = document.createElement('span');
      hash.className = 'hash';
      hash.textContent = entry.hash.slice(0, 7);
      const msg = document.createElement('span');
      msg.textContent = entry.message || '';
      li.appendChild(hash);
      li.appendChild(msg);
      logEl.appendChild(li);
    }
  }

  function renderBranches(status) {
    branchSelect.innerHTML = '';
    if (!status || !Array.isArray(status.branches)) {
      const opt = document.createElement('option');
      opt.textContent = '(no branches)';
      branchSelect.appendChild(opt);
      return;
    }
    for (const branch of status.branches) {
      const opt = document.createElement('option');
      opt.value = branch;
      opt.textContent = branch + (branch === status.current ? ' (current)' : '');
      if (branch === status.current) opt.selected = true;
      branchSelect.appendChild(opt);
    }
  }

  async function checkoutBranch() {
    const cwd = (cwdInput.value || '').trim();
    const branch = branchSelect.value;
    if (!cwd || !branch) {
      setStatus('Pick a repository and branch first', true);
      return;
    }
    setStatus(`Checking out ${branch}…`);
    checkoutBtn.disabled = true;
    try {
      await workerCall('git.checkout', { cwd, branch });
      setStatus(`Switched to ${branch}`);
      await loadRepo();
    } catch (e) {
      setStatus(e.message || String(e), true);
    } finally {
      checkoutBtn.disabled = false;
    }
  }

  loadBtn.addEventListener('click', loadRepo);
  checkoutBtn.addEventListener('click', checkoutBranch);
  cwdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadRepo();
  });
})();
