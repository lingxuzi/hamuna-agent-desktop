/* ============================================================================
 * Desk Booking — 行为层
 * ============================================================================
 *
 * 密集表单的行为层比清单复杂的地方全在**状态**上：一个字段同时有
 * 未触碰 / 已触碰 / 报错 / 通过 四态，提交按钮同时有 可按 / 校验失败 /
 * 提交中 / 已完成 四态，而键盘焦点、读屏播报、布局不跳版三条约束要在所有
 * 转移上都成立。下面这个文件把每条规矩写在它发生的地方。
 *
 *   1. 校验在**失焦时**跑，不在每次按键时跑。边打边报错是最容易写、也最
 *      招人烦的表单：打第一个字就被红框骂，用户还没写完就走开了。
 *   2. 失焦校验的结果会**粘住**：一旦报过错，在用户把这一格改对之前不再
 *      把它降级回"可选"。反过来，一个一直合规的字段不主动显示对勾 ——
 *      表单里八个大对勾比零个大对勾吵。
 *   3. 提交失败时把焦点搬到**第一个**无效控件上，并解释为什么。
 *   4. 确认性反馈走完整生命周期：进入 → 停留 → 退场 → 摘节点。
 *   5. 任何 await 宿主 API 的地方都有失败分支。静默吞掉是 MiniApp
 *      "看起来坏了"的头号原因。
 * ========================================================================= */
(function () {
  'use strict';

  /* --- i18n -----------------------------------------------------------------
   * meta.json::i18n 是**宿主侧**用来本地化应用名/描述的，ui.js 读不到它，
   * 所以应用内的文案表要在这里自己维护一份。app.t(table, fallback) 是运行时
   * 本地化的正确入口：它按 locale → en-US → zh-CN → 首值 → fallback 挑。
   *
   * 两份表必须同步。键名对不上时 app.t 会安静地返回 fallback，而 fallback
   * 常常也是空的 —— 于是界面上一块文字凭空消失，没有任何报错。
   * -------------------------------------------------------------------- */
  var I18N = {
    'app.title': { 'zh-CN': '工位预订', 'en-US': 'Desk Booking' },
    'app.subtitle': {
      'zh-CN': '三段式表单 · 失焦即校验 · 提交前不会离开这一屏',
      'en-US': 'Three sections · validates on blur · never leaves this screen'
    },
    'app.badge': { 'zh-CN': '外观 {0} · 语言 {1}', 'en-US': '{0} · {1}' },
    'section.who': { 'zh-CN': '谁', 'en-US': 'Who' },
    'section.when': { 'zh-CN': '何时', 'en-US': 'When' },
    'section.what': { 'zh-CN': '订什么', 'en-US': 'What' },
    'section.who.hint': {
      'zh-CN': '预订人信息只用于这次预订的通知。',
      'en-US': 'Contact details are used only to notify this booking.'
    },
    'section.when.hint': {
      'zh-CN': '同一天同一时段只能有一条有效预订。',
      'en-US': 'One live booking per desk per slot.'
    },
    'section.what.hint': {
      'zh-CN': '靠窗区优先留给整会议。',
      'en-US': 'Window desks go to group meetings first.'
    },
    'field.name': { 'zh-CN': '姓名', 'en-US': 'Name' },
    'field.purpose': { 'zh-CN': '用途说明', 'en-US': 'What for' },
    'field.email': { 'zh-CN': '通知邮箱', 'en-US': 'Email for confirmation' },
    'field.date': { 'zh-CN': '使用日期', 'en-US': 'Date' },
    'field.slot': { 'zh-CN': '时段', 'en-US': 'Slot' },
    'field.hours': { 'zh-CN': '时长', 'en-US': 'Duration' },
    'field.zone': { 'zh-CN': '区域', 'en-US': 'Zone' },
    'field.notes': { 'zh-CN': '备注', 'en-US': 'Notes' },
    'field.name.ph': { 'zh-CN': '张三', 'en-US': 'Alex Chen' },
    'field.purpose.ph': {
      'zh-CN': '两小时专注写代码，中途不需要电话',
      'en-US': 'Two focused hours; no calls needed'
    },
    'field.email.ph': {
      'zh-CN': '留空则不发送确认邮件',
      'en-US': 'Leave empty to skip the confirmation mail'
    },
    'field.date.ph': { 'zh-CN': 'YYYY-MM-DD', 'en-US': 'YYYY-MM-DD' },
    'field.notes.ph': {
      'zh-CN': '需要外接显示器或升降桌',
      'en-US': 'Needs a monitor or a sit-stand desk'
    },
    'mark.required': { 'zh-CN': '必填', 'en-US': 'required' },
    'mark.optional': { 'zh-CN': '选填', 'en-US': 'optional' },
    'slot.none': { 'zh-CN': '请选择时段', 'en-US': 'Pick a slot' },
    'slot.morning': { 'zh-CN': '上午 09:00–12:00', 'en-US': 'Morning 09:00–12:00' },
    'slot.afternoon': { 'zh-CN': '下午 13:00–18:00', 'en-US': 'Afternoon 13:00–18:00' },
    'slot.evening': { 'zh-CN': '晚间 18:00–22:00', 'en-US': 'Evening 18:00–22:00' },
    'hours.one': { 'zh-CN': '1 小时', 'en-US': '1 hour' },
    'hours.two': { 'zh-CN': '2 小时', 'en-US': '2 hours' },
    'hours.allday': { 'zh-CN': '全天', 'en-US': 'All day' },
    'zone.window': { 'zh-CN': '靠窗区', 'en-US': 'Window' },
    'zone.silent': { 'zh-CN': '静音区', 'en-US': 'Silent' },
    'zone.phone': { 'zh-CN': '电话间', 'en-US': 'Phone booth' },
    'counter': { 'zh-CN': '{0} / {1}', 'en-US': '{0} / {1}' },
    'counter.over': { 'zh-CN': '超出 {0} 字', 'en-US': '{0} over' },
    'error.required': { 'zh-CN': '{0}为必填项', 'en-US': '{0} is required' },
    'error.tooShort': {
      'zh-CN': '{0}至少需要 {1} 个字符，当前 {2} 个',
      'en-US': '{0} needs at least {1} characters, {2} so far'
    },
    'error.tooLong': {
      'zh-CN': '{0}最多 {1} 个字符，当前 {2} 个',
      'en-US': '{0} allows at most {1} characters, {2} so far'
    },
    'error.email': {
      'zh-CN': '邮箱格式不正确，需要 name@example.com',
      'en-US': 'That is not an email address; use name@example.com'
    },
    'error.dateFormat': { 'zh-CN': '日期格式为 YYYY-MM-DD', 'en-US': 'Use the YYYY-MM-DD format' },
    'error.datePast': { 'zh-CN': '不能选择今天之前的日期', 'en-US': 'Pick a date that is not in the past' },
    'error.pickOne': { 'zh-CN': '请选择一个{0}', 'en-US': 'Pick one {0}' },
    'error.rejected': {
      'zh-CN': '预订服务没有响应（演示用失败）',
      'en-US': 'The booking service did not accept the request (demo failure)'
    },
    'action.submit': { 'zh-CN': '提交预订', 'en-US': 'Book the desk' },
    'action.sending': { 'zh-CN': '正在提交', 'en-US': 'Submitting' },
    'action.retry': { 'zh-CN': '重试', 'en-US': 'Retry' },
    'action.again': { 'zh-CN': '再填一份', 'en-US': 'Book another' },
    'action.failNext': { 'zh-CN': '下一次提交失败', 'en-US': 'Make the next submit fail' },
    'reason.idle': {
      'zh-CN': '带「必填」的三项要先填。',
      'en-US': 'The three required fields are marked below.'
    },
    'reason.invalid': { 'zh-CN': '还有 {0} 处需要修正', 'en-US': '{0} field(s) still need attention' },
    'reason.sending': { 'zh-CN': '正在提交，请勿重复点击', 'en-US': 'Submitting — do not click again' },
    'reason.failed': {
      'zh-CN': '上次提交没有成功，可以点上方「重试」',
      'en-US': 'The last submit did not go through — use Retry above'
    },
    'reason.done': { 'zh-CN': '本次预订已提交', 'en-US': 'This booking has been submitted' },
    'banner.failed': { 'zh-CN': '提交失败：{0}', 'en-US': 'Submit failed: {0}' },
    'toast.saved': { 'zh-CN': '预订已提交', 'en-US': 'Booking submitted' },
    'receipt.title': { 'zh-CN': '预订已提交', 'en-US': 'Booking submitted' },
    'receipt.code': { 'zh-CN': '预订编号 {0}', 'en-US': 'Booking {0}' },
    'receipt.again': { 'zh-CN': '再填一份', 'en-US': 'Book another' }
  };

  /**
   * 取一条文案并做 {0} 替换。
   *
   * 兜底走 zh-CN：即使宿主给了一个本表没覆盖的 locale（运行时默认是 en-US，
   * 而本表一定覆盖它），也不要显示空字符串 —— 一块凭空消失的文字比一句
   * 英文更难排查。
   */
  function t(key, vars) {
    var table = I18N[key] || {};
    var out = app.t(table, table['zh-CN'] || key);
    if (!vars) return out;
    Object.keys(vars).forEach(function (k) {
      out = out.split('{' + k + '}').join(vars[k]);
    });
    return out;
  }

  /* --- 字段定义与校验 -------------------------------------------------------
   * 校验规则集中在这里，而不是散在八个 blur 回调里：规则是**数据**，
   * 渲染才是代码。换成后端校验时，这一整块换成一次 fetch，渲染层不动。
   * -------------------------------------------------------------------- */

  /** 宽松的邮箱判定。RFC 5322 的完整正则没人读得懂，也没人维护得起；
   *  目标是抓住手滑（少了 @、少了域名），不是做地址簿。 */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** 严格的 YYYY-MM-DD：先匹配形状，再确认这个日期真的存在。
   *  少了第二步的话 2026-02-31 会通过校验，然后在提交时被后端拒绝 ——
   *  能在表单里当场说出来的错误，不该留到提交之后。 */
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    var y = +m[1];
    var mo = +m[2];
    var d = +m[3];
    var dt = new Date(y, mo - 1, d);
    // Date 会把 2 月 31 日进位成 3 月 3 日；比对各分量才能识破。
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  /** 校验器只返回 {code, vars}，文案由 UI 层翻译。 */
  var FIELDS = {
    name: {
      label: 'field.name',
      required: true,
      min: 2,
      max: 24,
      check: function (v) {
        var n = v.trim().length;
        if (!n) return { code: 'required' };
        if (n < this.min) return { code: 'tooShort', vars: { 1: this.min, 2: n } };
        if (n > this.max) return { code: 'tooLong', vars: { 1: this.max, 2: n } };
        return null;
      }
    },
    purpose: {
      label: 'field.purpose',
      required: true,
      min: 10,
      // 软上限：超了报 error.tooLong 而不是静默截断，见 index.html 里的说明。
      max: 80,
      counter: true,
      check: function (v) {
        var n = v.trim().length;
        if (!n) return { code: 'required' };
        if (n < this.min) return { code: 'tooShort', vars: { 1: this.min, 2: n } };
        if (n > this.max) return { code: 'tooLong', vars: { 1: this.max, 2: n } };
        return null;
      }
    },
    email: {
      label: 'field.email',
      // 选填：一个用户能表达"留空"的字段，就不该有 required 语义 ——
      // 读屏器会一直念"必填"，而它并不必填。
      required: false,
      // 选填字段的校验只在有内容时跑。空值不是错误，是用户的选择。
      check: function (v) {
        if (!v.trim()) return null;
        if (!EMAIL_RE.test(v.trim())) return { code: 'email' };
        return null;
      }
    },
    date: {
      label: 'field.date',
      required: true,
      check: function (v) {
        var dt = parseDate(v);
        if (!dt) return { code: 'dateFormat' };
        // 用本地零点比较，不用 toISOString()：后者按 UTC 切日，
        // 东八区会把"今天"算成昨天。
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        if (dt.getTime() < today.getTime()) return { code: 'datePast' };
        return null;
      }
    },
    slot: {
      label: 'field.slot',
      required: true,
      check: function (v) {
        if (!v) return { code: 'required' };
        return null;
      }
    },
    hours: {
      label: 'field.hours',
      required: true,
      // 单选组的空值是"整个组一个都没选"，和 required 的表达方式不同。
      check: function (v) {
        if (!v) return { code: 'pickOne' };
        return null;
      }
    },
    zone: {
      label: 'field.zone',
      required: true,
      check: function (v) {
        if (!v) return { code: 'pickOne' };
        return null;
      }
    },
    notes: {
      label: 'field.notes',
      required: false,
      max: 60,
      counter: true,
      check: function (v) {
        if (v.length > this.max) return { code: 'tooLong', vars: { 1: this.max, 2: v.length } };
        return null;
      }
    }
  };

  var ORDER = ['name', 'purpose', 'email', 'date', 'slot', 'hours', 'zone', 'notes'];

  /* --- DOM ---------------------------------------------------------------- */
  var el = {
    form: document.getElementById('fd-form'),
    badge: document.getElementById('fd-badge'),
    banner: document.getElementById('fd-banner'),
    bannerText: document.getElementById('fd-banner-text'),
    retry: document.getElementById('fd-retry'),
    failNext: document.getElementById('fd-failnext'),
    submit: document.getElementById('fd-submit'),
    submitLabel: document.getElementById('fd-submit-label'),
    reason: document.getElementById('fd-reason'),
    receipt: document.getElementById('fd-receipt'),
    receiptCode: document.getElementById('fd-receipt-code'),
    receiptList: document.getElementById('fd-receipt-list'),
    again: document.getElementById('fd-again'),
    toastHost: document.getElementById('fd-toast-host')
  };

  /** 每个字段的运行时状态。touched 是失焦粘住错误的关键。 */
  var state = {};
  ORDER.forEach(function (key) {
    state[key] = { touched: false, error: null };
  });

  var phase = 'idle'; // idle | invalid | sending | done
  var failNext = false;
  var lastDraft = null;
  var lastError = null;   // 存错误**码**，不存句子：换语言时要重译
  var lastResult = null;  // 提交成功的结果，换语言时重绘回执要用

  function fieldNodes(key) {
    var root = document.querySelector('[data-field="' + key + '"]');
    return {
      root: root,
      msg: root.querySelector('.fd-msg'),
      counter: root.querySelector('.fd-counter'),
      // 单选组没有单一控件，取第一个：焦点只能落一个地方。
      control: root.querySelector('input, select, textarea')
    };
  }

  function controlValue(key) {
    var root = document.querySelector('[data-field="' + key + '"]');
    if (!root) return '';
    // 单选组先判"这个字段里有没有 radio"。**顺序很重要**：直接往下取
    // querySelector('input') 的话，空组会取到第一个 radio，而它的 .value
    // 是 'one' —— 于是"一个都没选"被读成"选了第一项"，这个字段永远校验通过。
    // 这种 bug 在界面上完全看不出来（红框不亮），只能靠"提交前把六个必填项
    // 一个个点一遍"发现。组内一个都没选时明确返回 ''。
    var radios = root.querySelectorAll('input[type="radio"]');
    if (radios.length) {
      var checked = root.querySelector('input[type="radio"]:checked');
      return checked ? checked.value : '';
    }
    var control = root.querySelector('select, textarea, input');
    return control ? control.value : '';
  }

  /* --- 错误文案 ------------------------------------------------------------- */

  /** 把 {code, vars} 翻成一句话。字段名通过 {0} 注入，于是错误模板只需要一套。 */
  function message(key, bad) {
    if (!bad) return '';
    var vars = bad.vars || {};
    var args = { 0: t(FIELDS[key].label) };
    Object.keys(vars).forEach(function (k) {
      args[k] = vars[k];
    });
    return t('error.' + bad.code, args);
  }

  /* --- 单字段渲染 ----------------------------------------------------------- */

  /**
   * 重画字符计数。计数和错误必须同时更新 —— 计数器只反映长度，超限的判定
   * 来自 validateField，两者由同一个 max 推导，所以永远不会互相矛盾。
   */
  function paintCounter(key) {
    var nodes = fieldNodes(key);
    if (!nodes.counter) return;
    var spec = FIELDS[key];
    var n = controlValue(key).length;
    nodes.counter.dataset.over = String(n > spec.max);
    nodes.counter.textContent = n > spec.max
      ? t('counter.over', { 0: String(n - spec.max) })
      : t('counter', { 0: String(n), 1: String(spec.max) });
  }

  /**
   * 把一个字段的状态写回 DOM。三条不变量：
   *   - 说明行**永远存在**，只是内容变不变（style.css 给它留了 18px）。
   *     错误出现时页面不重排，用户的眼睛和正在点的按钮都不会跑。
   *   - aria-invalid / aria-describedby / 文字三样必须同步。只改其中一样，
   *     读屏器和视觉用户就会拿到互相矛盾的状态。
   *   - 没触碰过的字段不显示"通过"。八个一直亮着的大对勾比零个更吵。
   */
  function paintField(key) {
    var nodes = fieldNodes(key);
    var st = state[key];
    var text = message(key, st.error);

    nodes.msg.textContent = text;
    if (st.error) nodes.msg.dataset.state = 'error';
    else if (st.touched && controlValue(key).trim()) nodes.msg.dataset.state = 'ok';
    else nodes.msg.removeAttribute('data-state');

    // 单选组里每一个 input 都要带上同一个状态：焦点可能停在组内任意一个上，
    // 只改 checked 的那一个会让读屏器念到"这一项没标无效"。
    var radios = nodes.root.querySelectorAll('input[type="radio"]');
    if (radios.length) {
      Array.prototype.forEach.call(radios, function (radio) {
        radio.setAttribute('aria-invalid', st.error ? 'true' : 'false');
      });
    } else if (nodes.control) {
      nodes.control.setAttribute('aria-invalid', st.error ? 'true' : 'false');
    }

    paintCounter(key);
  }

  function validateField(key) {
    var bad = FIELDS[key].check(controlValue(key));
    // 粘住：报过错之后，字段变空了也不能立刻把错误收回去 —— 用户会以为
    // 问题已经解决，然后带着一份残缺的表单去提交。只有"变合规"才降级。
    state[key].error = state[key].touched || bad ? bad : null;
    paintField(key);
    return !state[key].error;
  }

  function firstInvalid() {
    for (var i = 0; i < ORDER.length; i++) {
      if (state[ORDER[i]].error) return ORDER[i];
    }
    return null;
  }

  function invalidCount() {
    return ORDER.filter(function (key) {
      return !!state[key].error;
    }).length;
  }

  /* --- 提交按钮与底栏理由 ---------------------------------------------------
   * 禁用而不说理由，等于把"为什么"推给用户猜。这里 reason 永远有一句话，
   * 并且它挂在按钮的 aria-describedby 上：按钮被禁用时读屏器读不到它，
   * 所以这句"为什么"是专门为它准备的。
   * -------------------------------------------------------------------- */
  function paintFooter() {
    var n = invalidCount();

    if (phase === 'sending') {
      el.submit.disabled = true;
      el.submit.dataset.phase = 'sending';
      el.submitLabel.textContent = t('action.sending');
      setReason(t('reason.sending'), 'normal');
    } else if (phase === 'done') {
      el.submit.disabled = true;
      el.submit.removeAttribute('data-phase');
      el.submitLabel.textContent = t('action.submit');
      setReason(t('reason.done'), 'normal');
    } else {
      el.submit.disabled = false;
      el.submit.removeAttribute('data-phase');
      el.submitLabel.textContent = t('action.submit');
      // 校验没过时按钮**不禁用**：禁用了用户就没法再点一次来触发校验，
      // 只能看到一句"还有 3 处"却不知道在哪。给理由 + 让焦点带路（见 submit）。
      // 刚失败过一次时优先说失败 —— 这时候还报"带必填的三项要先填"，
      // 用户会以为是自己填错了，而表单其实是好的。
      if (lastError) setReason(t('reason.failed'), 'warn');
      else if (n) setReason(t('reason.invalid', { 0: String(n) }), 'warn');
      else setReason(t('reason.idle'), 'normal');
    }
  }

  function setReason(text, tone) {
    el.reason.textContent = text;
    if (tone === 'warn') el.reason.dataset.tone = 'warn';
    else el.reason.removeAttribute('data-tone');
  }

  /* --- 异步提交 -------------------------------------------------------------
   * mockSubmit 是这个样例里唯一该被替换掉的东西。真接后端时换成你的
   * app.net.fetch / app.storage.set，并且**保留失败分支**。
   * -------------------------------------------------------------------- */
  function mockSubmit(draft) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (failNext) {
          failNext = false;
          paintFailNext();
          reject(new Error('E_DEMO_REJECTED'));
          return;
        }
        resolve({ id: draft.date.replace(/-/g, '') + '-' + draft.slot });
      }, 900);
    });
  }

  function draft() {
    var out = {};
    ORDER.forEach(function (key) {
      out[key] = controlValue(key).trim();
    });
    return out;
  }

  /* --- 焦点管理 -------------------------------------------------------------
   * 提交失败后把焦点搬到第一个无效控件上，不是搬到底栏，也不是不动。
   *
   * 为什么非搬不可：
   *   - 键盘用户按完 Enter，焦点还留在提交按钮上。他们不知道该往哪 Tab；
   *     底栏在 sticky 位置，第一个出错的字段可能在一屏之外。让他们自己
   *     找，等于要求每个人都知道错误在 DOM 里的先后顺序。
   *   - 读屏用户听到的是"提交失败"和几条错误文字，但焦点没动，于是下一句
   *     仍从提交按钮往下念。屏幕阅读器用户的工作模型是"焦点即我在这里"，
   *     焦点不跟错误走，他们就会以为表单已经填完了。
   *   - 滚动同理：focus() 自带"滚进视口"，不搬焦点的话用户还得自己找
   *     到那个红框。
   * 注意 focus() 而不是 scrollIntoView()：后者只动视口不动焦点，
   * 键盘 Tab 序列仍然停在提交按钮上 —— 那是最容易写出来的半截修法。
   * -------------------------------------------------------------------- */
  function focusFirstInvalid() {
    var key = firstInvalid();
    if (!key) return;
    var nodes = fieldNodes(key);
    if (nodes.control) nodes.control.focus();
  }

  /* --- 提交 ----------------------------------------------------------------- */

  function onSubmit(event) {
    event.preventDefault();
    if (phase === 'sending' || phase === 'done') return;

    hideBanner();

    // 全量校验前先标记 touched：只有失焦过的字段才被"粘住"，
    // 直接点提交时所有字段都还没失焦过，不标记的话错误会在改完一个之后
    // 集体消失，用户以为修好了其实没提交。
    var bad = null;
    ORDER.forEach(function (key) {
      state[key].touched = true;
      if (!validateField(key) && !bad) bad = key;
    });

    if (bad) {
      phase = 'invalid';
      paintFooter();
      focusFirstInvalid();
      return;
    }

    lastDraft = draft();
    runSubmit(lastDraft);
  }

  function runSubmit(d) {
    phase = 'sending';
    paintFooter();

    mockSubmit(d).then(
      function (result) {
        phase = 'done';
        showReceipt(d, result);
        paintFooter();
        showToast(t('toast.saved'));
      },
      function () {
        // 失败路径同样是设计：横幅 + 重试按钮，而不是只把按钮放开让用户
        // 再点一次猜。"再点一次会不会好"不是界面该让用户回答的问题。
        phase = 'invalid';
        showBanner('error.rejected');
        paintFooter();
        // 焦点搬过去：读屏用户要知道刚才那次提交没成，重试按钮在视口底部，
        // 而他们多半正停在提交按钮上。横幅是 role="alert" 会自己播报，
        // 焦点负责的是"下一步按哪里" —— 播报和焦点管的是两件事。
        el.retry.focus();
      }
    );
  }

  /* --- 横幅与回执 ----------------------------------------------------------- */

  function showBanner(code) {
    lastError = code;
    el.bannerText.textContent = t('banner.failed', { 0: t(code) });
    el.banner.hidden = false;
  }

  function hideBanner() {
    lastError = null;
    el.banner.hidden = true;
  }

  function showReceipt(d, result) {
    lastResult = result;
    el.receiptCode.textContent = t('receipt.code', { 0: result.id });

    var rows = [
      ['name', d.name],
      ['date', formatDate(d.date)],
      ['slot', t('slot.' + d.slot)],
      ['hours', t('hours.' + d.hours)],
      ['zone', t('zone.' + d.zone)]
    ];
    el.receiptList.textContent = '';
    rows.forEach(function (pair) {
      var dt = document.createElement('dt');
      dt.textContent = t('field.' + pair[0]);
      var dd = document.createElement('dd');
      dd.textContent = pair[1] || '—';
      el.receiptList.append(dt, dd);
    });

    el.form.hidden = true;
    el.receipt.hidden = false;
    // 焦点搬到回执标题：表单整块被换掉了，焦点还留在已经 hidden 的提交按钮上，
    // 键盘用户会掉进 void。标题带 tabindex="-1" 才是可编程聚焦的，
    // 没有它 focus() 是空操作 —— 那正是"看起来写了焦点管理其实没生效"的
    // 最常见的一种。
    document.getElementById('fd-receipt-title').focus();
  }

  function resetAll() {
    el.form.reset();
    ORDER.forEach(function (key) {
      state[key] = { touched: false, error: null };
      paintField(key);
    });
    phase = 'idle';
    lastDraft = null;
    lastError = null;
    lastResult = null;
    hideBanner();
    el.form.hidden = false;
    el.receipt.hidden = true;
    paintFooter();
    document.getElementById('fd-name').focus();
  }

  /** 日期跟着语言走：2026-10-14 和 14/10/2026 哪个对，取决于读者。 */
  function formatDate(iso) {
    var dt = parseDate(iso);
    if (!dt) return iso;
    return new Intl.DateTimeFormat(app.locale || 'zh-CN', { dateStyle: 'medium' }).format(dt);
  }

  /* --- Toast ----------------------------------------------------------------
   * 确认性反馈的完整生命周期：进入 → 停留 → 退场 → 摘节点。
   * 只做进入不做退场是最常见的半成品动效。
   *
   * 摘节点用 animationend + 定时兜底两条路：降级模式下 animation-duration
   * 被压到 1ms，事件仍会来，但**无动画**的环境里（比如用户开了
   * "减少动态效果"之外的某些 WebView 组合）它可能根本不来，所以定时器
   * 兜底。finish 幂等 —— 两条路都跑也只摘一次。
   * -------------------------------------------------------------------- */
  var toastTimer = 0;

  function showToast(message) {
    var node = document.createElement('div');
    node.className = 'fd-toast';
    node.textContent = message;
    el.toastHost.appendChild(node);

    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      node.dataset.leaving = 'true';
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        node.remove();
      };
      node.addEventListener('animationend', finish, { once: true });
      // 与 --fd-dur (200ms) 对齐 + 余量。写在这里是因为定时器兜底的量级
      // 必须大于动画时长，写小了会在动画播完前就摘掉节点 —— 视觉上就是
      // toast 闪一下断掉。真正的时长仍然只存在于 CSS 里。
      setTimeout(finish, 320);
    }, 1800);
  }

  /* --- 演示开关 ------------------------------------------------------------- */

  function paintFailNext() {
    el.failNext.setAttribute('aria-checked', String(failNext));
  }

  /* --- 环境同步 ------------------------------------------------------------
   * 拆成三步，每步只干一件事：换语言不需要重建 DOM，
   * 换外观不需要重排版。
   * -------------------------------------------------------------------- */
  function syncText() {
    document.documentElement.lang = app.locale || 'zh-CN';

    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (node) {
      node.textContent = t(node.dataset.i18n);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-placeholder]'), function (node) {
      node.placeholder = t(node.dataset.i18nPlaceholder);
    });

    // 换语言会改写每一条错误文案、每一条计数器、底栏的理由和回执，
    // 所以要全量重绘 —— 否则用户在 en-US 下看到的还是刚才那几条中文。
    ORDER.forEach(paintField);
    if (lastError) el.bannerText.textContent = t('banner.failed', { 0: t(lastError) });
    if (lastResult && !el.receipt.hidden) showReceipt(lastDraft, lastResult);
    paintFooter();
  }

  /** color-scheme 不在契约里，必须显式写 —— 它决定原生滚动条和表单控件的
   *  默认外观，不设的话深色主题下会出现一条亮色滚动条。 */
  function syncScheme() {
    var mode = app.appearanceMode === 'light' || app.appearanceMode === 'dark'
      ? app.appearanceMode
      : null;
    if (mode) document.documentElement.style.colorScheme = mode;
    if (el.badge) {
      // 徽章写原始值，不走 t()：它显示的是环境本身（"light · zh-CN"）而不是
      // 一句文案，翻译它反而说不清楚。aria-label 才是给人听的那一份。
      var mode2 = mode || 'auto';
      var loc = app.locale || 'zh-CN';
      el.badge.textContent = mode2 + ' · ' + loc;
      el.badge.setAttribute('aria-label', t('app.badge', { 0: mode2, 1: loc }));
    }
  }

  function syncEnvironment() {
    syncScheme();
    syncText();
  }

  /* --- 绑定 ----------------------------------------------------------------- */

  ORDER.forEach(function (key) {
    var root = document.querySelector('[data-field="' + key + '"]');
    var controls = root.querySelectorAll('input, select, textarea');

    Array.prototype.forEach.call(controls, function (control) {
      // 失焦才校验。见文件头第 1 条：边打边骂是最招人烦的表单。
      control.addEventListener('blur', function () {
        state[key].touched = true;
        validateField(key);
        paintFooter();
      });
      // 已经报过错的字段，边改边重算 —— 用户正在修它，每敲一个字都等
      // 到失焦才告诉他修好了，体感是"我改了但界面没反应"。
      // 计数器和超限提示是长度驱动的，每次按键都要更新，和错误无关。
      control.addEventListener('input', function () {
        paintCounter(key);
        if (state[key].error) validateField(key);
      });
      // change 是"用户做了一个离散选择"（选了时段、点了某个 chip）。
      // 那就是一次明确的触碰，直接标 touched —— 不然刚选完的项在读屏器里
      // 仍是一个未触碰的控件。
      control.addEventListener('change', function () {
        state[key].touched = true;
        validateField(key);
        paintFooter();
      });
    });
  });

  el.form.addEventListener('submit', onSubmit);

  el.retry.addEventListener('click', function () {
    if (!lastDraft) return;
    hideBanner();
    runSubmit(lastDraft);
  });

  el.again.addEventListener('click', resetAll);

  el.failNext.addEventListener('click', function () {
    failNext = !failNext;
    paintFailNext();
  });

  /* --- 启动 -----------------------------------------------------------------
   * 第一帧**不等**任何东西：默认状态立刻画出来。
   *
   * 这个样例里其实没有必须先读本地存储的东西（表单就是空的），但同样的
   * 规矩适用：storage 是信任边界，慢、失败、或者永远不回来都可能。让它挡在
   * 第一屏前面，等于把"界面什么时候出现"交给一次 IPC 往返。缓存该有的语义
   * 是"改变初始呈现"，不是"决定何时呈现"。
   *
   * 顺便：不要写成顶层 `await`。宿主会把 <script src="ui.js"> 就地替换成裸的
   * script 元素（Rust inline_miniapp_siblings），**没有** type="module"，
   * 整份文件按 classic script 解析，顶层 await 是 SyntaxError —— 于是这里一行
   * 都不执行，界面停在空壳上，症状却只是"没有数据"。
   * -------------------------------------------------------------------- */
  ORDER.forEach(paintField);
  paintFailNext();
  syncEnvironment();
  paintFooter();

  // 两个必须显式订阅的时机：
  //   1. **ready**：ui.js 跑在 iframe 里，宿主是**之后**才把 locale / 外观
  //      发下来的。只在启动时读一次 app.appearanceMode 读到的是 runtime 的
  //      内置默认值，不是宿主的真实外观 —— 而 host.ready **不发** appearance
  //      事件（它只 emit('event', {type:'ready'})），于是不订这一条，
  //      浅色宿主里 color-scheme 会一直是错的。
  //   2. onAppearanceChange / onLocaleChange：会话中途真的会变。
  app.on(function (event) {
    if (event && event.type === 'ready') syncEnvironment();
  });

  // 陷阱：onAppearanceChange 的回调收到的是**整个事件对象**
  // （{ type: 'theme.change', appearanceMode: 'light' }），不是裸的 mode 字符串。
  // 直接 app.onAppearanceChange((mode) => set(mode)) 会把 "[object Object]"
  // 写进 color-scheme。宿主在 emit 之前已经先更新了 app.appearanceMode
  // （见 appRuntimeScript 的 applyEnv → emit 顺序），所以**读 getter**。
  app.onAppearanceChange(function () {
    syncEnvironment();
  });

  app.onLocaleChange(function () {
    syncEnvironment();
  });

  // ponytail: 日期校验用"今天"做下界，且接受用户从任意年份填起，没有做
  // "可预订区间"（比如未来 90 天）那套。区间需要一份真的排期数据源，
  // 现在是 fixture，接真数据时把 parseDate 之后那一句换成区间检查即可。
})();
