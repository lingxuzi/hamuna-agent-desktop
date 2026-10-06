/*
 * 展示型样例的行为层。重点只有一件事：展示型最容易写成"半成品动效"——
 * 只做入场不做退场。所以这里把 退场 → 换数据 → 入场 排成一条完整链路，
 * 并且降级模式下没有 animationend，用定时兜底。
 */
(function () {
  'use strict';

  var CARDS = [
    { tag: 'Field note 01', title: '晨雾未散', note: '天亮之前的那一小时，颜色是灰的，声音是软的。' },
    { tag: 'Field note 02', title: '午后回声', note: '光从西侧斜进来，把每一样东西都拉长了一寸。' },
    { tag: 'Field note 03', title: '夜航', note: '把灯关掉之后，路反而清楚了。' }
  ];

  var card = document.getElementById('sc-card');
  var tag = document.getElementById('sc-tag');
  var title = document.getElementById('sc-title');
  var note = document.getElementById('sc-note');
  var marks = document.getElementById('sc-marks');
  var next = document.getElementById('sc-next');
  var keep = document.getElementById('sc-save');
  var status = document.getElementById('sc-status');

  var i = 0;
  var kept = [];
  var EXIT_MS = 220; /* 退场时长在 CSS 里，这里只是降级模式下的兜底上限 */

  // 固定数量的刻度：一个 motif 用到底，不要每次换一套图形。
  for (var m = 0; m < 4; m++) {
    var bar = document.createElement('span');
    bar.className = 'sc-mark';
    marks.appendChild(bar);
  }

  function paint() {
    var data = CARDS[i];
    tag.textContent = data.tag;
    title.textContent = data.title;
    note.textContent = data.note;
    Array.prototype.forEach.call(marks.children, function (el, idx) {
      el.dataset.on = String(idx === i);
    });
  }

  function swap() {
    // 完整生命周期：退场 → 换数据 → 入场。直接改 textContent 会让动画停在半路，
    // 视觉上就是"闪一下就没了"——这是最常见的半成品动效。
    card.dataset.swap = 'out';
    var swapped = false;
    function apply() {
      if (swapped) return; // 降级模式下 animationend 和定时器都会来，去重
      swapped = true;
      i = (i + 1) % CARDS.length;
      paint();
      card.dataset.swap = 'in';
    }
    card.addEventListener('animationend', apply, { once: true });
    // prefers-reduced-motion 下动画被压到 1ms，animationend 仍会触发；但如果
    // 环境干脆禁了动画，就没有事件了 —— 定时兜底保证一定会换。
    setTimeout(apply, EXIT_MS + 60);
  }

  function syncAppearance() {
    // 展示型自定义了色相，所以不能像工具型那样"颜色自动跟随"了事：
    // 浅色下那套深玫瑰金会糊掉，必须显式挂一个属性让 CSS 覆写。
    var mode = app.appearanceMode;
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.dataset.appearance = mode;
    }
    if (mode) document.documentElement.style.colorScheme = mode;
  }

  next.addEventListener('click', swap);

  keep.addEventListener('click', function () {
    kept.push(CARDS[i].title);
    // 持久化失败要让用户看见，不能静默 —— 静默的话用户以为存上了。
    app.storage.set('kept', kept).catch(function (err) {
      status.textContent = 'Could not save: ' + (err && err.message);
    });
    keep.disabled = true;
    status.textContent = 'Kept “' + CARDS[i].title + '”';
  });

  app.onAppearanceChange(syncAppearance);

  app.storage.get('kept').then(function (saved) {
    if (saved && saved.length) status.textContent = saved.length + ' kept earlier';
  }).catch(function () {
    // 读失败不阻塞首屏，但要留一句说明，别让用户以为是空列表。
    status.textContent = 'Could not read saved notes.';
  });

  syncAppearance();
  paint();
})();
