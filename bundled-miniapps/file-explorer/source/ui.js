// File Explorer demo ui.js — talks to the MiniApp worker pool via postMessage.
// Wire protocol mirrors git-graph: parent mints a nonce after worker spawn,
// every call is a request/response pair keyed by `id`.
//
// i18n follows the house convention: `data-i18n="key"` on an element means
// "set my textContent from the dictionary"; adding `data-i18n-attr="aria-label"`
// means "set that attribute instead". The applier is per-MiniApp, not a host
// feature — the host bridge exposes no locale channel yet, so the locale comes
// from `navigator.language` and falls back to the HTML's baked-in English.

(function () {
  const I18N = {
    'en-US': {
      title: 'File Explorer',
      hint: 'Browse a local directory, open files, and substring-search — all through the MiniApp worker pool. Paths are re-checked against the declared read scope inside the worker, not just at the bridge.',
      rootSectionAria: 'Root directory',
      rootInputAria: 'Root directory path',
      load: 'Load',
      treeAria: 'Directory tree',
      tree: 'Tree',
      viewerAria: 'File viewer',
      file: 'File',
      viewerEmpty: 'Select a file from the tree.',
      searchAria: 'Search',
      searchInputAria: 'Search query',
      ignoreCase: 'Ignore case',
      search: 'Search',
      hitsAria: 'Search results',
      needRoot: 'Enter a directory path',
      needQuery: 'Enter something to search for',
      loadFirst: 'Load a directory first',
      loading: 'Loading…',
      searching: 'Searching…',
      emptyDir: '(empty)',
      noMatches: '(no matches)',
      truncated: ' (truncated)',
      reading: 'Reading {path}…',
      binaryFile: '(binary file, {size} bytes)',
      truncatedNotice: '\n\n… truncated at 256KB …',
      entries: '{n} entries',
      hits: '{n} hits',
      sizeWithName: '{path} — {size} bytes',
      dirTitle: 'directory',
    },
    'zh-CN': {
      title: '文件浏览器',
      hint: '浏览本地目录、打开文件并做子串搜索——全部经由 MiniApp worker 池完成。路径会在 worker 内部按已声明的读取范围二次校验，而不仅仅在桥接层。',
      rootSectionAria: '根目录',
      rootInputAria: '根目录路径',
      load: '加载',
      treeAria: '目录树',
      tree: '目录',
      viewerAria: '文件预览',
      file: '文件',
      viewerEmpty: '从目录树中选择一个文件。',
      searchAria: '搜索',
      searchInputAria: '搜索关键字',
      ignoreCase: '忽略大小写',
      search: '搜索',
      hitsAria: '搜索结果',
      needRoot: '请输入目录路径',
      needQuery: '请输入搜索内容',
      loadFirst: '请先加载一个目录',
      loading: '加载中…',
      searching: '搜索中…',
      emptyDir: '（空目录）',
      noMatches: '（无匹配）',
      truncated: '（已截断）',
      reading: '正在读取 {path}…',
      binaryFile: '（二进制文件，{size} 字节）',
      truncatedNotice: '\n\n… 已在 256KB 处截断 …',
      entries: '{n} 个条目',
      hits: '{n} 处匹配',
      sizeWithName: '{path} — {size} 字节',
      dirTitle: '目录',
    },
  };

  function detectLocale() {
    const tag = (navigator.language || 'en-US').toLowerCase();
    if (I18N[tag]) return tag;
    const base = tag.split('-')[0];
    const match = Object.keys(I18N).find((k) => k.split('-')[0] === base);
    return match || 'en-US';
  }

  const locale = detectLocale();

  function t(key, vars) {
    const table = I18N[locale] || I18N['en-US'];
    let s = table[key] != null ? table[key] : I18N['en-US'][key];
    if (s == null) return key;
    if (vars) {
      for (const name of Object.keys(vars)) {
        s = s.replace(new RegExp(`\\{${name}\\}`, 'g'), String(vars[name]));
      }
    }
    return s;
  }

  function applyStaticI18n() {
    document.documentElement.setAttribute('lang', locale);
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      const attr = node.getAttribute('data-i18n-attr');
      const value = t(node.getAttribute('data-i18n'));
      if (attr) node.setAttribute(attr, value);
      else node.textContent = value;
    });
  }

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

  applyStaticI18n();

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
      setStatus(t('needRoot'), true);
      return;
    }
    setStatus(t('loading'));
    loadBtn.disabled = true;
    try {
      const res = await workerCall('file.tree', { root, maxDepth: 4, maxEntries: 800 });
      treeRoot = res.root;
      renderTree(res);
      const suffix = res.truncated ? t('truncated') : '';
      setStatus(t('entries', { n: res.entries.length }) + suffix);
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
      li.textContent = t('emptyDir');
      treeEl.appendChild(li);
      return;
    }
    for (const entry of res.entries) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = entry.type === 'dir' ? `${entry.rel}/` : entry.rel;
      if (entry.type === 'dir') btn.className = 'dir';
      btn.title = entry.type === 'file' ? `${entry.size} bytes` : t('dirTitle');
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
    setStatus(t('reading', { path: rel }));
    try {
      const res = await workerCall('file.read', { path: joinPath(treeRoot, rel) });
      if (res.binary) {
        viewerEl.textContent = t('binaryFile', { size: res.size });
      } else {
        const suffix = res.truncated ? t('truncatedNotice') : '';
        viewerEl.textContent = res.content + suffix;
      }
      setStatus(t('sizeWithName', { path: rel, size: res.size }));
    } catch (e) {
      setStatus(e.message || String(e), true);
    }
  }

  async function runSearch() {
    const query = (searchInput.value || '').trim();
    if (!query) {
      setStatus(t('needQuery'), true);
      return;
    }
    if (!treeRoot) {
      setStatus(t('loadFirst'), true);
      return;
    }
    setStatus(t('searching'));
    searchBtn.disabled = true;
    try {
      const res = await workerCall('file.search', {
        root: treeRoot,
        query,
        maxHits: 100,
        caseInsensitive: caseInsensitiveEl.checked,
      });
      renderHits(res);
      const suffix = res.truncated ? t('truncated') : '';
      setStatus(t('hits', { n: res.hits.length }) + suffix);
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
      li.textContent = t('noMatches');
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
