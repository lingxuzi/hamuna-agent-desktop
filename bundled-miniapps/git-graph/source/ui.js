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

  function workerCall(method, params) {
    const nonce = window.__workerNonce;
    const id = mintId();
    const msg = {
      kind: 'worker.call',
      nonce,
      id,
      payload: { method, params, appId },
    };
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const data = event.data;
        if (!data || data.kind !== 'worker.result' || data.id !== id) return;
        window.removeEventListener('message', onMessage);
        if (data.ok) resolve(data.result);
        else reject(new Error(data.error?.message || 'worker call failed'));
      };
      window.addEventListener('message', onMessage);
      window.parent.postMessage(msg, '*');
    });
  }

  // Wait for host to mint nonce (posted once after worker spawn).
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.kind !== 'worker.ready') return;
    window.__workerNonce = data.nonce;
  });

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
