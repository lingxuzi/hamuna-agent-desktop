/*
 * Signal Chart — 行为层。
 *
 * 这个文件想教的是三件在图表里最容易写错的事：
 *
 *   1. **几何与颜色分离。** JS 只写几何（d / cx / cy / y / transform），
 *      颜色一条也不写 —— 全部交给 style.css 的类。于是换主题自动跟随，
 *      图表代码根本不需要知道主题的存在。
 *   2. **比例尺是一个真的函数。** 线性比例尺带 invert，刻度由 1/2/5 阶梯
 *      生成，路径由一个函数拼出来。全文件没有一个"魔法坐标"。
 *   3. **热路径上不读布局。** pointermove 里只写 transform 和 textContent，
 *      不调用 getBoundingClientRect —— 读一次就是一次强制重排，也就是
 *      layout thrash 的定义。tooltip 宽度固定、位置只用 transform，
 *      就是为了让"要不要翻转"这个判断是纯算术。
 */
(function () {
  'use strict';

  /* --- 文案 -----------------------------------------------------------------
   * meta.json::i18n 是宿主侧用来本地化应用名/描述的，ui.js 读不到它，
   * 所以应用内的文案表要自己维护一份。app.t(table, fallback) 是运行时
   * 本地化的正确入口。
   * -------------------------------------------------------------------- */
  var I18N = {
    'app.title': { 'zh-CN': '信号监控', 'en-US': 'Signal Monitor' },
    'app.subtitle': { 'zh-CN': '入站 / 出站请求量', 'en-US': 'Inbound / outbound requests' },
    'series.in': { 'zh-CN': '入站请求', 'en-US': 'Inbound' },
    'series.out': { 'zh-CN': '出站请求', 'en-US': 'Outbound' },
    'chart.range': { 'zh-CN': '时间范围', 'en-US': 'Time range' },
    'chart.plot': {
      'zh-CN': '信号折线图，用左右方向键移动游标',
      'en-US': 'Signal line chart; use the left and right arrow keys to move the cursor',
    },
    'chart.legend': { 'zh-CN': '系列', 'en-US': 'Series' },
    'chart.unit': { 'zh-CN': '次', 'en-US': 'req' },
    'chart.hint': { 'zh-CN': '← → 移动游标', 'en-US': '← → move cursor' },
    'chart.samples': { 'zh-CN': '{n} 个采样点', 'en-US': '{n} samples' },
    'chart.empty.title': { 'zh-CN': '该窗口暂无数据', 'en-US': 'No data for this window' },
    'chart.empty.hint': {
      'zh-CN': '后端还没有聚合这个窗口，换一个范围或稍后再看。',
      'en-US': 'This window has not been aggregated yet. Pick another range or check back later.',
    },
    'state.loading': { 'zh-CN': '加载中…', 'en-US': 'Loading…' },
    'error.storage': {
      'zh-CN': '本地存储不可用，窗口选择不会被记住',
      'en-US': 'Storage unavailable; the window choice will not be remembered',
    }
  };

  function t(key, vars) {
    var table = I18N[key] || {};
    // 兜底取 zh-CN：即使宿主给了一个没覆盖的 locale，也不要显示空字符串。
    var out = app.t(table, table['zh-CN'] || key);
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        out = out.split('{' + k + '}').join(vars[k]);
      });
    }
    return out;
  }

  /* --- 数据源（fixture）----------------------------------------------------
   * 真接数据源时只换这一段。固定 ANCHOR 而不是 Date.now()：同一份代码
   * 每次跑出同一张图，截图能 diff，坐标轴标签也不会在每次刷新时整排跳动。
   * -------------------------------------------------------------------- */
  var ANCHOR = Date.UTC(2026, 2, 14, 18, 0, 0); // 2026-03-14 18:00 UTC

  var RANGES = {
    '24h': { points: 96, step: 15 * 60e3, seed: 20260314 },
    '7d': { points: 84, step: 2 * 3600e3, seed: 20260103 },
    // 30d 故意是空的。没有一个范围会返回空集，空状态就成了一张永远不会被
    // 打开的图 —— 而空状态恰恰是仪表盘最常被截图的那个状态。
    '30d': { points: 0, step: 12 * 3600e3, seed: 0 }
  };

  // 两支系列，各一颗种子。只用 accent / accent-secondary 两个契约槽位，
  // 不自己造第三支色 —— 见 style.css 顶部 Design System 的 Palette 段。
  var SERIES = [
    { key: 'a', name: 'series.in', base: 620, drift: 2.2 },
    { key: 'b', name: 'series.out', base: 310, drift: -0.8 }
  ];

  /** mulberry32：32 位整数的确定性伪随机数。图表 fixture 必须可复现，
   *  否则每次截图的曲线都不一样，没法拿"上一版"和"这一版"做对比。 */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildSeries(range, spec, offset) {
    var rnd = mulberry32(range.seed + offset);
    var out = [];
    var v = spec.base;
    for (var i = 0; i < range.points; i++) {
      // 均值回归 + 缓慢漂移：纯随机游走会一路漂到 0 或几千，30 天后再看就是一条
      // 没有信息量的斜线；均值回归保证任何窗口长度下两条信号都活在合理区间里。
      // 负值不会累积 —— 向基线拉的那一项已经保证了这点，最后 clamp 只是兜底。
      v += (spec.base + spec.drift * i - v) * 0.12 + (rnd() - 0.5) * spec.base * 0.4;
      out.push({
        t: ANCHOR - (range.points - 1 - i) * range.step,
        v: Math.max(0, Math.round(v))
      });
    }
    return out;
  }

  /* --- 几何：纯函数，不碰 DOM ----------------------------------------------
   * 这三个函数是整个图表的数学核心，可单独抄走用到任何 SVG/Canvas 图表里。
   * -------------------------------------------------------------------- */

  /** 线性比例尺：定义域 [d0,d1] → 值域 [r0,r1]。带 invert 让 tooltip 和准星
   *  能从像素反查数据点，而不是在 JS 里另写一遍反算。 */
  function scaleLinear(d0, d1, r0, r1) {
    var dd = d1 - d0 || 1;
    var dr = r1 - r0 || 1;
    var fn = function (v) {
      return r0 + ((v - d0) / dd) * dr;
    };
    fn.invert = function (px) {
      return d0 + ((px - r0) / dr) * dd;
    };
    return fn;
  }

  /** 1/2/5 × 10^n 的整齐刻度。刻度必须是整齐数：0 / 200 / 400 好读，
   *  0 / 173 / 346 只会让人心算。返回的是定义域里的值，不是像素。 */
  function ticks(lo, hi, count) {
    var raw = (hi - lo) / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
    var first = Math.ceil(lo / step);
    var last = Math.floor(hi / step);
    var out = [];
    // 用下标乘而不是累加：浮点累加 5 次 200 会得到 1000.0000000000002。
    for (var i = first; i <= last; i++) out.push(i * step);
    return out;
  }

  /** Y 轴上界向上取整到 1/2/5 阶梯。Y 轴从 0 起是计数信号的底线：
   *  截断的 Y 轴能把 2% 的波动画成翻倍，而仪表盘最容易骗到自己人。 */
  function niceCeil(v) {
    if (!(v > 0)) return 1;
    var mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var norm = v / mag;
    return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  }

  /** 折线：直连，不用样条。
   * Catmull-Rom / 单调三次会在极值处过冲，画出一条数据里根本没有的读数 ——
   * 对仪表盘来说那是撒谎，不是好看。信号图就用折线。 */
  function linePath(points, x, y) {
    var d = '';
    for (var i = 0; i < points.length; i++) {
      d += (i ? 'L' : 'M') + round2(x(points[i].t)) + ' ' + round2(y(points[i].v));
    }
    return d;
  }

  /** 面积：折线 + 回到基线的闭合路径。 */
  function areaPath(points, x, y, base) {
    return linePath(points, x, y) + 'L' + round2(x(points[points.length - 1].t)) + ' ' + round2(base) +
      'L' + round2(x(points[0].t)) + ' ' + round2(base) + 'Z';
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  /** 时间刻度步长：从 15 分钟一路爬到 7 天，取第一个让刻度间距 ≥ minGapPx 的。
   *  固定用"每小时一根"是新手最常犯的错：24h 图上 24 个标签互相压死，
   *  7d 图上每天一根又稀得像个空表。 */
  var TIME_LADDER = [
    15 * 60e3, 30 * 60e3, 60 * 60e3, 2 * 3600e3, 3 * 3600e3, 6 * 3600e3,
    12 * 3600e3, 86400e3, 2 * 86400e3, 7 * 86400e3
  ];

  function pickTimeStep(spanMs, px, minGapPx) {
    for (var i = 0; i < TIME_LADDER.length; i++) {
      if ((TIME_LADDER[i] / spanMs) * px >= minGapPx) return TIME_LADDER[i];
    }
    return TIME_LADDER[TIME_LADDER.length - 1];
  }

  /** 对齐到整点 / 整日边界的时间刻度。标签按步长落在"人能读"的位置上，
   *  而不是均匀地切一刀切在 17:43 这种没人会用的时刻。 */
  function timeTicks(t0, t1, stepMs) {
    var out = [];
    var anchor = new Date(t0);
    if (stepMs >= 86400e3) anchor.setHours(0, 0, 0, 0);
    else anchor.setMinutes(0, 0, 0);
    var cursor = anchor.getTime();
    while (cursor > t0) cursor -= stepMs;
    for (; cursor <= t1; cursor += stepMs) out.push(cursor);
    // 兜底上限。窄容器里再密的步长也会挤成一团，八根刻度是"能读完"的上限。
    if (out.length > 8) {
      var stride = Math.ceil(out.length / 8);
      out = out.filter(function (_, i) {
        return i % stride === 0;
      });
    }
    return out;
  }

  /* --- DOM ---------------------------------------------------------------- */
  var NS = 'http://www.w3.org/2000/svg';
  var GEOM = { padL: 46, padR: 14, padT: 12, padB: 24, minH: 200, maxH: 320 };
  var TIP_GAP = 12;
  var STORAGE_KEY = 'signal-chart:range';

  var el = {
    stage: document.getElementById('sc-stage'),
    plot: document.getElementById('sc-plot'),
    svg: document.getElementById('sc-svg'),
    skeleton: document.getElementById('sc-skeleton'),
    empty: document.getElementById('sc-empty'),
    tip: document.getElementById('sc-tip'),
    tipTime: document.getElementById('sc-tip-time'),
    tipValue: { a: document.getElementById('sc-tip-a'), b: document.getElementById('sc-tip-b') },
    lastValue: { a: document.getElementById('sc-last-a'), b: document.getElementById('sc-last-b') },
    delta: { a: document.getElementById('sc-delta-a'), b: document.getElementById('sc-delta-b') },
    window: document.getElementById('sc-window'),
    count: document.getElementById('sc-count'),
    foot: document.getElementById('sc-foot')
  };

  var state = { rangeId: '24h', rows: null };
  var geom = null;      // 最近一次绘制的几何，悬停/键盘全靠它
  var cursorIdx = -1;
  var cursorGroup = null;
  var cursorDots = { a: null, b: null };
  var svgRect = null;   // 缓存的矩形：热路径上一次都不读
  var tipWidth = 176;  // 同上，从 CSS 读一次
  var lastWidth = 0;

  // 数字与日期的格式化器跟着语言走：locale 变了要重建，而不是只在启动时建一次。
  var fmtNum, fmtPct, fmtTime, fmtDay, fmtStamp;

  function buildFormatters() {
    var loc = app.locale || 'zh-CN';
    fmtNum = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
    fmtPct = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 });
    fmtTime = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hour12: false });
    fmtDay = new Intl.DateTimeFormat(loc, { month: '2-digit', day: '2-digit' });
    // 窗口标签要同时带日期和时刻："03/14 – 02:00" 读起来像一天里的时间段，
    // 而实际跨度是 24 小时。dateStyle/timeStyle 是平台原生的，不自己拼格式串。
    fmtStamp = new Intl.DateTimeFormat(loc, { dateStyle: 'short', timeStyle: 'short' });
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS(NS, tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function svgAdd(parent, tag, attrs) {
    var node = svgEl(tag, attrs);
    parent.appendChild(node);
    return node;
  }

  /* --- 尺寸 ----------------------------------------------------------------
   * 高度写进 --sc-h，绘图区 / 骨架 / 空状态三态共用这个格子，于是状态切换
   * 不跳版。骨架在第一帧就占住位置，图表画完直接顶上来。
   * -------------------------------------------------------------------- */
  function measure() {
    var w = el.plot.clientWidth || el.stage.clientWidth || 640;
    var h = Math.max(GEOM.minH, Math.min(GEOM.maxH, Math.round(w * 0.34)));
    el.stage.style.setProperty('--sc-h', h + 'px');
    return { w: w, h: h };
  }

  /* --- 绘制 ---------------------------------------------------------------- */
  function draw(animate) {
    var box = measure();
    var rows = state.rows;

    el.skeleton.hidden = true;

    if (!rows) {
      // 空状态不是"没有图"，而是一整块被设计过的区域，且它和图占同一个格子。
      el.plot.dataset.state = 'empty';
      el.tip.dataset.show = 'false';
      geom = null;
      cursorIdx = -1;
      return;
    }

    el.plot.dataset.state = 'chart';

    var padL = GEOM.padL;
    var padT = GEOM.padT;
    var pw = Math.max(10, box.w - padL - GEOM.padR);
    var ph = Math.max(10, box.h - padT - GEOM.padB);
    var base = padT + ph;

    var n = rows.a.length;
    var t0 = rows.a[0].t;
    var t1 = rows.a[n - 1].t;

    // 峰值同时看两条系列，否则次系列会被主系列的量级压成贴底的直线。
    var peak = 0;
    rows.a.concat(rows.b).forEach(function (d) {
      if (d.v > peak) peak = d.v;
    });
    var yMax = niceCeil(peak);

    // x 按**时间**而不是按下标：窗口长度变了、采样密度变了，同一个时间点仍然
    // 落在同一个像素上，切换范围时曲线不会"跳一下再长开"。
    var x = scaleLinear(t0, t1, padL, padL + pw);
    var xIndex = scaleLinear(0, n - 1, padL, padL + pw);
    var y = scaleLinear(0, yMax, base, padT);

    var svg = el.svg;
    // viewBox 与像素 1:1：SVG 不被缩放，于是 HTML tooltip 和 SVG 共用同一套
    // 坐标系，不需要任何"从 viewBox 换算回 CSS 像素"的系数 —— 那类系数写错
    // 时不会报错，只会让 tooltip 差那么几个像素地对不上线。
    svg.setAttribute('viewBox', '0 0 ' + box.w + ' ' + box.h);
    svg.setAttribute('width', box.w);
    svg.setAttribute('height', box.h);
    svg.textContent = '';
    // 入场动画只在数据换了时播：resize 和换语言都会重绘，让它们重播一遍
    // 等于"每次拖窗口曲线都闪一次"。
    svg.dataset.anim = animate ? 'true' : 'false';

    /* Y 轴：网格线 + 刻度 */
    var grid = svgAdd(svg, 'g', { class: 'sc-grid' });
    ticks(0, yMax, 5).forEach(function (v) {
      var py = round2(y(v));
      svgAdd(grid, 'line', {
        class: v === 0 ? 'sc-grid-line sc-grid-line--zero' : 'sc-grid-line',
        x1: padL, x2: padL + pw, y1: py, y2: py
      });
      var label = svgAdd(grid, 'text', {
        class: 'sc-tick', x: padL - 8, y: py,
        'text-anchor': 'end', 'dominant-baseline': 'middle'
      });
      label.textContent = fmtNum.format(v);
    });

    /* X 轴：时间刻度 + 基线 */
    var stepMs = pickTimeStep(t1 - t0, pw, 64);
    var isTimeLabel = stepMs < 86400e3;
    // 判据是"首尾落在不同日期"，不是"跨度 ≥ 24h"：24h 档实际只有 23.75 小时，
    // 用时长判会漏掉，于是首尾两个 "02:00" 分不出是哪一天。
    var crossesDay = fmtDay.format(t0) !== fmtDay.format(t1);
    var axis = svgAdd(svg, 'g', { class: 'sc-axis' });
    svgAdd(axis, 'line', { class: 'sc-axis-line', x1: padL, x2: padL + pw, y1: base, y2: base });
    timeTicks(t0, t1, stepMs).forEach(function (ts, i) {
      var px = x(ts);
      // 首尾两个标签改锚点：SVG 会把画到 viewBox 外的文字裁掉（不裁也不会让
      // 页面横向溢出，所以不裁反而更糟 —— 端点标签被切掉一半）。
      var anchor = 'middle';
      var lx = px;
      if (px < padL + 14) { anchor = 'start'; lx = padL; }
      else if (px > padL + pw - 14) { anchor = 'end'; lx = padL + pw; }
      var label = svgAdd(axis, 'text', {
        class: 'sc-tick', x: round2(lx), y: base + GEOM.padB - 8, 'text-anchor': anchor
      });
      // 跨日且标签本身是时刻时，只有第一个刻度带日期。其余刻度都写日期的话，
      // 64px 的间距里塞不下；都不写的话首尾两个时刻会撞脸。
      var text = isTimeLabel ? fmtTime.format(ts) : fmtDay.format(ts);
      if (isTimeLabel && crossesDay && i === 0) text = fmtDay.format(ts) + ' ' + text;
      label.textContent = text;
    });

    /* 面积 + 曲线。pathLength="1" 把路径长度归一化成 1，CSS 才能用 0..1 表达
     * "画到哪儿了"，不必在 JS 里调 getTotalLength()（那是一次真实的布局读取）。 */
    var defs = svgAdd(svg, 'defs', {});
    var grad = svgAdd(defs, 'linearGradient', { id: 'sc-area-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
    svgAdd(grad, 'stop', { class: 'sc-area-stop--top', offset: '0' });
    svgAdd(grad, 'stop', { class: 'sc-area-stop--bottom', offset: '1' });

    svgAdd(svg, 'path', {
      class: 'sc-area', fill: 'url(#sc-area-grad)',
      d: areaPath(rows.a, x, y, base)
    });

    var lines = svgAdd(svg, 'g', { class: 'sc-lines' });
    SERIES.forEach(function (spec, i) {
      var line = svgAdd(lines, 'path', {
        class: 'sc-line sc-line--' + spec.key,
        d: linePath(rows[spec.key], x, y),
        pathLength: '1'
      });
      // 节奏写在 CSS（calc(var(--sc-i) * 90ms)），JS 只给顺序 —— 改节奏不必动这里。
      line.style.setProperty('--sc-i', String(i));
    });

    /* 悬停层 */
    cursorGroup = svgAdd(svg, 'g', { class: 'sc-cursor', 'data-on': 'false' });
    svgAdd(cursorGroup, 'line', { class: 'sc-cursor__rule', x1: 0, x2: 0, y1: padT, y2: base });
    cursorDots.a = svgAdd(cursorGroup, 'circle', { class: 'sc-cursor__dot sc-cursor__dot--a', r: 4, cx: 0, cy: 0 });
    cursorDots.b = svgAdd(cursorGroup, 'circle', { class: 'sc-cursor__dot sc-cursor__dot--b', r: 4, cx: 0, cy: 0 });

    // 命中层铺满绘图区且排在最后：pointermove 只落在这一个矩形上，
    // 不必逐段判断"点没点中曲线"。
    svgAdd(svg, 'rect', { class: 'sc-hit', x: padL, y: padT, width: pw, height: ph });

    geom = {
      w: box.w, padL: padL, pw: pw, xIndex: xIndex, y: y, n: n, rows: rows
    };
    // 重绘时刷新缓存的矩形。滚动会改变位置而不触发重绘，所以真正的正确做法
    // 是每次 pointerenter 重取一次（见下方监听）—— 这一行只是让"重绘后指针
    // 已经在图上"的连续操作不至于用着一个明显过期的值。
    svgRect = el.svg.getBoundingClientRect();
    cursorIdx = -1;
    el.tip.dataset.show = 'false';
  }

  /* --- 图例 / 读数 --------------------------------------------------------- */
  function paintReadouts(rows) {
    SERIES.forEach(function (spec) {
      var list = rows[spec.key];
      var last = list[list.length - 1];
      var prev = list[list.length - 2];
      el.lastValue[spec.key].textContent = fmtNum.format(last.v);

      // 环比：文字保持中性色，语义色只进 chip 背景。
      // 深色外观下 --hamuna-error 对 elevated 底只有 4.3:1，12px 文字不达 AA；
      // 方向由 ▲▼ 和正负号承担，所以关掉颜色信息也不成立。
      var pct = prev && prev.v ? ((last.v - prev.v) / prev.v) * 100 : 0;
      var chip = el.delta[spec.key];
      if (pct > 0.5) {
        chip.dataset.dir = 'up';
        chip.textContent = '▲ ' + fmtPct.format(pct);
      } else if (pct < -0.5) {
        chip.dataset.dir = 'down';
        chip.textContent = '▼ ' + fmtPct.format(pct);
      } else {
        chip.dataset.dir = 'flat';
        chip.textContent = '– ' + fmtPct.format(0);
      }
    });

    var n = rows.a.length;
    var lastT = rows.a[n - 1].t;
    el.count.textContent = t('chart.samples', { n: fmtNum.format(n) });
    el.window.textContent = fmtStamp.format(rows.a[0].t) + ' → ' + fmtStamp.format(lastT);

    // 图表不只是颜色和曲线：给它一句能读出来的摘要，role="img" 的 aria-label
    // 才有内容，读屏器才读得出一张图讲了什么。
    var a = rows.a[n - 1].v;
    var b = rows.b[n - 1].v;
    el.svg.setAttribute('aria-label',
      t('series.in') + ' ' + fmtNum.format(a) + ', ' + t('series.out') + ' ' + fmtNum.format(b) +
      ', ' + fmtStamp.format(rows.a[0].t) + ' → ' + fmtStamp.format(lastT));
  }

  /* --- 悬停 ----------------------------------------------------------------
   * 整个 pointermove 只做属性写入。没有一次 getBoundingClientRect、没有一次
   * offsetWidth —— 任何一次读取都会强制同步重排，而这正是 layout thrash。
   * tooltip 的宽度固定在 CSS 里，所以"要不要往左翻"是纯算术。
   * -------------------------------------------------------------------- */
  function paintCursor(idx) {
    if (!geom) return;
    cursorIdx = idx;
    var px = geom.xIndex(idx);
    cursorGroup.setAttribute('transform', 'translate(' + round2(px) + ',0)');
    cursorGroup.setAttribute('data-on', 'true');
    cursorDots.a.setAttribute('cy', round2(geom.y(geom.rows.a[idx].v)));
    cursorDots.b.setAttribute('cy', round2(geom.y(geom.rows.b[idx].v)));

    el.tipTime.textContent = fmtTime.format(geom.rows.a[idx].t);
    el.tipValue.a.textContent = fmtNum.format(geom.rows.a[idx].v);
    el.tipValue.b.textContent = fmtNum.format(geom.rows.b[idx].v);

    var flip = px + tipWidth + TIP_GAP > geom.w;
    var tx = flip ? px - tipWidth - TIP_GAP : px + TIP_GAP;
    // 只写 transform：left/top 是布局属性，写它们会让下一帧再排一次版。
    el.tip.style.transform = 'translate3d(' + Math.max(4, Math.round(tx)) + 'px,' + GEOM.padT + 'px,0)';
    el.tip.dataset.show = 'true';
  }

  function hideCursor() {
    cursorIdx = -1;
    if (cursorGroup) cursorGroup.setAttribute('data-on', 'false');
    el.tip.dataset.show = 'false';
  }

  el.svg.addEventListener('pointerenter', function () {
    // 缓存矩形：热路径上一次都不读。
    svgRect = el.svg.getBoundingClientRect();
  });

  el.svg.addEventListener('pointermove', function (event) {
    if (!geom || !svgRect) return;
    var px = event.clientX - svgRect.left;
    var clamped = Math.max(geom.padL, Math.min(geom.padL + geom.pw, px));
    paintCursor(Math.max(0, Math.min(geom.n - 1, Math.round(geom.xIndex.invert(clamped)))));
  });

  el.svg.addEventListener('pointerleave', hideCursor);

  // 键盘可达。图表只能靠鼠标读数，对键盘用户等于不存在 —— 这是无障碍缺陷，
  // 不是"锦上添花"。焦点环用 :focus-visible，去掉 outline 的地方自己画回来。
  el.plot.addEventListener('keydown', function (event) {
    if (!geom) return;
    var jump = event.shiftKey ? 10 : 1;
    var next;
    if (event.key === 'ArrowRight') next = (cursorIdx < 0 ? 0 : cursorIdx + 1) + jump - 1;
    else if (event.key === 'ArrowLeft') next = (cursorIdx < 0 ? geom.n - 1 : cursorIdx - 1) - jump + 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = geom.n - 1;
    else if (event.key === 'Escape') { hideCursor(); return; }
    else return;
    event.preventDefault();
    paintCursor(Math.max(0, Math.min(geom.n - 1, next)));
  });

  el.plot.addEventListener('blur', hideCursor);

  /* --- 取数 ----------------------------------------------------------------
   * 真接数据源时把那个 setTimeout 换成你的 fetch / 宿主能力调用，
   * 并且**保留失败分支**：权限被拒或网络不通时，界面必须说出来。
   * 静默失败是 MiniApp "看起来坏了"的头号原因。
   * -------------------------------------------------------------------- */
  function fetchRange(rangeId) {
    var range = RANGES[rangeId];
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (!range.points) {
          resolve(null); // 空集 = 空状态，不是一段长度为 0 的曲线
          return;
        }
        var rows = {};
        SERIES.forEach(function (spec, i) {
          rows[spec.key] = buildSeries(range, spec, i * 7919);
        });
        resolve(rows);
      }, 220);
    });
  }

  function load(rangeId, firstRun) {
    var started = Date.now();
    if (firstRun) {
      el.skeleton.hidden = false;
      el.plot.dataset.state = 'loading';
      // 骨架至少显示 600ms：闪一下的骨架比不显示更糟，看起来像故障。
      // 之后切范围不再走骨架 —— 本地切换范围是瞬时操作，卡一下反而是倒退。
      return fetchRange(rangeId).then(function (rows) {
        var left = 600 - (Date.now() - started);
        return left > 0
          ? new Promise(function (r) { setTimeout(r, left); }).then(function () { return rows; })
          : rows;
      });
    }
    return fetchRange(rangeId);
  }

  function applyRange(rangeId) {
    state.rangeId = rangeId;
    hideCursor();
    load(rangeId, false).then(function (rows) {
      state.rows = rows;
      el.empty.hidden = !!rows;
      draw(false); // 切范围不放入场动画：曲线重画一遍的闪烁比"没有动"更吵
      if (rows) paintReadouts(rows);
      persist(rangeId);
    });
  }

  /* 读取持久化的窗口选择。只在首帧画完之后才调用（见启动段）。
   storage 是信任边界：慢、失败、或者永远不回来都可能，所以失败只写进脚注，
   界面照常按默认窗口走。 */
  function readRange() {
    return app.storage.get(STORAGE_KEY).then(function (v) {
      return v;
    }, function (err) {
      el.foot.textContent = t('error.storage');
      console.warn('[signal-chart] storage read failed:', err && err.message);
      return null;
    });
  }

  function persist(rangeId) {
    return app.storage.set(STORAGE_KEY, rangeId).catch(function (err) {
      el.foot.textContent = t('error.storage');
      console.warn('[signal-chart] storage write failed:', err && err.message);
    });
  }

  /* --- 范围切换 ------------------------------------------------------------ */
  Array.prototype.forEach.call(document.querySelectorAll('.sc-range__btn'), function (btn) {
    btn.addEventListener('click', function () {
      if (btn.getAttribute('aria-pressed') === 'true') return;
      applyPressed(btn.dataset.range);
      applyRange(btn.dataset.range);
    });
  });

  function applyPressed(rangeId) {
    Array.prototype.forEach.call(document.querySelectorAll('.sc-range__btn'), function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.range === rangeId));
    });
  }

  /* --- 环境同步 ------------------------------------------------------------
   * 拆成三步，每步只干一件事，是为了不出现"为了改一行字把整张图重画一遍"：
   *   syncText()  写 lang、格式化器、data-i18n 文案（不碰 SVG）
   *   repaint()   重画几何 + 读数
   *   syncScheme() 写 color-scheme（原生控件 / 滚动条的唯一开关）
   *
   * 两个必须显式订阅的时机：
   *   1. **host.ready**：ui.js 是在 iframe 里跑的，而宿主是**之后**才把
   *      locale / 外观发下来的。只在启动时读一次 app.locale 读到的是 runtime
   *      的默认值 'en-US' —— 于是界面一半中文一半英文，而 onLocaleChange
   *      只在"语言变了"时才响，它对首次就绪是不响的。
   *   2. **onAppearanceChange / onLocaleChange**：会话中途真的会变。
   * -------------------------------------------------------------------- */
  function syncText() {
    document.documentElement.lang = app.locale || 'zh-CN';
    buildFormatters();
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll('[data-series-name]').forEach(function (node) {
      var spec = SERIES.filter(function (s) { return s.key === node.dataset.seriesName; })[0];
      if (spec) node.textContent = t(spec.name);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (node) {
      node.setAttribute('aria-label', t(node.dataset.i18nAria));
    });
  }

  function repaint() {
    // 语言不只是换字：日期格式和数字分组分隔符也一起换，刻度标签要重排。
    draw(false);
    if (state.rows) paintReadouts(state.rows);
  }

  /* color-scheme 不在契约里，必须显式写 —— 它决定原生滚动条和表单控件的
   * 默认外观，不设的话深色主题下会出现一条亮色滚动条，这正是"廉价感"
   * 最常见的来源之一。 */
  function syncScheme() {
    var mode = app.appearanceMode === 'light' || app.appearanceMode === 'dark'
      ? app.appearanceMode
      : null;
    if (mode) document.documentElement.style.colorScheme = mode;
  }

  function syncEnvironment(animate) {
    syncScheme();
    syncText();
    draw(animate);
    if (state.rows) paintReadouts(state.rows);
  }

  /* --- 响应式 -------------------------------------------------------------- */
  var observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(function () {
      var w = el.plot.clientWidth;
      // 守卫：draw() 自己也会改高度，守卫防止"改尺寸→重绘→再改尺寸"的死循环。
      if (Math.abs(w - lastWidth) < 1) return;
      lastWidth = w;
      draw(false); // 不放入场动画，否则每次拖窗口曲线都重画一遍
    });
    observer.observe(el.plot);
  }

  /* --- 启动 ----------------------------------------------------------------
   * 不要写成顶层 `await`：宿主会把 <script src="ui.js"> 就地替换成裸的
   * script 元素（Rust inline_miniapp_siblings），**没有** type="module"，
   * 顶层 await 是 SyntaxError，整份文件一行都不执行，界面停在空壳上，
   * 而症状看起来只是"没有数据"。任何 await 都待在一个 async 函数内部。
   * -------------------------------------------------------------------- */
  buildFormatters();
  // tooltip 宽度从 CSS 读一次就够：热路径上再读一次就是一次强制样式重算。
  tipWidth = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--sc-tip-w')
  ) || 176;
  syncText();
  syncScheme();
  // 先把格子的高度定下来：否则骨架先按 248px 的 fallback 渲染，等图画出来
  // 再长到真实高度，第一帧就会跳一下。
  measure();

  var startRange = '24h';
  applyPressed(startRange);
  state.rangeId = startRange;
  lastWidth = el.plot.clientWidth;
  el.plot.dataset.state = 'loading';
  el.empty.hidden = true;

  /* 首帧**不等** storage。
   *
   * 持久化的只是一个本地偏好（上次选了哪个窗口）。让它挡在第一屏前面，等于
   * 把"界面什么时候出现"交给一次 IPC 往返 —— 而这个往返可能慢、可能失败、
   * 也可能永远不回来。缓存该有的语义是"改变初始呈现"，不是"决定何时呈现"。
   * 所以先按默认窗口出图，读回来了再纠正一次；用户看到的多半是零成本的。
   */
  load(startRange, true)
    .then(function (rows) {
      state.rows = rows;
      el.empty.hidden = !!rows;
      syncEnvironment(true); // 首帧：文案 + 几何 + 读数一次画完，曲线有入场动画
      readRange().then(function (saved) {
        if (!saved || !RANGES[saved] || saved === startRange) return;
        applyPressed(saved);
        applyRange(saved);
      });
    })
    .catch(function (err) {
      // 首屏失败不能静默：用户看到的是空白，不是一句报错。
      el.foot.textContent = String((err && err.message) || err);
      el.skeleton.hidden = true;
      el.plot.dataset.state = 'empty';
      el.empty.hidden = false;
    });

  // 宿主就绪：locale / 外观到这里才第一次可信。放在最后而不是启动时，
  // 是因为 ui.js 跑在 iframe 里，而 host.ready 是之后才从父窗口送进来的。
  app.on(function (event) {
    if (event && event.type === 'ready') syncEnvironment(false);
  });

  // 订阅而不是只读一次：外观和语言都会在会话中途变化。
  //
  // 陷阱：onAppearanceChange 的回调收到的是**整个事件对象**
  // （{ type: 'theme.change', appearanceMode: 'light' }），不是裸的 mode 字符串。
  // 直接 app.onAppearanceChange((mode) => set(mode)) 会把 "[object Object]" 写进
  // color-scheme。宿主在 emit 之前已经先更新了 app.appearanceMode，所以读 getter。
  app.onAppearanceChange(function () {
    // 颜色全部走 --hamuna-* token，主题切换本来就会自动跟随；这里仍然重绘，
    // 是为了让"换主题后重新计算"成为这个样例的显式契约 —— 一旦有人把颜色
    // 烘焙进内联 style 或者改成 canvas 绘制，这一行就是唯一的救命处。
    syncEnvironment(false);
  });

  app.onLocaleChange(function () {
    syncEnvironment(false);
  });
})();