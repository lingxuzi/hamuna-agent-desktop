/* 运营视图 · 四域内容（方向 D）
 *
 * 四个域共用同一副外壳：顶栏胶囊 / Hero 结论句 + 指标带 / 卡片网格 / 右栏深墨卡 + 要点。
 * 差别只在**内容与口径**，所以内容抽到这里，d.html 只留结构。
 *
 * 口径按域实配，不套用复盘的数字——这是把 D 铺到四域时唯一真正要重推的东西：
 *   选题看「待加工几条、来源是哪、先做哪条」——没有播放量
 *   素材看「在制几条、卡在哪」——还没有表现数据
 *   排期看「本周几条、哪天是空的」——还没有结果
 *   复盘才有播放 / 互动 / 完播
 * 四项指标照抄复盘会把另外三域做成假仪表盘：选题域根本没有播放量可读。
 *
 * 图标是单条 24×24 描边路径（一条 <path> 承载多段，用多个 M 连接），
 * 这样 x-for 里的图标不需要 SVG sprite——<template> 放进 <svg> 不是合法 SVG 内容。
 *
 * 所有数字、标题、账号名均为示意，未接入真实平台数据；
 * 界面里不出现「示例」「未接入」这类制作说明。
 */
window.opsData = function () {
  const I = {
    hot: 'M4 17l5-5 3 3 5-6M15 9h4v4',
    plus: 'M12 5v14M5 12h14',
    link: 'M10 14a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7L11 7.3M14 10a4 4 0 0 0-5.7 0L6 12.3a4 4 0 0 0 5.7 5.7L13 16.7',
    edit: 'M5 19h14M15 5l4 4-8.5 8.5-4.5 1 1-4.5z',
    download: 'M12 4v10M8 11l4 4 4-4M5 18h14',
    calendar: 'M5 6h14v13H5zM5 10h14M9 4v4M15 4v4',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    check: 'M5 12l5 5 9-10',
    clipboard: 'M5 5h14v15H5zM9 4h6v3H9zM9 12h6M9 16h4',
  };

  const DOMAINS = {
    选题: {
      lead:
        '<b><span class="num">6</span> 条选题待加工</b>，其中 <b><span class="num">3</span> 条来自热点</b>，' +
        '最该先做的是 <b class="who">出租屋灯光改造 · 第二期</b>。',
      metrics: [
        { dt: '待加工', dd: '6' },
        { dt: '已产素材', dd: '2' },
        { dt: '热点来源', dd: '3' },
      ],
      acts: [
        { k: 'hot', icon: I.hot, label: '拉取热点', busy: '拉取中…', msg: '已拉取 12 条热点' },
        { k: 'new', icon: I.plus, label: '手动加选题', busy: '保存中…', msg: '已加入选题池' },
        { k: 'bench', icon: I.link, label: '导入对标', busy: '解析中…', msg: '已导入 3 个对标账号' },
      ],
      pool: {
        title: '选题池',
        meta: '按优先级',
        cols: ['选题 · 角度', '热度'],
        items: [
          { ident: { v: '灯', p: 'xhs' }, title: '出租屋灯光改造 · 第二期', sub: '小红书 · 同角度上一篇跑到 8,412', n: '8.6万' },
          { ident: { v: '早', p: 'dy' }, title: '早八人的早餐 · 第三期', sub: '抖音 · 系列化，固定 8 点发', n: '6.2万' },
          { ident: { v: '收', p: 'xhs' }, title: '小户型收纳 · 避坑', sub: '小红书 · 评论区高频提问', n: '5.1万' },
          { ident: { v: '味', p: 'sph' }, title: '梅雨天家电除味 · 复刻', sub: '视频号 · 复盘回流，换平台重发', n: '3.4万' },
          { ident: { v: '通', p: 'xhs' }, title: '通勤穿搭 5 分钟', sub: '小红书 · 对标账号的爆款角度', n: '2.8万' },
          { ident: { v: '睡', p: 'xhs' }, title: '早睡挑战 · 3.0', sub: '小红书 · 手动加，等排期', n: '—' },
        ],
      },
      dist: {
        title: '来源分布',
        meta: '按条数',
        bars: [
          { name: '热点', val: '3', pct: 100 },
          { name: '对标', val: '1', pct: 33 },
          { name: '复盘回流', val: '1', pct: 33 },
          { name: '手动', val: '1', pct: 33 },
        ],
      },
      rail: {
        dark: { top: '最优先', when: '今天', big: '+8,412', name: '同角度上一篇的播放量', foot: '出租屋灯光改造 · 小红书' },
        notes: {
          title: '选题要点',
          meta: '4 条',
          items: [
            '热点类选题要在 48 小时内开工，过窗口就凉',
            '系列化选题固定发布时间，完播更稳',
            '评论区高频提问是最省力的选题来源',
            '复盘回流类换平台重发，成本最低',
          ],
        },
      },
    },

    素材: {
      lead:
        '<b><span class="num">2</span> 条素材在制作中</b>，<b><span class="num">1</span> 条今天该收尾</b>，' +
        '卡住的是 <b class="who">出租屋灯光改造</b>。',
      metrics: [
        { dt: '制作中', dd: '2' },
        { dt: '待排期', dd: '1' },
        { dt: '本周完成', dd: '3' },
      ],
      acts: [
        { k: 'from-topic', icon: I.plus, label: '从选题生成', busy: '生成中…', msg: '已生成素材草稿' },
        { k: 'draft', icon: I.edit, label: '新建素材', busy: '保存中…', msg: '已新建素材' },
        { k: 'import', icon: I.download, label: '导入稿件', busy: '导入中…', msg: '已导入 1 份稿件' },
      ],
      pool: {
        title: '制作中',
        meta: '按滞留时长',
        cols: ['素材 · 卡点', '完成度'],
        items: [
          { ident: { v: '灯', p: 'xhs' }, title: '出租屋灯光改造 · 第二期', sub: '小红书 · 卡在封面，正文已定稿', n: '80%' },
          { ident: { v: '早', p: 'dy' }, title: '早八人的早餐 · 第三期', sub: '抖音 · 分镜 2/4 已画', n: '45%' },
          { ident: { v: '味', p: 'sph' }, title: '梅雨天家电除味 · 复刻', sub: '视频号 · 已定稿，等排期', n: '100%' },
        ],
      },
      dist: {
        title: '状态分布',
        meta: '按条数',
        bars: [
          { name: '草稿', val: '2', pct: 100 },
          { name: '待排期', val: '1', pct: 50 },
          { name: '已排期', val: '2', pct: 100 },
          { name: '已发布', val: '12', pct: 100, mut: true },
        ],
      },
      rail: {
        dark: { top: '最该收尾', when: '已滞留 2 天', big: '1 条', name: '出租屋灯光改造 · 卡在封面', foot: '小红书 · 计划 11/18 发' },
        notes: {
          title: '制作要点',
          meta: '4 条',
          items: [
            '封面是唯一的卡点，标题写完就该定封面',
            '分镜超过 4 个的素材，先出 1 个再看数据',
            '定稿后 24 小时内必须排期，否则会沉底',
            '复刻类素材优先换平台，不要改内容',
          ],
        },
      },
    },

    排期: {
      lead:
        '<b>本周排了 <span class="num">4</span> 条</b>，<b><span class="num">1</span> 天还空着</b>，' +
        '下一条是 <b class="who">早八人的早餐 · 第三期</b>。',
      metrics: [
        { dt: '本周待发', dd: '4' },
        { dt: '待排期', dd: '1' },
        { dt: '空缺日', dd: '1' },
      ],
      acts: [
        { k: 'next', icon: I.calendar, label: '排下一条', busy: '排期中…', msg: '已排到 11/18 20:00' },
        { k: 'batch', icon: I.copy, label: '批量排期', busy: '排期中…', msg: '已排 3 条' },
        { k: 'sync', icon: I.check, label: '同步日历', busy: '同步中…', msg: '已同步到系统日历' },
      ],
      pool: {
        title: '本周',
        meta: '11/14 – 11/18',
        cols: ['时间 · 素材', '平台'],
        items: [
          { ident: { v: '11/14', w: '周六', date: true }, title: '早八人的早餐 · 第三期', sub: '08:00 · 抖音', n: '抖音' },
          { ident: { v: '11/16', w: '周一', date: true }, title: '还没排', sub: '从「素材」里挑一条补上', n: '空缺', empty: true },
          { ident: { v: '11/17', w: '周二', date: true }, title: '通勤穿搭 5 分钟', sub: '12:00 · 小红书', n: '小红书' },
          { ident: { v: '11/18', w: '周三', date: true }, title: '出租屋灯光改造 · 第二期', sub: '20:00 · 小红书', n: '小红书' },
        ],
      },
      dist: {
        title: '平台配额',
        meta: '本周 4 条',
        bars: [
          { name: '小红书', val: '2', pct: 100 },
          { name: '抖音', val: '1', pct: 50 },
          { name: '视频号', val: '1', pct: 50 },
          { name: '公众号', val: '0', pct: 0, mut: true },
        ],
      },
      rail: {
        dark: { top: '下一条', when: '明天 08:00', big: '11/14', name: '早八人的早餐 · 第三期', foot: '抖音 · 已定稿，定时发布' },
        notes: {
          title: '排期要点',
          meta: '4 条',
          items: [
            '抖音 08:00 发，小红书 20:00 发，两个平台差 12 小时',
            '同一素材跨平台要隔至少一天，避免互相压量',
            '周一空档优先补本周热度最高的那条',
            '视频号发布要预留 30 分钟上传时间',
          ],
        },
      },
    },

    复盘: {
      lead:
        '<b><span class="num">12</span> 条内容</b> 带来了 <b><span class="num">18.2<small>万</small></span> 次播放</b>，' +
        '表现最好的是 <b class="who">早八人的早餐</b>。',
      metrics: [
        { dt: '总播放', dd: '18.2', u: '万' },
        { dt: '总互动', dd: '1.6', u: '万' },
        { dt: '平均完播', dd: '33', u: '%' },
      ],
      acts: [
        { k: 'import', icon: I.download, label: '导入账号数据', busy: '导入中…', msg: '已导入 12 条内容的数据' },
        { k: 'manual', icon: I.edit, label: '录入数据', busy: '保存中…', msg: '已更新今日数据' },
        { k: 'paste', icon: I.clipboard, label: '粘贴表格', busy: '识别中…', msg: '已识别 12 行表格' },
      ],
      pool: {
        title: '表现最好的内容',
        meta: '近 15 天',
        cols: ['内容', '播放'],
        items: [
          { rank: '1', ident: { v: '早', p: 'dy' }, title: '早八人的早餐', sub: '抖音 · 完播 41% · 涨粉 62', n: '12,847' },
          { rank: '2', ident: { v: '租', p: 'xhs' }, title: '出租屋灯光改造', sub: '小红书 · 完播 36% · 涨粉 38', n: '8,412' },
          { rank: '3', ident: { v: '早', p: 'xhs' }, title: '早睡挑战 2.0', sub: '小红书 · 完播 33% · 涨粉 21', n: '6,930' },
          { rank: '4', ident: { v: '清', p: 'sph' }, title: '梅雨天的家电除味', sub: '视频号 · 完播 29% · 涨粉 19', n: '5,930' },
          { rank: '5', ident: { v: '三', p: 'xhs' }, title: '三种除味方案对比', sub: '小红书 · 完播 27% · 涨粉 14', n: '3,218' },
        ],
      },
      dist: {
        title: '平台分布',
        meta: '按播放',
        bars: [
          { name: '抖音', val: '80,000', pct: 100 },
          { name: '小红书', val: '68,000', pct: 85 },
          { name: '视频号', val: '29,000', pct: 36 },
          { name: '公众号', val: '5,000', pct: 7 },
        ],
      },
      rail: {
        dark: { top: '领跑优势', when: '近 15 天', big: '+4,435', name: '第 1 名领先第 2 名 53%', foot: '早八人的早餐 · 12,847 · 抖音' },
        notes: {
          title: '复盘要点',
          meta: '5 条',
          items: [
            '抖音贡献 44% 播放，是主战场',
            '完播率低于 30% 的内容占一半',
            '早 8 点发布的内容表现最好',
            '标题带数字的笔记点击率高出 1.8 倍',
            '小红书涨粉快但完播偏低，适合做引流',
          ],
        },
      },
    },
  };

  return {
    tab: new URLSearchParams(location.search).get('tab') || '复盘',
    busy: '',
    toast: '',
    rules: [],
    get d() {
      return DOMAINS[this.tab];
    },
    async run(kind, msg) {
      if (this.busy) return;
      this.busy = kind;
      await new Promise((r) => setTimeout(r, 900)); // 小样里替代真实请求
      this.busy = '';
      this.toast = msg;
      clearTimeout(this._t);
      this._t = setTimeout(() => (this.toast = ''), 2400);
    },
  };
};
