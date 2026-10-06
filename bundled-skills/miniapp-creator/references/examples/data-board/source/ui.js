/*
 * 数据密集型样例的行为层。三件事值得抄：
 *   1. get 和 set 都要 catch，且失败要让用户看见（见 status 行）——
 *      只包 set 是最常见的漏法，首屏那次 get 裸奔，失败时用户看到的是空表。
 *   2. 行入场用 CSS animation + --i 变量做 stagger，JS 只给索引，不写毫秒数。
 *   3. 退场先播 animationend 再摘节点，不直接 innerHTML 重写。
 */
(function () {
  'use strict';

  var STATE_LABEL = { ok: 'Passed', warn: 'Flaky', bad: 'Failed', run: 'Running', idle: 'Queued' };

  // fixture 就写在这里，方便后续换真数据源。不要编造看起来像真的指标。
  var MOCK = [
    { name: 'build / linux-x64', elapsed: 412, rate: 3.8, state: 'ok' },
    { name: 'test / unit', elapsed: 96, rate: 42.1, state: 'ok' },
    { name: 'lint / eslint', elapsed: 11, rate: 0, state: 'warn' },
    { name: 'test / e2e', elapsed: 1284, rate: 0.4, state: 'run' },
    { name: 'package / dmg', elapsed: 0, rate: 0, state: 'idle' }
  ];

  var rows = document.getElementById('db-rows');
  var empty = document.getElementById('db-empty');
  var sub = document.getElementById('db-sub');
  var foot = document.getElementById('db-foot');
  var KEY = 'density';

  function fmtSecs(ms) {
    if (!ms) return '—';
    return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms + 'ms';
  }

  function fmtRate(r) {
    return r ? r.toFixed(1) + '/s' : '—';
  }

  function paint(list) {
    // 先摘干净再重建：这张表没有退场动画要做，innerHTML 重写在这里是对的。
    // 有退场动效的行必须走 removeRow()，否则正在飞的行会瞬间消失。
    rows.textContent = '';
    empty.hidden = list.length > 0;

    list.forEach(function (job, i) {
      var tr = document.createElement('tr');
      tr.className = 'db-tr db-row-in';
      // 时长和曲线在 CSS 里，JS 只给顺序 —— 改节奏时不需要动这里。
      tr.style.setProperty('--i', i);

      var name = document.createElement('td');
      name.className = 'db-td';
      name.textContent = job.name;
      name.title = job.name;

      var elapsed = document.createElement('td');
      elapsed.className = 'db-td db-num';
      elapsed.textContent = fmtSecs(job.elapsed);

      var rate = document.createElement('td');
      rate.className = 'db-td db-num';
      rate.textContent = fmtRate(job.rate);

      var state = document.createElement('td');
      state.className = 'db-td db-state';
      state.dataset.state = job.state;
      var label = document.createElement('span');
      label.className = 'db-state__label';
      label.textContent = STATE_LABEL[job.state] || job.state;
      state.appendChild(label);
      if (job.state === 'ok' && job.elapsed > 1000) {
        var flag = document.createElement('span');
        flag.className = 'db-flag';
        flag.textContent = 'slow';
        state.appendChild(document.createTextNode(' '));
        state.appendChild(flag);
      }

      tr.append(name, elapsed, rate, state);
      rows.appendChild(tr);
    });

    var passed = list.filter(function (j) { return j.state === 'ok'; }).length;
    sub.textContent = list.length
      ? passed + ' of ' + list.length + ' passing'
      : 'nothing scheduled';
  }

  function readDensity() {
    // 同样要 catch：appdata 不可写时 app.storage.get 会 reject。
    return app.storage.get(KEY).catch(function () {
      return null;
    });
  }

  function writeDensity(value) {
    return app.storage.set(KEY, value).catch(function (err) {
      foot.textContent = 'Could not save density: ' + (err && err.message);
    });
  }

  function applyDensity(value) {
    document.documentElement.dataset.density = value;
    Array.prototype.forEach.call(
      document.querySelectorAll('.db-density__btn'),
      function (btn) {
        btn.setAttribute('aria-pressed', String(btn.dataset.density === value));
      }
    );
  }

  Array.prototype.forEach.call(
    document.querySelectorAll('.db-density__btn'),
    function (btn) {
      btn.addEventListener('click', function () {
        applyDensity(btn.dataset.density);
        writeDensity(btn.dataset.density);
      });
    }
  );

  // 跟随宿主外观：token 颜色自动变，但 color-scheme 决定原生控件和滚动条的
  // 默认外观，必须显式同步（playbook §四 末尾那条）。
  function syncScheme() {
    var mode = app.appearanceMode === 'light' || app.appearanceMode === 'dark'
      ? app.appearanceMode
      : null;
    if (mode) document.documentElement.style.colorScheme = mode;
  }

  app.onAppearanceChange(syncScheme);

  readDensity().then(function (saved) {
    applyDensity(saved || 'standard');
    syncScheme();
    paint(MOCK);
  }).catch(function (err) {
    // 首次 get 也失败时不能静默 —— 用户会以为"没有任务"，其实是读不出来。
    foot.textContent = 'Could not read settings: ' + (err && err.message);
    applyDensity('standard');
    syncScheme();
    paint(MOCK);
  });
})();
