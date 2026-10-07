/* ============================================================================
 * 天体图鉴 / Celestial Atlas — 行为层
 *
 * 这个文件教四件在"数据 + 图"这类 MiniApp 里最容易写错的事：
 *
 *   1. **场景染色写在 :root 的自定义属性上**，不是给每个元素写内联色。
 *      换目标时 JS 只写一次 `--at-dye-mix`，整片天区、图上的星、准星、
 *      页面底色那一层余晖全部跟着变 —— 一处编排，而不是十几个 inline style。
 *   2. **可见度是算出来的**，不是逐个手打的标签。给定观测者纬度，
 *      由赤纬算出中天高度，再分三档。四个语义色因此各有各的真实用途。
 *   3. **几何与颜色分离**：JS 只写几何（cx / cy / r / d / transform），
 *      颜色一律交给 style.css 的类。主题切换不需要重画这张图。
 *   4. **完整的 toast 生命周期**：进入 → 停留 → 退场 → 摘节点，退场靠
 *      animationend 配一个定时兜底。只做进入是最常见的半成品动效。
 *
 * 运行时陷阱：onAppearanceChange / onLocaleChange **不会**为首屏状态触发。
 * 首屏对齐必须走 app.on(e => e.type === 'ready')。三个样例都在同一个坑上
 * 摔过，所以这里把三处订阅写在了一起。
 * ========================================================================= */
(function () {
  'use strict';

  /* --- 文案 -----------------------------------------------------------------
   * meta.json::i18n 是宿主侧用来本地化应用名与描述的，ui.js 读不到它，
   * 所以应用内的文案表要自己维护一份。app.t(table, fallback) 是运行时本地化
   * 的正确入口。
   * -------------------------------------------------------------------- */
  var I18N = {
    'app.title': { 'zh-CN': '天体图鉴', 'en-US': 'Celestial Atlas' },
    'app.subtitle': { 'zh-CN': '深空观测图鉴 · {n} 个目标', 'en-US': 'Deep-sky observing atlas · {n} objects' },
    'app.kicker': { 'zh-CN': 'CELESTIAL ATLAS', 'en-US': 'CELESTIAL ATLAS' },
    'app.latitude': { 'zh-CN': '北纬 35°', 'en-US': '35° N' },
    'plate.caption': { 'zh-CN': '星图，方向键移动准星', 'en-US': 'Star chart; arrow keys move the crosshair' },
    'catalog.title': { 'zh-CN': '星表', 'en-US': 'Catalogue' },
    'catalog.count': { 'zh-CN': '{n} 个目标', 'en-US': '{n} objects' },
    'filter.all': { 'zh-CN': '全部', 'en-US': 'All' },
    'type.star': { 'zh-CN': '恒星', 'en-US': 'Star' },
    'type.cluster': { 'zh-CN': '星团', 'en-US': 'Cluster' },
    'type.nebula': { 'zh-CN': '星云', 'en-US': 'Nebula' },
    'type.galaxy': { 'zh-CN': '星系', 'en-US': 'Galaxy' },
    'plate.hint': { 'zh-CN': '在图上移动指针，读出该处的高度与方位', 'en-US': 'Move the pointer across the plate to read altitude and azimuth there' },
    'panel.data': { 'zh-CN': '数据', 'en-US': 'Data' },
    'panel.observe': { 'zh-CN': '观测建议', 'en-US': 'Observation' },
    'panel.log': { 'zh-CN': '观测记录', 'en-US': 'Observation log' },
    'field.magnitude': { 'zh-CN': '星等', 'en-US': 'Magnitude' },
    'field.distance': { 'zh-CN': '距离', 'en-US': 'Distance' },
    'field.spectral': { 'zh-CN': '光谱型', 'en-US': 'Spectral class' },
    'field.designation': { 'zh-CN': '编号', 'en-US': 'Designation' },
    'field.ra': { 'zh-CN': '赤经', 'en-US': 'Right ascension' },
    'field.dec': { 'zh-CN': '赤纬', 'en-US': 'Declination' },
    'field.constellation': { 'zh-CN': '所属星座', 'en-US': 'Constellation' },
    'field.season': { 'zh-CN': '最佳观测季', 'en-US': 'Best season' },
    'field.maxalt': { 'zh-CN': '中天高度', 'en-US': 'Culminating altitude' },
    'season.winter': { 'zh-CN': '冬', 'en-US': 'Winter' },
    'season.spring': { 'zh-CN': '春', 'en-US': 'Spring' },
    'season.summer': { 'zh-CN': '夏', 'en-US': 'Summer' },
    'season.autumn': { 'zh-CN': '秋', 'en-US': 'Autumn' },
    'vis.good': { 'zh-CN': '观测条件良好', 'en-US': 'Well placed' },
    'vis.warn': { 'zh-CN': '低空且短暂', 'en-US': 'Low and brief' },
    'vis.error': { 'zh-CN': '本纬度不升起', 'en-US': 'Never rises here' },
    'vis.altitude': { 'zh-CN': '中天 {v}°', 'en-US': 'culminates at {v}°' },
    'action.log': { 'zh-CN': '加入观测记录', 'en-US': 'Add to observation log' },
    'action.unlog': { 'zh-CN': '移出记录', 'en-US': 'Remove from log' },
    'log.empty': { 'zh-CN': '记录还是空的', 'en-US': 'The log is empty' },
    'log.hint': { 'zh-CN': '收藏存在本地，下次打开还在', 'en-US': 'Saved locally; it survives a restart' },
    'log.count': { 'zh-CN': '{n} 项', 'en-US': '{n} entries' },
    'toast.added': { 'zh-CN': '已加入观测记录', 'en-US': 'Added to the observation log' },
    'toast.removed': { 'zh-CN': '已移出观测记录', 'en-US': 'Removed from the observation log' },
    'toast.storage': { 'zh-CN': '本地存储不可用，本次改动不会保留', 'en-US': 'Storage unavailable; this change will not persist' },
    'toast.loaded': { 'zh-CN': '已读取本地记录', 'en-US': 'Loaded the saved log' },
    'state.empty': { 'zh-CN': '这个筛选下没有目标', 'en-US': 'No objects match this filter' },
    'state.empty.hint': { 'zh-CN': '换一个类型，或切回「全部」', 'en-US': 'Pick another type, or switch back to All' },
    'plate.no': { 'zh-CN': '图版', 'en-US': 'Plate' },
    'unit.ly': { 'zh-CN': '光年', 'en-US': 'ly' },
    'unit.kly': { 'zh-CN': '千光年', 'en-US': 'kly' },
    'unit.mly': { 'zh-CN': '百万光年', 'en-US': 'Mly' },
    'alt.label': { 'zh-CN': '高度', 'en-US': 'ALT' },
    'az.label': { 'zh-CN': '方位', 'en-US': 'AZ' }
  };

  function t(key, vars) {
    var table = I18N[key] || {};
    // 兜底取 zh-CN：宿主给了一个没覆盖的 locale 时，也不要显示空字符串。
    var out = app.t(table, table['zh-CN'] || key);
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        out = out.split('{' + k + '}').join(vars[k]);
      });
    }
    return out;
  }

  /* --- 星座图版数据 ---------------------------------------------------------
   * 坐标是 0..100 的方格，y 向下，单位是"这张图上的一格"。
   * 每个真实星点的相对位置按肉眼在天空里看到的形状摆：猎户座的四边形、
   * 北斗的斗柄、大熊的斗勺、天鹅的北十字。没有一张是随机生成的。
   *
   * stars: [x, y, 星等, 英文名]
   * lines: 恒星的成对下标。画的是 stick figure，不是真实的连线星图 ——
   *        连线是制图约定，不是天文学事实，这个区别要在注释里说清楚。
   *
   * ponytail: 只有 13 个星座，而且坐标是按肉眼形状手摆的，不是从 RA/Dec
   * 真投影出来的（那需要星历和一次球面三角）。加星座时照同一套摆法补，
   * 或者接一份真实的亮星表替换 FIGURES.stars —— 上层渲染代码不用动。
   * -------------------------------------------------------------------- */
  var FIGURES = {
    ori: {
      cn: '猎户座', en: 'Orion',
      stars: [
        [30, 18, 0.50, 'Betelgeuse'], [66, 22, 1.64, 'Bellatrix'], [46, 47, 2.23, 'Mintaka'],
        [50, 52, 1.69, 'Alnilam'], [55, 57, 1.77, 'Alnitak'], [38, 74, 2.06, 'Saiph'],
        [70, 78, 0.13, 'Rigel']
      ],
      lines: [[0, 1], [0, 2], [1, 2], [2, 3], [3, 4], [4, 5], [4, 6]]
    },
    tau: {
      cn: '金牛座', en: 'Taurus',
      stars: [
        [78, 15, 1.65, 'Elnath'], [46, 34, 3.40, 'θ Tau'], [41, 41, 3.65, 'γ Tau'],
        [49, 48, 3.00, 'ζ Tau'], [56, 54, 2.88, 'ε Tau'], [44, 68, 0.85, 'Aldebaran']
      ],
      lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]
    },
    cma: {
      cn: '大犬座', en: 'Canis Major',
      stars: [
        [28, 14, 2.45, 'Aludra'], [26, 16, 1.83, 'Wezen'], [30, 34, 1.98, 'Mirzam'],
        [22, 46, 1.50, 'Adhara'], [38, 48, 3.02, 'Furud'], [58, 72, -1.46, 'Sirius']
      ],
      lines: [[0, 1], [1, 2], [2, 5], [1, 3], [3, 4], [4, 5]]
    },
    gem: {
      cn: '双子座', en: 'Gemini',
      stars: [
        [38, 16, 1.58, 'Castor'], [62, 14, 1.14, 'Pollux'], [86, 42, 1.93, 'Alhena'],
        [36, 56, 2.87, 'μ Gem'], [60, 54, 2.98, 'ε Gem'], [34, 86, 3.35, 'ξ Gem'],
        [62, 86, 3.53, 'δ Gem']
      ],
      lines: [[0, 4], [4, 6], [1, 5], [5, 7], [0, 1]]
    },
    car: {
      cn: '船底座', en: 'Carina',
      stars: [[26, 20, 0.72, 'Canopus'], [46, 46, 2.21, 'Aspidiske'], [66, 30, 1.68, 'Miaplacidus']],
      lines: [[0, 1], [1, 2]]
    },
    uma: {
      cn: '大熊座', en: 'Ursa Major',
      stars: [
        [24, 30, 1.79, 'Dubhe'], [18, 62, 2.37, 'Merak'], [46, 72, 2.44, 'Phecda'],
        [50, 40, 3.31, 'Megrez'], [72, 36, 1.77, 'Alioth'], [78, 58, 2.23, 'Mizar'],
        [86, 22, 1.86, 'Alkaid']
      ],
      lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]]
    },
    cru: {
      cn: '南十字座', en: 'Crux',
      stars: [[46, 74, 0.76, 'Acrux'], [46, 30, 1.63, 'Gacrux'], [72, 52, 1.25, 'Mimosa'], [22, 52, 2.79, 'δ Cru']],
      lines: [[0, 1], [2, 3]]
    },
    and: {
      cn: '仙女座', en: 'Andromeda',
      stars: [
        [26, 24, 2.06, 'Alpheratz'], [44, 40, 3.27, 'δ And'], [58, 52, 2.06, 'Mirach'],
        [82, 76, 2.10, 'Almach']
      ],
      lines: [[0, 1], [1, 2], [2, 3]]
    },
    peg: {
      cn: '飞马座', en: 'Pegasus',
      stars: [
        [24, 26, 2.42, 'Scheat'], [26, 50, 2.94, 'Matar'], [22, 72, 2.49, 'Markab'],
        [50, 80, 2.83, 'Algenib'], [52, 24, 2.06, 'Alpheratz']
      ],
      lines: [[1, 0], [1, 2], [2, 3], [3, 4], [4, 0]]
    },
    per: {
      cn: '英仙座', en: 'Perseus',
      stars: [
        [52, 30, 1.79, 'Mirfak'], [38, 50, 2.12, 'Algol'], [44, 66, 2.93, 'γ Per'],
        [30, 82, 3.01, 'δ Per'], [28, 86, 2.85, 'ζ Per'], [68, 34, 2.88, 'ε Per']
      ],
      lines: [[1, 0], [0, 5], [0, 2], [1, 3], [3, 4]]
    },
    cyg: {
      cn: '天鹅座', en: 'Cygnus',
      stars: [
        [50, 12, 1.25, 'Deneb'], [50, 48, 2.23, 'Sadr'], [50, 84, 3.05, 'Albireo'],
        [24, 40, 2.48, 'Gienah'], [76, 56, 2.87, 'δ Cyg']
      ],
      lines: [[3, 1], [1, 4], [1, 0], [1, 2]]
    },
    lyr: {
      cn: '天琴座', en: 'Lyra',
      stars: [[50, 22, 0.03, 'Vega'], [28, 32, 4.36, 'ζ Lyr'], [32, 74, 3.45, 'β Lyr'], [72, 32, 3.24, 'γ Lyr']],
      lines: [[0, 1], [1, 2], [2, 3], [3, 0]]
    },
    sco: {
      cn: '天蝎座', en: 'Scorpius',
      stars: [
        [30, 16, 2.89, 'σ Sco'], [42, 14, 2.29, 'Dschubba'], [56, 18, 2.62, 'Acrab'],
        [40, 24, 1.09, 'Antares'], [34, 36, 2.82, 'τ Sco'], [48, 44, 2.29, 'ε Sco'],
        [56, 58, 3.00, 'μ Sco'], [62, 72, 3.62, 'ζ Sco'], [56, 86, 1.86, 'Sargas'],
        [40, 94, 1.62, 'Shaula']
      ],
      lines: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9]]
    },
    sgr: {
      cn: '人马座', en: 'Sagittarius',
      stars: [
        [74, 32, 3.32, 'τ Sgr'], [56, 24, 2.05, 'Nunki'], [36, 32, 2.60, 'ζ Sgr'],
        [44, 42, 2.70, 'Kaus Media'], [34, 66, 2.81, 'λ Sgr'], [58, 68, 3.17, 'φ Sgr'],
        [30, 58, 1.85, 'Kaus Australis']
      ],
      lines: [[2, 3], [3, 1], [1, 0], [3, 4], [4, 5], [5, 6], [6, 2], [1, 5]]
    }
  };

  /* --- 星表 -----------------------------------------------------------------
   * 每一行是一个真实天体：编号 / 中英文名 / 星等 / 距离（光年）/ 光谱型 /
   * 赤经赤纬 / 类型 / 最佳观测季 / 所在星座 / 图上坐标 / 一行观测建议。
   *
   * `deg` 是赤纬的数值形式，只有可见度计算用它（显示一律用排好版的 `dec`
   * 字符串 —— 数值和排版是两件事，混在一起就要在两个地方各修一次）。
   * `tint` 只在深空天体上有：它们没有光谱型，染色按激发方式给（见 tintOf）。
   * `note` 是 [中文, English]，不是两套翻译 —— 同一个建议的两种语言写法。
   * -------------------------------------------------------------------- */
  var OBJECTS = [
    { id: 'betelgeuse', d: 'α Ori', cn: '参宿四', en: 'Betelgeuse', mag: 0.50, ly: 642, sp: 'M1-2Ia', ra: '05h 55m 10s', dec: '+07° 24′', deg: 7.40, kind: 'star', season: 'winter', fig: 'ori', x: 30, y: 18, note: ['红超巨星，亮度在 0.0 到 1.3 等之间来回跳，用肉眼看它一晚比一晚亮。', 'A red supergiant whose magnitude drifts between 0.0 and 1.3 — watch it twice in one night and it will not look the same.'] },
    { id: 'rigel', d: 'β Ori', cn: '参宿七', en: 'Rigel', mag: 0.13, ly: 860, sp: 'B8Ia', ra: '05h 14m 32s', dec: '−08° 12′', deg: -8.20, kind: 'star', season: 'winter', fig: 'ori', x: 70, y: 78, note: ['参宿七星，蓝白色。冬季 Orion 座的东南角，是全天最容易认的一颗。', 'The blue-white foot of Orion, and the easiest star in the whole winter sky to pick out.'] },
    { id: 'bellatrix', d: 'γ Ori', cn: '参宿五', en: 'Bellatrix', mag: 1.64, ly: 250, sp: 'B2III', ra: '05h 25m 08s', dec: '+06° 21′', deg: 6.35, kind: 'star', season: 'winter', fig: 'ori', x: 66, y: 22, note: ['猎户右肩的两颗之一，星名意为"女战士"。', 'One of the two shoulders of Orion; the name means "female warrior".'] },
    { id: 'alnilam', d: 'ε Ori', cn: '参宿二', en: 'Alnilam', mag: 1.69, ly: 2000, sp: 'B0Ia', ra: '05h 36m 13s', dec: '−01° 12′', deg: -1.20, kind: 'star', season: 'winter', fig: 'ori', x: 50, y: 52, note: ['腰带正中那颗，也是猎户座大星云正上方的一个透视投影巧合。', 'The middle of the belt, and a line-of-sight coincidence that puts it right above the Orion Nebula.'] },
    { id: 'alnitak', d: 'ζ Ori', cn: '参宿一', en: 'Alnitak', mag: 1.77, ly: 1260, sp: 'O9.5Iab', ra: '05h 40m 46s', dec: '−01° 57′', deg: -1.95, kind: 'star', season: 'winter', fig: 'ori', x: 55, y: 57, note: ['腰带东端，紧贴大星云；望远镜里能看见星云的光晕裹着它。', 'The eastern end of the belt, sitting against the nebula — in any telescope its light is visibly wrapped by the glow.'] },
    { id: 'm42', d: 'M42', cn: '猎户座大星云', en: 'Orion Nebula', mag: 4.00, ly: 1344, sp: 'O/H 电离', ra: '05h 35m 17s', dec: '−05° 27′', deg: -5.45, kind: 'nebula', season: 'winter', fig: 'ori', x: 52, y: 66, tint: 1, note: ['北天唯一能用双筒看得舒服的弥漫星云。四刃遮光板能把背景压下去不少。', 'The one diffuse nebula that rewards binoculars in a real way. A four-vane light shield buys you a lot of contrast here.'] },

    { id: 'sirius', d: 'α CMa', cn: '天狼星', en: 'Sirius', mag: -1.46, ly: 8.6, sp: 'A1V', ra: '06h 45m 09s', dec: '−16° 43′', deg: -16.72, kind: 'star', season: 'winter', fig: 'cma', x: 58, y: 72, note: ['全天最亮的恒星，距离只有 8.6 光年。冬夜里它是找猎户座的起点。', 'The brightest star in the sky, only 8.6 light years away. On a winter night it is where you start finding Orion.'] },
    { id: 'adhara', d: 'ε CMa', cn: '弧矢七', en: 'Adhara', mag: 1.50, ly: 430, sp: 'B2II', ra: '06h 58m 38s', dec: '−28° 58′', deg: -28.97, kind: 'star', season: 'winter', fig: 'cma', x: 22, y: 46, note: ['大犬座后腿的第二亮星，视星等虽然只有 1.5，肉眼却显得比数字更亮。', 'Second-brightest in the Great Dog\'s hind leg. At magnitude 1.5 it still reads brighter than the number suggests.'] },
    { id: 'mirzam', d: 'β CMa', cn: '军市一', en: 'Mirzam', mag: 1.98, ly: 490, sp: 'B1II', ra: '06h 22m 43s', dec: '−17° 57′', deg: -17.95, kind: 'star', season: 'winter', fig: 'cma', x: 30, y: 34, note: ['"宣告者"：它是一颗脉动变星，星等在 1.98 与 2.05 之间来回。', 'The Herald — a pulsating variable that swings between magnitude 1.98 and 2.05.'] },

    { id: 'aldebaran', d: 'α Tau', cn: '毕宿五', en: 'Aldebaran', mag: 0.85, ly: 65, sp: 'K5III', ra: '04h 35m 55s', dec: '+16° 31′', deg: 16.52, kind: 'star', season: 'winter', fig: 'tau', x: 44, y: 68, note: ['毕宿五是"公牛的眼睛"。橙红色，和昴星团凑成一个很好认的 V。', 'Aldebaran is "the eye of the Bull". Orange-red, and it closes the V that the Pleiades open.'] },
    { id: 'elnath', d: 'β Tau', cn: '五车五', en: 'Elnath', mag: 1.65, ly: 134, sp: 'B7III', ra: '05h 26m 18s', dec: '+28° 36′', deg: 28.60, kind: 'star', season: 'winter', fig: 'tau', x: 78, y: 15, note: ['虽然列在金牛座，它其实是和猎户座同源的成员 —— 一颗被吹散了的巨星的残骸。', 'Listed in Taurus but kin to Orion: both are leftovers of the same disrupted giant star.'] },
    { id: 'm45', d: 'M45', cn: '昴星团', en: 'Pleiades', mag: 1.60, ly: 444, sp: 'B7 星族', ra: '03h 47m 24s', dec: '+24° 07′', deg: 24.12, kind: 'cluster', season: 'winter', fig: 'tau', x: 72, y: 34, tint: 2, note: ['裸眼能看到六颗，低海拔时第七颗也在。双筒里是一小片蓝紫色的星群。', 'Six to the naked eye, seven from a low site. In binoculars it resolves into a loose violet-blue swarm.'] },
    { id: 'm1', d: 'M1', cn: '蟹状星云', en: 'Crab Nebula', mag: 8.40, ly: 6500, sp: 'O 型超新星遗迹', ra: '05h 34m 32s', dec: '+22° 01′', deg: 22.02, kind: 'nebula', season: 'winter', fig: 'tau', x: 60, y: 46, tint: 1, note: ['公元 1054 年超新星的残骸，宋代天文学家记下了它。大望远镜里能看到那团细丝。', 'The wreck of the supernova of 1054, recorded by Chinese astronomers. A large instrument shows the filamentary filaments.'] },

    { id: 'pollux', d: 'β Gem', cn: '北河三', en: 'Pollux', mag: 1.14, ly: 34, sp: 'K0III', ra: '07h 45m 19s', dec: '+28° 02′', deg: 28.03, kind: 'star', season: 'winter', fig: 'gem', x: 62, y: 14, note: ['橙巨星。它和北河二已经不是一个系统了 —— 公分量的差距就在这里。', 'An orange giant that no longer shares a system with Castor. The few-percent mass difference is why.'] },
    { id: 'castor', d: 'α Gem', cn: '北河二', en: 'Castor', mag: 1.58, ly: 51, sp: 'A1V', ra: '07h 34m 36s', dec: '+31° 53′', deg: 31.88, kind: 'star', season: 'winter', fig: 'gem', x: 38, y: 16, note: ['六颗肉眼可见的双星系统，倍率越高分得越开；每一颗又都是双星。', 'Six stars visible to the eye, splitting further with magnification — and every one of them is itself double.'] },
    { id: 'alhena', d: 'γ Gem', cn: '井宿三', en: 'Alhena', mag: 1.93, ly: 109, sp: 'A1IV', ra: '06h 37m 43s', dec: '+16° 24′', deg: 16.40, kind: 'star', season: 'winter', fig: 'gem', x: 86, y: 42, note: ['双子座东南角那颗。它是这一组里唯一的 A 型星，所以看上去比邻居冷。', 'The southeastern corner of Gemini, and the only A-type in the pair — which is why it looks cooler than its neighbour.'] },

    { id: 'canopus', d: 'α Car', cn: '老人星', en: 'Canopus', mag: 0.72, ly: 310, sp: 'F0Ia', ra: '06h 23m 57s', dec: '−52° 42′', deg: -52.70, kind: 'star', season: 'winter', fig: 'car', x: 26, y: 20, note: ['全天第二亮星。在北纬 35°，它一年里有几晚能从低空看到，抬头角度不足 5°。', 'Second-brightest in the sky. From 35° N there are a handful of nights a year when it clears the southern horizon, under 5° up.'] },

    { id: 'dubhe', d: 'α UMa', cn: '天枢', en: 'Dubhe', mag: 1.79, ly: 123, sp: 'K0III', ra: '11h 03m 44s', dec: '+61° 45′', deg: 61.75, kind: 'star', season: 'spring', fig: 'uma', x: 24, y: 30, note: ['北斗斗口两颗之一，指北极星的直线就从它出发。', 'One of the two pointer stars at the bowl, and the straight line to Polaris starts here.'] },
    { id: 'merak', d: 'β UMa', cn: '天璇', en: 'Merak', mag: 2.37, ly: 79, sp: 'A1V', ra: '11h 01m 50s', dec: '+56° 23′', deg: 56.38, kind: 'star', season: 'spring', fig: 'uma', x: 18, y: 62, note: ['指极星的另一端。天璇到天枢只有 5 度多，肉眼能把这条线延伸得很准。', 'The far end of the pointers. The line from Merak to Dubhe is barely five degrees long, and the eye extends it convincingly.'] },
    { id: 'phecda', d: 'γ UMa', cn: '天玑', en: 'Phecda', mag: 2.44, ly: 83, sp: 'A0V', ra: '11h 53m 50s', dec: '+53° 42′', deg: 53.70, kind: 'star', season: 'spring', fig: 'uma', x: 46, y: 72, note: ['斗勺的外下角。北半球春季傍晚，它正好挂在树梢的高度上。', 'The outer corner of the bowl, hanging at treetop height on a spring evening.'] },
    { id: 'alioth', d: 'ε UMa', cn: '玉衡', en: 'Alioth', mag: 1.77, ly: 81, sp: 'A1III', ra: '12h 54m 02s', dec: '+55° 58′', deg: 55.97, kind: 'star', season: 'spring', fig: 'uma', x: 72, y: 36, note: ['北斗七星里最亮的一颗，也是北天天区确定视宁度最常用的一颗。', 'The brightest of the seven, and the usual yardstick for northern seeing.'] },
    { id: 'mizar', d: 'ζ UMa', cn: '开阳', en: 'Mizar', mag: 2.23, ly: 83, sp: 'A2V', ra: '13h 23m 56s', dec: '+54° 55′', deg: 54.92, kind: 'star', season: 'spring', fig: 'uma', x: 78, y: 58, note: ['开阳旁边那颗小星就是辅，传统上叫"驴"；历史上第一颗被拍下来的双星。', 'The little star beside it was Alcor, the "little donkey" — the first double star ever photographed.'] },
    { id: 'alkaid', d: 'η UMa', cn: '摇光', en: 'Alkaid', mag: 1.86, ly: 104, sp: 'B3V', ra: '13h 47m 32s', dec: '+49° 19′', deg: 49.32, kind: 'star', season: 'spring', fig: 'uma', x: 86, y: 22, note: ['斗柄末端。它是这一串里最靠南的一颗，也是最容易被前景遮住的。', 'The tip of the handle — the southernmost of the seven, and the one most often lost to foreground haze.'] },
    { id: 'm81', d: 'M81', cn: '波德星系', en: "Bode's Galaxy", mag: 6.94, ly: 11800000, sp: 'Sa 型旋涡', ra: '09h 55m 33s', dec: '+69° 04′', deg: 69.07, kind: 'galaxy', season: 'spring', fig: 'uma', x: 18, y: 24, tint: 3, note: ['十二百万光年外的旋涡星系，恰好悬在斗勺北侧。暗夜里可以用中等的望远镜看见。', 'A spiral twelve million light years out, hanging just off the bowl\'s northern edge — there for a moderate telescope on a dark night.'] },
    { id: 'm97', d: 'M97', cn: '夜枭星云', en: 'Owl Nebula', mag: 9.86, ly: 2030, sp: '[O III] 行星状', ra: '11h 14m 48s', dec: '+55° 01′', deg: 55.02, kind: 'nebula', season: 'spring', fig: 'uma', x: 82, y: 40, tint: 1, note: ['猫头鹰的两只"眼睛"要用大口径和 UHC 滤镜才分得开，光学不透明度是出了名的难。', 'The owl\'s "eyes" need a large aperture and a UHC filter to separate — famously optically thick.'] },

    { id: 'acrux', d: 'α Cru', cn: '南门二', en: 'Acrux', mag: 0.76, ly: 4.4, sp: 'B0.5IV', ra: '12h 26m 36s', dec: '−63° 06′', deg: -63.10, kind: 'star', season: 'spring', fig: 'cru', x: 46, y: 74, note: ['离太阳最近的恒星之一。纬度 35° 以北，它一次也不会升起来。', 'One of the nearest stars to the Sun — and above latitude 35° it never clears the horizon at all.'] },
    { id: 'mimosa', d: 'β Cru', cn: '十字架三', en: 'Mimosa', mag: 1.25, ly: 280, sp: 'B0.5III', ra: '12h 47m 43s', dec: '−59° 41′', deg: -59.68, kind: 'star', season: 'spring', fig: 'cru', x: 72, y: 52, note: ['南十字东侧的亮星，同样在北半球低纬也不升起。', 'The eastern bright star of the Southern Cross, equally invisible from northern latitudes.'] },

    { id: 'alpheratz', d: 'α And', cn: '壁宿二', en: 'Alpheratz', mag: 2.06, ly: 97, sp: 'B8IV', ra: '00h 08m 23s', dec: '+29° 05′', deg: 29.08, kind: 'star', season: 'autumn', fig: 'and', x: 26, y: 24, note: ['飞马座四边形的东北角。它原先属于飞马，是一次双星质量交换后才归入仙女座的。', 'The northeast corner of the Great Square. It used to belong to Pegasus until a mass swap moved it.'] },
    { id: 'mirach', d: 'β And', cn: '奎宿九', en: 'Mirach', mag: 2.06, ly: 197, sp: 'M0III', ra: '01h 09m 44s', dec: '+35° 37′', deg: 35.62, kind: 'star', season: 'autumn', fig: 'and', x: 58, y: 52, note: ['找仙女座星系的标准跳板：先对准它，往它西北方向挪两度。', 'The standard hop to the Andromeda Galaxy: centre on Mirach, then step two degrees north-west.'] },
    { id: 'almach', d: 'γ And', cn: '天大将军一', en: 'Almach', mag: 2.10, ly: 350, sp: 'K3II', ra: '02h 03m 54s', dec: '+42° 20′', deg: 42.33, kind: 'star', season: 'autumn', fig: 'and', x: 82, y: 76, note: ['仙女座链的末端，一颗橙色巨星；旁边是一对很配的紧双星。', 'The end of the Andromeda chain, an orange giant, with a tight and very photogenic pair beside it.'] },
    { id: 'm31', d: 'M31', cn: '仙女座星系', en: 'Andromeda Galaxy', mag: 3.44, ly: 2540000, sp: 'Sb 型盘', ra: '00h 42m 44s', dec: '+41° 16′', deg: 41.27, kind: 'galaxy', season: 'autumn', fig: 'and', x: 66, y: 66, tint: 3, note: ['肉眼可见的最远天体。暗天空下它的两极比纸面还长，值得用视宁度好的夜晚。', 'The most distant object visible to the naked eye. Its disc overruns the page on a dark night — wait for good seeing.'] },
    { id: 'm110', d: 'M110', cn: '仙女座伴星系', en: 'Messier 110', mag: 8.07, ly: 2690000, sp: 'E6 椭圆', ra: '00h 40m 22s', dec: '+41° 41′', deg: 41.68, kind: 'galaxy', season: 'autumn', fig: 'and', x: 74, y: 74, tint: 4, note: ['M31 旁边那团没有旋臂的椭圆。它比 M31 更暗，但在大望远镜里更有质感。', 'The featureless elliptical next to M31 — fainter, but far more rewarding in a large instrument.'] },

    { id: 'markab', d: 'α Peg', cn: '室宿一', en: 'Markab', mag: 2.49, ly: 133, sp: 'B9III', ra: '23h 04m 46s', dec: '+15° 12′', deg: 15.20, kind: 'star', season: 'autumn', fig: 'peg', x: 22, y: 72, note: ['飞马座四边形的西南角，也是"秋季四边形"里的一角。', 'The southwest corner of the Great Square, and one corner of the autumn quadrilateral.'] },
    { id: 'scheat', d: 'β Peg', cn: '室宿二', en: 'Scheat', mag: 2.42, ly: 196, sp: 'M2.5II', ra: '23h 03m 46s', dec: '+28° 05′', deg: 28.08, kind: 'star', season: 'autumn', fig: 'peg', x: 24, y: 26, note: ['半规则的脉动变星，亮度变化肉眼可辨，是认四边形方位的好路标。', 'A semi-regular pulsator whose changes the eye can catch — a reliable landmark for orienting the Square.'] },
    { id: 'algenib', d: 'γ Peg', cn: '壁宿一', en: 'Algenib', mag: 2.83, ly: 470, sp: 'B2IV', ra: '00h 13m 14s', dec: '+15° 11′', deg: 15.18, kind: 'star', season: 'autumn', fig: 'peg', x: 50, y: 80, note: ['四边形最南的一颗，也是这一组里唯一的 B 型星，颜色偏蓝。', 'The southern corner of the Square, and the only B-type among the four — noticeably bluer.'] },
    { id: 'm15', d: 'M15', cn: '飞马座球状星团', en: 'Pegasus Cluster', mag: 6.20, ly: 33600, sp: '红色巨星星族', ra: '21h 29m 58s', dec: '+12° 10′', deg: 12.17, kind: 'cluster', season: 'autumn', fig: 'peg', x: 64, y: 64, tint: 5, note: ['核心可能坍缩成了黑洞的候选之一。中型望远镜就能把外层逐颗解出来。', 'A candidate core-collapse black hole. A moderate instrument resolves the outskirts star by star.'] },

    { id: 'mirfak', d: 'α Per', cn: '天船三', en: 'Mirfak', mag: 1.79, ly: 590, sp: 'F5Ib', ra: '03h 24m 19s', dec: '+49° 52′', deg: 49.87, kind: 'star', season: 'autumn', fig: 'per', x: 52, y: 30, note: ['英仙座的核心。周围那片疏散星团肉眼可数，是秋季最好数的一处。', 'The heart of Perseus. The surrounding open cluster can be counted by eye — the best autumn count there is.'] },
    { id: 'algol', d: 'β Per', cn: '大陵五', en: 'Algol', mag: 2.12, ly: 90, sp: 'B8V', ra: '03h 08m 10s', dec: '+40° 57′', deg: 40.95, kind: 'star', season: 'autumn', fig: 'per', x: 38, y: 50, note: ['"大陵五"是食双星，每隔 2.87 天暗三分之一，肉眼就能看出亮度变了。', 'Algol drops by a third every 2.87 days as its companion eclipses it — a change the eye catches directly.'] },
    { id: 'm34', d: 'M34', cn: '英仙座疏散星团', en: 'Messier 34', mag: 5.50, ly: 1500, sp: 'B 型星族', ra: '02h 42m 06s', dec: '+42° 43′', deg: 42.72, kind: 'cluster', season: 'autumn', fig: 'per', x: 60, y: 46, tint: 2, note: ['大而松散，一度被当成"能看见星系"的北天极限；后来才知道那两颗星就是星系。', 'Big and loose, once mistaken for the northern naked-eye limit of galaxies — until those two stars turned out to be galaxies.'] },

    { id: 'deneb', d: 'α Cyg', cn: '天津四', en: 'Deneb', mag: 1.25, ly: 2600, sp: 'A2Ia', ra: '20h 41m 26s', dec: '+45° 17′', deg: 45.28, kind: 'star', season: 'summer', fig: 'cyg', x: 50, y: 12, note: ['北十字的顶端。秋天它就掠过天顶，冬季夜里又在正南方低处。', 'The head of the Northern Cross. It passes near the zenith in autumn and returns low in the south by winter.'] },
    { id: 'sadr', d: 'γ Cyg', cn: '天津一', en: 'Sadr', mag: 2.23, ly: 1800, sp: 'F8Ib', ra: '20h 22m 14s', dec: '+40° 15′', deg: 40.25, kind: 'star', season: 'summer', fig: 'cyg', x: 50, y: 48, note: ['北十字的中心，一颗尘埃很厚的黄超巨星 —— 它本身就是天鹅座星云的成因之一。', 'At the centre of the cross, a dust-laden yellow supergiant that is itself part of why the Cygnus nebulosity exists.'] },
    { id: 'albireo', d: 'β Cyg', cn: '辇道增七', en: 'Albireo', mag: 3.05, ly: 430, sp: 'K3II', ra: '19h 30m 43s', dec: '+27° 58′', deg: 27.97, kind: 'star', season: 'summer', fig: 'cyg', x: 50, y: 84, note: ['金黄与靛蓝的一对，被称作"夏天的阿伯拉罕之眼"，是检验星野天气的标准靶。', 'Gold beside indigo — "the Summer Triangle\'s eye". The standard test target for seeing.'] },
    { id: 'ngc7000', d: 'NGC 7000', cn: '北美洲星云', en: 'North America Nebula', mag: 4.00, ly: 2590, sp: 'H II 电离', ra: '20h 59m 17s', dec: '+44° 32′', deg: 44.53, kind: 'nebula', season: 'summer', fig: 'cyg', x: 74, y: 22, tint: 1, note: ['必须用滤镜：没有 UHC 或 O III，肉眼看到的只是一小片空。', 'Filters are mandatory here. Without a UHC or O III the region is simply empty to the eye.'] },

    { id: 'vega', d: 'α Lyr', cn: '织女星', en: 'Vega', mag: 0.03, ly: 25, sp: 'A0V', ra: '18h 36m 56s', dec: '+38° 47′', deg: 38.78, kind: 'star', season: 'summer', fig: 'lyr', x: 50, y: 22, note: ['曾是零岁方向。转动的天琴座四边形衬着它，是夏季星空的标记。', 'Once the zero point of the sky. The rotating Lyre frame behind it marks the whole summer.'] },
    { id: 'm57', d: 'M57', cn: '环状星云', en: 'Ring Nebula', mag: 8.80, ly: 2300, sp: '[O III] 行星状', ra: '18h 53m 35s', dec: '+33° 02′', deg: 33.03, kind: 'nebula', season: 'summer', fig: 'lyr', x: 50, y: 60, tint: 1, note: ['人类发现的第一个行星状星云。它小、但有个规整的环，给小口径就很开心。', 'The first planetary nebula ever found. Small but wonderfully regular — it rewards a small aperture.'] },

    { id: 'antares', d: 'α Sco', cn: '心宿二', en: 'Antares', mag: 1.09, ly: 550, sp: 'M1.5Iab', ra: '16h 29m 24s', dec: '−26° 26′', deg: -26.43, kind: 'star', season: 'summer', fig: 'sco', x: 40, y: 24, note: ['"心宿二"是蝎子的心脏。大望远镜里能看到它旁边的伴星，位置随年份慢慢变。', 'The heart of the Scorpion. A large instrument shows its companion, which drifts slowly around over the years.'] },
    { id: 'shaula', d: 'λ Sco', cn: '尾宿八', en: 'Shaula', mag: 1.62, ly: 570, sp: 'B2IV', ra: '17h 33m 37s', dec: '−37° 06′', deg: -37.10, kind: 'star', season: 'summer', fig: 'sco', x: 40, y: 94, note: ['蝎尾的毒刺。从北纬 35° 出发它刚够出南方地平，只有初夏的凌晨值得等。', 'The sting. From 35° N it just clears the southern horizon — worth the early start only in early summer.'] },
    { id: 'm4', d: 'M4', cn: '球状星团', en: 'Messier 4', mag: 5.90, ly: 7200, sp: '红色巨星星族', ra: '16h 23m 36s', dec: '−26° 32′', deg: -26.53, kind: 'cluster', season: 'summer', fig: 'sco', x: 34, y: 52, tint: 5, note: ['离地球最近的球状星团，紧贴心宿二。低倍率下它几乎被那团红光淹掉。', 'The nearest globular, sitting right beside Antares — at low power it nearly drowns in that red glow.'] },

    { id: 'kausaustralis', d: 'ε Sgr', cn: '箕宿三', en: 'Kaus Australis', mag: 1.85, ly: 143, sp: 'B9.5III', ra: '18h 24m 10s', dec: '−34° 23′', deg: -34.38, kind: 'star', season: 'summer', fig: 'sgr', x: 30, y: 58, note: ['人马座"茶壶"的壶嘴，夏天银河最密的一段就在它旁边。', 'The spout of the Teapot, with the densest stretch of the summer Milky Way running past it.'] },
    { id: 'nunki', d: 'σ Sgr', cn: '斗宿四', en: 'Nunki', mag: 2.05, ly: 228, sp: 'B2.5V', ra: '18h 55m 16s', dec: '−26° 18′', deg: -26.30, kind: 'star', season: 'summer', fig: 'sgr', x: 56, y: 24, note: ['茶壶的壶盖。南十字就在它北边不远处，只在地球另一半看得见。', 'The lid of the Teapot. The Southern Cross is not far north of it — visible only from the other half of the planet.'] },
    { id: 'm22', d: 'M22', cn: '人马座球状星团', en: 'Sagittarius Cluster', mag: 5.10, ly: 10600, sp: '红色巨星星族', ra: '18h 36m 24s', dec: '−23° 54′', deg: -23.90, kind: 'cluster', season: 'summer', fig: 'sgr', x: 68, y: 50, tint: 5, note: ['第三个被发现的球状星团，比 M15 还亮。银河浓星区的星云状背景让它更难认。', 'The third globular ever found, brighter than M15 — though the Milky Way\'s nebulosity behind it makes it harder to pick out.'] },
    { id: 'm8', d: 'M8', cn: '礁湖星云', en: 'Lagoon Nebula', mag: 6.00, ly: 4100, sp: 'H II 电离', ra: '18h 03m 37s', dec: '−24° 23′', deg: -24.38, kind: 'nebula', season: 'summer', fig: 'sgr', x: 42, y: 52, tint: 1, note: ['双筒里能看见那道"潟湖"的暗带，中间夹着的那颗小时礁星就是它著名的亮核。', 'The dark "lagoon" channel is visible in binoculars, with the Hourglass core sitting inside it.'] }
  ];

  /* --- 光谱染色 -------------------------------------------------------------
   * 光谱型从 O（最热、蓝白）到 M（最冷、红）是一条连续的轴。ui.js 不写任何
   * 颜色，只写**位置**：插在冷端（accent-secondary）与暖端（accent）之间的
   * 百分之一。颜色由 style.css 的 color-mix 现算 —— 于是"改色板"和"改数据"
   * 是两件不相干的事。
   * -------------------------------------------------------------------- */
  var SPECTRAL_RAMP = { O: 0, B: 1, A: 2, F: 3, G: 4, K: 5, M: 6 };

  function tintOf(o) {
    if (o.kind === 'star') {
      var key = String(o.sp).charAt(0).toUpperCase();
      return SPECTRAL_RAMP[key] == null ? 3 : SPECTRAL_RAMP[key];
    }
    // 深空天体没有光谱型。按激发方式给位置：电离星云偏蓝白（O III 的
    // 500.7nm 最强），年轻的疏散团偏蓝白，老年球状团（红色巨星为主）偏橙。
    return o.tint == null ? 3 : o.tint;
  }

  /* --- 观测点 -------------------------------------------------------------
   * 给定纬度与赤纬，中天高度 = 90 − |dec − lat|。这是球面三角里的正弦定理，
   * 不需要任何星历。定在北纬 35° 是因为它让南十字与老人星落到"够不着"或
   * "勉强够着"两档，语义色才有真实的用武之地。
   * -------------------------------------------------------------------- */
  var LATITUDE = 35;

  function culmination(deg) {
    return 90 - Math.abs(deg - LATITUDE);
  }

  /** 可见度三档：够不着 → 低空 → 良好。返回 chip 的语义槽位。 */
  function visibility(deg) {
    var alt = culmination(deg);
    if (alt < 0) return { tone: 'bad', key: 'vis.error', alt: alt };
    if (alt < 25) return { tone: 'warn', key: 'vis.warn', alt: alt };
    return { tone: 'ok', key: 'vis.good', alt: alt };
  }

  /* --- 索引与工具 ---------------------------------------------------------- */
  var BY_ID = {};
  OBJECTS.forEach(function (o, i) {
    o.index = i; // 图版编号
    BY_ID[o.id] = o;
  });

  var NS = 'http://www.w3.org/2000/svg';
  var STORAGE_KEY = 'celestial-atlas:log';
  var FIELD_STARS = 64;

  var el = {
    frame: document.getElementById('at-frame'),
    svg: document.getElementById('at-svg'),
    read: document.getElementById('at-read'),
    readRa: document.getElementById('at-read-ra'),
    readDec: document.getElementById('at-read-dec'),
    list: document.getElementById('at-list'),
    empty: document.getElementById('at-empty'),
    seg: document.getElementById('at-seg'),
    tally: document.getElementById('at-tally'),
    sub: document.getElementById('at-sub'),
    lat: document.getElementById('at-lat'),
    plateNo: document.getElementById('at-plate-no'),
    name: document.getElementById('at-name'),
    captionMeta: document.getElementById('at-caption-meta'),
    chips: document.getElementById('at-chips'),
    data: document.getElementById('at-data'),
    note: document.getElementById('at-note'),
    toggle: document.getElementById('at-toggle'),
    logList: document.getElementById('at-log-list'),
    logTally: document.getElementById('at-log-tally'),
    toasts: document.getElementById('at-toasts')
  };

  var state = { kind: 'all', selected: OBJECTS[0], log: [] };
  var geom = null;      // 最近一次绘制的几何
  var svgRect = null;   // 缓存矩形：悬停热路径上一次都不读
  var keyCursor = null; // 键盘游标（像素）

  /* --- 格式化器跟着语言走 ---------------------------------------------------
   * locale 变了要重建，而不是只在启动时建一次：数字分组、度数、小数点
   * 全都跟着变，重建一次比在每个调用点判断语言便宜。
   * -------------------------------------------------------------------- */
  var fmtInt, fmtDeg;

  function buildFormatters() {
    var loc = app.locale || 'zh-CN';
    fmtInt = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
    fmtDeg = new Intl.NumberFormat(loc, { maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  }

  /** 星等固定两位小数。U+2212 减号比 ASCII 连字符宽，等宽数字里才对得齐。 */
  function fmtMag(v) {
    return v.toFixed(2).replace('-', '−');
  }

  function fmtAlt(v) {
    return fmtInt.format(Math.round(Math.abs(v))) + '°';
  }

  /** 中天高度可以是负的 —— 负数在这里是信息，不是错误，所以保留符号。 */
  function fmtSignedAlt(v) {
    return fmtDeg.format(Math.round(v)) + '°';
  }

  /** 距离按量级换单位：光年 → 千光年 → 百万光年。存的是一个数，显示是一句话。 */
  function fmtDistance(ly) {
    if (ly < 1000) return fmtInt.format(Math.round(ly * 10) / 10) + ' ' + t('unit.ly');
    if (ly < 1e6) return fmtInt.format(Math.round(ly / 1000)) + ' ' + t('unit.kly');
    return fmtInt.format(Math.round(ly / 1e5) / 10) + ' ' + t('unit.mly');
  }

  function isZh() {
    return (app.locale || 'zh-CN') === 'zh-CN';
  }

  function nameOf(o) {
    return isZh() ? o.cn : o.en;
  }

  function figName(fig) {
    return isZh() ? fig.cn : fig.en;
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  /* --- 伪随机背景星 --------------------------------------------------------
   * 同一个种子必须画出同一片天，否则每次截图都不一样，没法拿这一版和上一版
   * 比对。mulberry32 是 32 位的确定性发生器。
   * -------------------------------------------------------------------- */
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

  /** 星等 → 点半径。星等是对数标尺，所以线性映射会让暗星全部消失。 */
  function starRadius(mag) {
    return Math.max(0.9, Math.min(4.4, 1.1 + (6.5 - mag) * 0.42));
  }

  function svgAdd(parent, tag, attrs) {
    var node = document.createElementNS(NS, tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    parent.appendChild(node);
    return node;
  }

  /* --- 场景染色 -----------------------------------------------------------
   * 一次编排：两个自定义属性写在 :root 上，下游十几个引用点全部跟着变。
   * 这是"CSS 自定义属性写在 JS 里"和"给每个元素写内联色"的分界线 ——
   * 前者改一处，后者改一片，而且后者没法过渡。
   * -------------------------------------------------------------------- */
  function dyeScene(o) {
    var tint = tintOf(o);
    var root = document.documentElement;
    // 插值位置 0..6 → 冷端到暖端的百分比。
    //
    // 两个刻度都不是拍脑袋的：
    //   gamma 1.8 —— 暖端饱和，线性映射下 A 型星（tint=2）线性就有 33%，
    //     早就越过"看起来还是冷"的界了。压一下前半段，O/B/A 才停在冷端。
    //   上限 62% —— 满档会把整块天区染成实色，强调色于是变成了背景。
    //     染色说的是"这一片天偏冷/偏暖"，不是"这里刷了一层漆"。
    var mix = Math.pow(tint / 6, 1.8) * 62;
    root.style.setProperty('--at-dye-mix', mix.toFixed(1) + '%');
    // 同一色相下，暖而亮的天体把水洗提亮一点，冷暗的压低一点。
    root.style.setProperty('--at-dye-lift', (8.5 + tint * 1.0).toFixed(1) + '%');
  }

  /* --- 绘制星图 ------------------------------------------------------------
   * 投影是地平圈式平面星图：中心是天顶，圆周是地平线。指针位置换算成
   * （高度、方位）读出来 —— 这两件事在地平坐标系里是精确的，不需要星历。
   * -------------------------------------------------------------------- */
  function drawChart(animate) {
    var o = state.selected;
    var fig = FIGURES[o.fig];
    var box = el.frame.clientWidth || 460;
    var cx = box / 2;
    var cy = box / 2;
    var R = box / 2 - 14;

    var svg = el.svg;
    // viewBox 与像素 1:1：SVG 不被缩放，悬停读数和图共用同一套坐标系，
    // 不需要任何"从 viewBox 换算回 CSS 像素"的系数。
    svg.setAttribute('viewBox', '0 0 ' + box + ' ' + box);
    svg.setAttribute('width', box);
    svg.setAttribute('height', box);
    svg.textContent = '';

    el.frame.dataset.enter = animate ? 'true' : 'false';
    hideCross();

    /* --- 赤道坐标网 --- */
    var grid = svgAdd(svg, 'g', { class: 'at-g' });
    svgAdd(grid, 'circle', { class: 'at-g at-g--edge', cx: cx, cy: cy, r: R });
    // 赤纬纬圈：30° 与 60° 两道虚线圆。虚线而不是实线，是为了让地平圈
    // 和目标本身在视觉上排在前面。
    [30, 60].forEach(function (alt) {
      svgAdd(grid, 'circle', { class: 'at-g at-g--par', cx: cx, cy: cy, r: (R * alt) / 90 });
    });

    var spokes = svgAdd(svg, 'g', { class: 'at-g' });
    for (var k = 0; k < 12; k++) {
      // 从正北（上）起，每 30° 一根时圈。k=0 不画：它和图的正中轴重合。
      var a = (k * 30 - 90) * (Math.PI / 180);
      svgAdd(spokes, 'line', {
        class: 'at-spoke',
        x1: round2(cx + Math.cos(a) * 14), y1: round2(cy + Math.sin(a) * 14),
        x2: round2(cx + Math.cos(a) * R), y2: round2(cy + Math.sin(a) * R)
      });
    }

    // 高度刻度只标两道，且贴在正北方向上 —— 刻度贴在轴上才读得出"这是几度"。
    var labels = svgAdd(svg, 'g', {});
    [['30°', 30], ['60°', 60], ['90°', 90]].forEach(function (pair) {
      var r = (R * pair[1]) / 90;
      svgAdd(labels, 'text', {
        class: 'at-label', x: cx + 6, y: round2(cy - r + 3), 'text-anchor': 'start'
      }).textContent = pair[0];
    });
    svgAdd(labels, 'text', { class: 'at-label', x: cx, y: 12, 'text-anchor': 'middle' })
      .textContent = isZh() ? 'N' : 'N';

    /* --- 背景星场 --- */
    var field = svgAdd(svg, 'g', { class: 'at-field' });
    var rnd = mulberry32(o.fig.length * 7919 + o.index * 104729);
    for (var f = 0; f < FIELD_STARS; f++) {
      // 半径取平方根而不是均匀：均匀取样会把点堆在圆心，这是极坐标采样的
      // 标准修正。不做拒绝采样 —— 圆盘就是圆盘，超出部分本来就不画。
      var rad = Math.sqrt(rnd()) * R * 0.96;
      var ang = rnd() * Math.PI * 2;
      var st = svgAdd(field, 'circle', {
        class: 'at-star at-star--field',
        cx: round2(cx + Math.cos(ang) * rad),
        cy: round2(cy + Math.sin(ang) * rad),
        r: round2(starRadius(4.6 + rnd() * 2.8))
      });
      st.style.setProperty('--at-i', String(Math.min(f, 6)));
    }

    /* --- 星座连线与参考星 --- */
    // 0..100 的方格映射到以 R 为半径的圆。scale 取 R/50，方格半宽正好等于 R。
    var S = R / 50;
    function px(v) { return cx + (v - 50) * S; }
    function py(v) { return cy + (v - 50) * S; }

    var links = svgAdd(svg, 'g', { class: 'at-links' });
    fig.lines.forEach(function (pair, i) {
      var a = fig.stars[pair[0]];
      var b = fig.stars[pair[1]];
      var path = svgAdd(links, 'path', {
        class: 'at-link',
        d: 'M' + round2(px(a[0])) + ' ' + round2(py(a[1])) +
          'L' + round2(px(b[0])) + ' ' + round2(py(b[1]))
      });
      path.setAttribute('pathLength', '1'); // CSS 才能用 0..1 表达"画到哪儿了"
      path.style.setProperty('--at-j', String(Math.min(i, 8)));
    });

    var refs = svgAdd(svg, 'g', {});
    fig.stars.forEach(function (s, i) {
      svgAdd(refs, 'circle', {
        class: 'at-star',
        cx: round2(px(s[0])), cy: round2(py(s[1])),
        r: round2(starRadius(s[2]))
      }).style.setProperty('--at-i', String(Math.min(i, 6)));

      // 只给 2 等以上的亮星标名。给 4 等星也写名字，图会立刻变成一张表格。
      //
      // 被选中的那颗要跳过：它的名字已经由准星旁的 at-mark__name 写了一遍，而星座
      // 连线图上的锚星名是英文的（s[3]，画在 x+9）。两个标签落在同一个像素位置，
      // 屏幕上就出现「参宿四Betelgeuse」这种两个名字糊在一起的字。
      //
      // 这个 bug 只有看渲染截图才发现得了 —— 对比度、溢出、命中目标、色板全都通过。
      var isSelected = o.x === s[0] && o.y === s[1];
      if (s[2] <= 1.9 && s[3] && !isSelected) {
        var right = s[0] < 58;
        svgAdd(refs, 'text', {
          class: 'at-mark__name at-mark__name--en',
          x: round2(px(s[0]) + (right ? 9 : -9)),
          y: round2(py(s[1]) + 3),
          'text-anchor': right ? 'start' : 'end'
        }).textContent = s[3];
      }
    });

    /* --- 同星座的其它目标 --- */
    // 空心小点，弱到不抢，但一眼数得出这张图上有几个值得看的。
    var peers = svgAdd(svg, 'g', {});
    OBJECTS.forEach(function (p) {
      if (p.fig !== o.fig || p.id === o.id) return;
      svgAdd(peers, 'circle', {
        class: 'at-peer', cx: round2(px(p.x)), cy: round2(py(p.y)), r: 3
      }).style.setProperty('--at-i', '4');
    });

    /* --- 被选中的目标：准星本体（motif 在图上显形） --- */
    var mx = px(o.x);
    var my = py(o.y);
    // 位移与动画分成两层：CSS 的 transform 会**替换** transform 属性，
    // 两者写在同一个 <g> 上，入场缩放会把准星从 SVG 原点甩过来再留在那儿。
    // 外层只管位置，内层只管动效。
    var anchor = svgAdd(svg, 'g', {
      transform: 'translate(' + round2(mx) + ',' + round2(my) + ')'
    });
    var mark = svgAdd(anchor, 'g', { class: 'at-mark' });
    svgAdd(mark, 'circle', { class: 'at-mark__ring', r: 7 });
    // 四条短臂，而不是画一个完整的准星框：框会把星点盖住。
    [[-11, 0, -8, 0], [11, 0, 8, 0], [0, -11, 0, -8], [0, 11, 0, 8]].forEach(function (arm) {
      svgAdd(mark, 'line', {
        class: 'at-mark__arm', x1: arm[0], y1: arm[1], x2: arm[2], y2: arm[3]
      });
    });
    svgAdd(mark, 'circle', { class: 'at-mark__dot', r: 1.8 });

    var toRight = o.x < 58;
    svgAdd(mark, 'text', {
      class: 'at-mark__name',
      x: toRight ? 15 : -15,
      y: 4,
      'text-anchor': toRight ? 'start' : 'end'
    }).textContent = nameOf(o);

    /* --- 命中层与准星 --- */
    var cross = svgAdd(svg, 'g', { class: 'at-cross', 'data-on': 'false' });
    svgAdd(cross, 'line', { class: 'at-cross__rule', x1: cx, y1: 0, x2: cx, y2: box });
    svgAdd(cross, 'line', { class: 'at-cross__rule', x1: 0, y1: cy, x2: box, y2: cy });
    // 圆形命中层铺在最上面：pointermove 只落在这一个形状上，
    // 不必逐段判断"指针有没有出图"。
    svgAdd(svg, 'circle', { class: 'at-hit', cx: cx, cy: cy, r: R });

    geom = { box: box, cx: cx, cy: cy, r: R, cross: cross };
    svgRect = el.svg.getBoundingClientRect();

    // 图表不只是线和点：给它一句能读出来的摘要，role="img" 才有内容，
    // 读屏器才读得出一张图讲了什么。
    var vis = visibility(o.deg);
    svg.setAttribute('aria-label',
      nameOf(o) + ' · ' + t('field.constellation') + ' ' + figName(fig) +
      ' · ' + t('field.magnitude') + ' ' + fmtMag(o.mag) +
      ' · ' + t('vis.altitude', { v: fmtAlt(vis.alt) }) + ' / ' + t(vis.key));
  }

  /* --- 悬停准星 ------------------------------------------------------------
   * 整个 pointermove 只写属性和 transform。没有一次 getBoundingClientRect、
   * 没有一次 offsetWidth —— 热路径上任何一次读取都是一次强制同步重排。
   * -------------------------------------------------------------------- */
  function showCross(px, py) {
    if (!geom) return;
    var dx = px - geom.cx;
    var dy = py - geom.cy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var alt = Math.min(90, (dist / geom.r) * 90);
    // 方位角：正北朝上，顺时针为正。这是地平坐标系里的定义，
    // 不需要任何观测时刻 —— 也正因如此它才是诚实的读数。
    var az = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (az < 0) az += 360;

    geom.cross.setAttribute('data-on', 'true');
    geom.cross.querySelectorAll('.at-cross__rule').forEach(function (rule, i) {
      if (i === 0) { rule.setAttribute('x1', round2(px)); rule.setAttribute('x2', round2(px)); }
      else { rule.setAttribute('y1', round2(py)); rule.setAttribute('y2', round2(py)); }
    });

    el.readRa.textContent = t('alt.label') + ' ' + fmtInt.format(Math.round(alt)) + '°';
    el.readDec.textContent = t('az.label') + ' ' + fmtInt.format(Math.round(az)) + '°';
    el.read.hidden = false;
    // 只写 transform：left/top 是布局属性，写它们会让下一帧再排一次版。
    // 读数宽约 96px、贴着指针右下方，越界就翻到另一侧。
    var flip = px + 116 > geom.box;
    el.read.style.transform =
      'translate3d(' + Math.round(flip ? px - 104 : px + 10) + 'px,' +
      Math.round(Math.min(geom.box - 40, py + 10)) + 'px,0)';
  }

  function hideCross() {
    if (geom) geom.cross.setAttribute('data-on', 'false');
    el.read.hidden = true;
  }

  el.svg.addEventListener('pointerenter', function () {
    // 缓存矩形：热路径上一次都不读。
    svgRect = el.svg.getBoundingClientRect();
  });

  el.svg.addEventListener('pointermove', function (event) {
    if (!svgRect || !geom) return;
    showCross(event.clientX - svgRect.left, event.clientY - svgRect.top);
  });

  el.svg.addEventListener('pointerleave', hideCross);

  // 键盘可达。图表只能靠鼠标读数，对键盘用户等于不存在 —— 这是无障碍缺陷。
  el.frame.addEventListener('keydown', function (event) {
    if (!geom) return;
    var step = event.shiftKey ? 24 : 8;
    var pos = keyCursor || { x: geom.cx, y: geom.cy };
    var nx = pos.x;
    var ny = pos.y;
    if (event.key === 'ArrowRight') nx += step;
    else if (event.key === 'ArrowLeft') nx -= step;
    else if (event.key === 'ArrowUp') ny -= step;
    else if (event.key === 'ArrowDown') ny += step;
    else if (event.key === 'Home') { nx = geom.cx; ny = 12; }
    else if (event.key === 'End') { nx = geom.cx; ny = geom.box - 12; }
    else if (event.key === 'Escape') { hideCross(); keyCursor = null; return; }
    else return;
    event.preventDefault();
    keyCursor = {
      x: Math.max(0, Math.min(geom.box, nx)),
      y: Math.max(0, Math.min(geom.box, ny))
    };
    if (!svgRect) svgRect = el.svg.getBoundingClientRect();
    showCross(keyCursor.x, keyCursor.y);
  });

  el.frame.addEventListener('blur', hideCross);

  /* --- 渲染 --------------------------------------------------------------- */
  function visibleObjects() {
    return state.kind === 'all'
      ? OBJECTS
      : OBJECTS.filter(function (o) { return o.kind === state.kind; });
  }

  function makeReticle() {
    var r = document.createElement('span');
    r.className = 'at-reticle';
    r.setAttribute('aria-hidden', 'true');
    return r;
  }

  /* ponytail: 这个筛选下四类都非空（38 / 5 / 6 / 3），所以下面的空状态
   * 目前**走不到**。保留它是因为它是对的、也只有 6 行；但它是一次截图拍不
   * 到、也就没人 review 的分支 —— 真要让它可达，得再加一个维度（搜索或
   * 观测季 × 类型），那时把它一起做进去，不要单独为它造一条空数据。 */
  function renderList() {
    var rows = visibleObjects();
    el.list.replaceChildren();
    rows.forEach(function (o, i) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'at-row';
      btn.setAttribute('aria-current', String(o.id === state.selected.id));
      btn.style.setProperty('--at-i', String(Math.min(i, 7)));

      var name = document.createElement('span');
      name.className = 'at-row__name';
      name.textContent = nameOf(o);

      var mag = document.createElement('span');
      mag.className = 'at-row__mag';
      mag.textContent = fmtMag(o.mag);

      var desig = document.createElement('span');
      desig.className = 'at-row__desig';
      desig.textContent = o.d;

      btn.append(makeReticle(), name, mag, desig);
      btn.addEventListener('click', function () {
        if (state.selected.id === o.id) return;
        select(o, true);
      });
      li.appendChild(btn);
      el.list.appendChild(li);
    });

    el.empty.hidden = rows.length > 0;
    el.tally.textContent = t('catalog.count', { n: rows.length });
  }

  function makeChip(tone, label, mark) {
    var chip = document.createElement('span');
    chip.className = 'at-chip at-chip--' + tone;
    if (mark !== false) chip.appendChild(makeReticle());
    var text = document.createElement('span');
    text.textContent = label;
    chip.appendChild(text);
    return chip;
  }

  function dataCell(label, value, numeric) {
    var wrap = document.createElement('div');
    var dt = document.createElement('dt');
    dt.className = 'at-data__k';
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.className = 'at-data__v' + (numeric === false ? '' : ' at-data__v--num');
    dd.textContent = value;
    wrap.append(dt, dd);
    return wrap;
  }

  function renderPanel() {
    var o = state.selected;
    var fig = FIGURES[o.fig];
    var vis = visibility(o.deg);

    el.plateNo.textContent = t('plate.no') + ' ' + String(o.index + 1).padStart(2, '0');
    el.name.textContent = nameOf(o);
    el.captionMeta.textContent = o.d + ' · ' + figName(fig) + ' · ' + fmtMag(o.mag) + 'm';

    el.chips.replaceChildren(
      makeChip('info', t('type.' + o.kind), false),
      makeChip(vis.tone, t(vis.key)),
      makeChip('plain', t('season.' + o.season), false)
    );

    el.data.replaceChildren(
      dataCell(t('field.magnitude'), fmtMag(o.mag)),
      dataCell(t('field.distance'), fmtDistance(o.ly)),
      dataCell(t('field.spectral'), o.sp),
      dataCell(t('field.maxalt'), fmtSignedAlt(vis.alt)),
      dataCell(t('field.ra'), o.ra),
      dataCell(t('field.dec'), o.dec),
      dataCell(t('field.designation'), o.d, false),
      dataCell(t('field.constellation'), figName(fig), false)
    );

    el.note.textContent = isZh() ? o.note[0] : o.note[1];

    var logged = state.log.indexOf(o.id) >= 0;
    el.toggle.textContent = t(logged ? 'action.unlog' : 'action.log');
    el.toggle.setAttribute('aria-pressed', String(logged));
  }

  function renderLog() {
    el.logTally.textContent = t('log.count', { n: state.log.length });
    el.logList.replaceChildren();
    if (!state.log.length) {
      var empty = document.createElement('li');
      empty.className = 'at-log__empty';
      empty.textContent = t('log.empty');
      el.logList.appendChild(empty);
      return;
    }
    state.log.forEach(function (id, i) {
      var o = BY_ID[id];
      if (!o) return;
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'at-log__row';
      btn.setAttribute('aria-current', String(id === state.selected.id));
      btn.style.setProperty('--at-i', String(Math.min(i, 7)));

      var name = document.createElement('span');
      name.className = 'at-log__name';
      name.textContent = nameOf(o);
      var desig = document.createElement('span');
      desig.className = 'at-log__desig';
      desig.textContent = o.d;

      btn.append(makeReticle(), name, desig);
      btn.addEventListener('click', function () { select(o, false); });
      li.appendChild(btn);
      el.logList.appendChild(li);
    });
  }

  /* --- 选择 ----------------------------------------------------------------
   * 一次选择触发三件事：染色、图版重画、面板重绘。顺序是有讲究的 ——
   * 先染色，再画图，否则第一帧会先画出旧颜色的星再染一遍。
   * -------------------------------------------------------------------- */
  function select(o, scrollIntoView) {
    state.selected = o;
    dyeScene(o);
    drawChart(true);
    renderList();
    renderPanel();
    renderLog();
    if (scrollIntoView) {
      var row = el.list.querySelector('[aria-current="true"]');
      // 只在条目确实不在视口里时滚动：每点一下就把整列滚到顶，
      // 是那种"点着点着就烦了"的小动作。
      if (row && typeof row.scrollIntoView === 'function') {
        var r = row.getBoundingClientRect();
        var box = el.list.getBoundingClientRect();
        if (r.top < box.top || r.bottom > box.bottom) row.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  /* --- 筛选 ---------------------------------------------------------------- */
  Array.prototype.forEach.call(el.seg.children, function (btn) {
    btn.addEventListener('click', function () {
      if (btn.getAttribute('aria-pressed') === 'true') return;
      Array.prototype.forEach.call(el.seg.children, function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      state.kind = btn.dataset.kind;
      renderList();
      // 选中项被筛掉了就退到该筛选下的第一项，而不是留一个看不见的选中态。
      if (visibleObjects().every(function (o) { return o.id !== state.selected.id; })) {
        state.selected = visibleObjects()[0] || OBJECTS[0];
        dyeScene(state.selected);
        drawChart(true);
        renderPanel();
        renderLog();
      }
    });
  });

  /* --- 观测记录 ------------------------------------------------------------ */
  function persist() {
    return app.storage.set(STORAGE_KEY, state.log).catch(function (err) {
      // 唯一一次 error 语义色出场的理由：静默失败会让人以为已经存上了。
      toast(t('toast.storage'), 'bad');
      console.warn('[celestial-atlas] storage write failed:', err && err.message);
    });
  }

  el.toggle.addEventListener('click', function () {
    var id = state.selected.id;
    var at = state.log.indexOf(id);
    if (at >= 0) state.log.splice(at, 1);
    else state.log.unshift(id);
    renderPanel();
    renderLog();
    toast(t(at >= 0 ? 'toast.removed' : 'toast.added'));
    void persist();
  });

  /* --- Toast ---------------------------------------------------------------
   * 完整生命周期：进入 → 停留 → 退场 → 摘节点。
   * 退场靠打标记 + animationend，配一个定时兜底 —— 降级模式下动画被压到
   * 1ms 时事件仍会触发，但环境干脆禁了动画时就没有事件了。
   * -------------------------------------------------------------------- */
  var toastTimer = 0;

  function toast(message, tone) {
    var node = document.createElement('div');
    node.className = 'at-toast';
    if (tone) node.dataset.tone = tone;
    var text = document.createElement('span');
    text.textContent = message;
    node.append(makeReticle(), text);
    el.toasts.appendChild(node);

    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      node.dataset.leaving = 'true';
      var done = function () { node.remove(); };
      node.addEventListener('animationend', done, { once: true });
      // 降级模式下没有 animationend（或环境干脆禁了动画），定时兜底保证一定摘掉。
      window.setTimeout(done, 420);
    }, 2200);
  }

  /* --- 环境同步 ------------------------------------------------------------
   * 三个订阅，缺一不可：
   *   1. **host.ready**：ui.js 跑在 iframe 里，locale 与外观是宿主**之后**
   *      才发下来的。只在启动时读 app.locale 读到的是 runtime 的默认值
   *      'en-US'，界面会一半中文一半英文，而 onLocaleChange 对首次就绪
   *      不响。三个样例都在这里摔过。
   *   2. **onAppearanceChange**：color-scheme 不在契约里，必须显式写 ——
   *      它决定原生滚动条和表单控件的默认外观。
   *   3. **onLocaleChange**：不只是换字，文案与图表标注都要重算。
   * -------------------------------------------------------------------- */
  function syncScheme() {
    var mode = app.appearanceMode === 'light' || app.appearanceMode === 'dark'
      ? app.appearanceMode
      : null;
    if (!mode) return;
    document.documentElement.style.colorScheme = mode;
    // 导出成独立网页时没有宿主填槽位，靠这个属性挑一套 fallback。
    document.documentElement.dataset.appearance = mode;
  }

  function syncText() {
    document.documentElement.lang = app.locale || 'zh-CN';
    buildFormatters();
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (node) {
      node.textContent = t(node.dataset.i18n);
    });
    Array.prototype.forEach.call(el.seg.children, function (btn) {
      btn.textContent = t(btn.dataset.kind === 'all' ? 'filter.all' : 'type.' + btn.dataset.kind);
    });
    el.sub.textContent = t('app.subtitle', { n: OBJECTS.length });
    el.lat.textContent = t('app.latitude');
    el.frame.setAttribute('aria-label', t('plate.caption'));
  }

  function syncEnvironment(animate) {
    syncScheme();
    syncText();
    // 颜色全部走 --hamuna-*，主题切换本来就会自动跟随；这里仍然重画，
    // 是为了让"换主题后重新计算"成为显式契约 —— 一旦有人把颜色烘焙进内联
    // style 或者改用 canvas 绘制，这一行就是唯一的救命处。
    drawChart(animate);
    renderList();
    renderPanel();
    renderLog();
  }

  /* --- 响应式 --------------------------------------------------------------
   * 只在宽度真的变了时重画。守卫是必须的：draw() 自己也会写属性。
   * -------------------------------------------------------------------- */
  var lastWidth = 0;
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function () {
      var w = el.frame.clientWidth;
      if (Math.abs(w - lastWidth) < 1) return;
      lastWidth = w;
      // 不放入场动画，否则每拖一次窗口整张星图就重画一遍。
      drawChart(false);
    }).observe(el.frame);
  }

  /* --- 启动 ----------------------------------------------------------------
   * 不要写成顶层 `await`：宿主会把 <script src="ui.js"> 就地替换成裸的
   * script 元素（Rust inline_miniapp_siblings），**没有** type="module"，
   * 顶层 await 是 SyntaxError，整份文件一行都不执行，界面停在空壳上，
   * 而症状看起来只是"没有数据"。任何 await 都待在一个 async 函数内部。
   * -------------------------------------------------------------------- */
  buildFormatters();
  syncScheme();
  syncText();
  lastWidth = el.frame.clientWidth;
  dyeScene(state.selected);
  drawChart(true);
  renderList();
  renderPanel();
  renderLog();

  /* 首帧**不等** storage。
   *
   * 持久化的只是一个本地偏好（上次收藏了哪些）。让它挡在第一屏前面，等于
   * 把"界面什么时候出现"交给一次 IPC 往返 —— 而这个往返可能慢、可能失败、
   * 也可能永远不回来。所以先出图，读回来了再纠正一次。
   */
  app.storage.get(STORAGE_KEY)
    .then(function (saved) {
      if (!Array.isArray(saved)) return;
      state.log = saved.filter(function (id) { return BY_ID[id]; });
      renderLog();
      renderPanel();
      toast(t('toast.loaded'));
    })
    .catch(function (err) {
      // 读失败不阻塞首屏，但要留一句话，否则用户以为收藏是空的。
      toast(t('toast.storage'), 'bad');
      console.warn('[celestial-atlas] storage read failed:', err && err.message);
    });

  // 宿主就绪：locale / 外观到这里才第一次可信。
  app.on(function (event) {
    if (event && event.type === 'ready') syncEnvironment(false);
  });

  app.onAppearanceChange(function () {
    syncEnvironment(false);
  });

  app.onLocaleChange(function () {
    syncEnvironment(false);
  });
})();