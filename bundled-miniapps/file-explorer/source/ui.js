// File Explorer demo ui.js — talks to the MiniApp worker pool via postMessage.
// Wire protocol mirrors git-graph: parent mints a nonce after worker spawn,
// every call is a request/response pair keyed by `id`.

(function () {
  const appIdMeta = document.querySelector('meta[name="x-miniapp-id"]');
  const appId = appIdMeta ? appIdMeta.getAttribute('content') : 'file-explorer';

  const rootInput = document.getElementById('root-input');
  const loadBtn = document.getElementById('load-btn');
  const treeEl = document.getElementById('tree');
  const viewerEl = document.getElementById('viewer');
  const searchInput = document.getElementById('search-input');
  const caseInsensitiveEl = document.getElementById('case-insensitive');
  const searchBtn = document.getElementById('search-btn');
  const hitsEl = document.getElementById('search-hits');
  const statusEl = document.getElementById('status');

  let nextId = 1;

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', !!isError);
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

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.kind !== 'worker.ready') return;
    window.__workerNonce = data.nonce;
  });

  // The worker returns `rel` paths relative to the root it resolved, so the UI
  // never has to reconstruct them from the (possibly symlinked) input string.
  let treeRoot = '';

  async function loadTree() {
    const root = (rootInput.value || '').trim();
    if (!root) {
      setStatus('Enter a directory path', true);
      return;
    }
    setStatus('Loading…');
    loadBtn.disabled = true;
    try {
      const res = await workerCall('file.tree', { root, maxDepth: 4, maxEntries: 800 });
      treeRoot = res.root;
      renderTree(res);
      const suffix = res.truncated ? ' (truncated)' : '';
      setStatus(`${res.entries.length} entries${suffix}`);
    } catch (e) {
      setStatus(e.message || String(e), true);
    } finally {
      loadBtn.disabled = false;
    }
  }

  function renderTree(res) {
    treeEl.innerHTML = '';
    if (!res.entries.length) {
      const li = document.createElement('li');
      li.textContent = '(empty)';
      treeEl.appendChild(li);
      return;
    }
    for (const entry of res.entries) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = entry.type === 'dir' ? `${entry.rel}/` : entry.rel;
      if (entry.type === 'dir') btn.className = 'dir';
      btn.title = entry.type === 'file' ? `${entry.size} bytes` : 'directory';
      btn.addEventListener('click', () => {
        if (entry.type === 'file') openFile(entry.rel);
        else rootInput.value = joinPath(treeRoot, entry.rel);
      });
      li.appendChild(btn);
      treeEl.appendChild(li);
    }
  }

  function joinPath(base, rel) {
    if (!base) return rel;
    return base.endsWith('/') ? base + rel : `${base}/${rel}`;
  }

  async function openFile(rel) {
    setStatus(`Reading ${rel}…`);
    try {
      const res = await workerCall('file.read', { path: joinPath(treeRoot, rel) });
      if (res.binary) {
        viewerEl.textContent = `(binary file, ${res.size} bytes)`;
      } else {
        const suffix = res.truncated ? '\n\n… truncated at 256KB …' : '';
        viewerEl.textContent = res.content + suffix;
      }
      setStatus(`${rel} — ${res.size} bytes`);
    } catch (e) {
      setStatus(e.message || String(e), true);
    }
  }

  async function runSearch() {
    const query = (searchInput.value || '').trim();
    if (!query) {
      setStatus('Enter something to search for', true);
      return;
    }
    if (!treeRoot) {
      setStatus('Load a directory first', true);
      return;
    }
    setStatus('Searching…');
    searchBtn.disabled = true;
    try {
      const res = await workerCall('file.search', {
        root: treeRoot,
        query,
        maxHits: 100,
        caseInsensitive: caseInsensitiveEl.checked,
      });
      renderHits(res);
      const suffix = res.truncated ? ' (truncated)' : '';
      setStatus(`${res.hits.length} hits${suffix}`);
    } catch (e) {
      setStatus(e.message || String(e), true);
    } finally {
      searchBtn.disabled = false;
    }
  }

  function renderHits(res) {
    hitsEl.innerHTML = '';
    if (!res.hits.length) {
      const li = document.createElement('li');
      li.textContent = '(no matches)';
      hitsEl.appendChild(li);
      return;
    }
    for (const hit of res.hits) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${hit.rel}:${hit.line}  ${hit.snippet.trim()}`;
      btn.addEventListener('click', () => openFile(hit.rel));
      li.appendChild(btn);
      hitsEl.appendChild(li);
    }
  }

  loadBtn.addEventListener('click', loadTree);
  searchBtn.addEventListener('click', runSearch);
  rootInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadTree();
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch();
  });
})();
