"""Orchestrator / 子代理 helper 函数 (v2 — akquant 对齐, 降级路径)。

落点选 `references/_helpers.py` 而非 `strategy_cli/` 下 —— 保持 strategy_cli 黑盒纪律
(SKILL.md §"strategy_cli 是黑盒")。helpers 是主 agent / 子代理 spawn 时的 stdlib 工具,
不属 CLI 内部实现。

v2 提供的 helper (对应 evolver / evolver-research / orchestrator 运行时依赖):
  - objective_met(core_metrics, objective):  阈值向量逐项比对 (NaN → False) — evolver 判退出条件③
  - suggest_next_directions(...):            死方向时推荐替代方向 ID — evolver exit 时调 (v2 降级版)
  - verify_issue(prev_issues, source):       上轮 issue.trigger 在源码仍命中 → 未闭环 — orchestrator 循环轮 gate

**与 v1 的差异** (v2 降级, 刻意不抄 v1 的 STRAT-HIST / MARKET-SCAN):
  - 无 STRAT-HIST: historical_summary 默认 None, 硬排除/软降权跳过
  - 无 MARKET-SCAN: 不引入 _DIRECTION_MARKET_AFFINITY / _market_signal_match (v2 无 fetcher)
  - **不依赖 v1 skill** — 本文件消除 v2 evolver 对 skills/hamuna-strategy 的隐式运行时依赖
    (此前 `from references._helpers import ...` 靠 PYTHONPATH 里 v1 在前兜底)

每个函数自带 __main__ 块跑 self-check (断言); 不引入 pytest。
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path


def _resolve_root() -> Path:
    """策略产物根 = <root>/<stem>/ (Agent workspace 目录下, 非用户 home)。

    解析顺序 (与 v1 一致):
      1) env HAMUNA_STRATEGIES_ROOT — 直接给 root (完整路径, 不 append)
      2) env HAMUNA_STRATEGIES_WORKSPACE — workspace 目录, 自动 append /hamuna-strategies
      3) 默认 Path.cwd()/hamuna-strategies — Agent 启动目录 = 项目根
    """
    if r := os.environ.get('HAMUNA_STRATEGIES_ROOT'):
        return Path(r)
    ws = os.environ.get('HAMUNA_STRATEGIES_WORKSPACE') or str(Path.cwd())
    return Path(ws) / 'hamuna-strategies'


def _strategy_dir(stem: str) -> Path:
    """返回 <root>/<stem>/ 路径, 父目录与 <stem>/ 都自动建; 已存在 → 复用 (同策略续跑)。"""
    _resolve_root().mkdir(parents=True, exist_ok=True)
    d = _resolve_root() / stem
    d.mkdir(exist_ok=True)
    return d


# ---------- objective_met (evolver 退出条件③) ----------
def objective_met(core_metrics: dict, objective: dict[str, str]) -> bool:
    """逐项阈值比对 (pipeline.md §2.1 末尾)。

    命中规则: value <op> threshold。
    遇到 NaN / None / 不在 core_metrics → 该项不命中 → 整体 False。
    空 objective {} → False (避免"无目标 = 自动达标"陷阱)。
    未识别 op → 抛 ValueError (designer 必填已知 op 之一)。
    """
    if not objective:
        return False
    for metric, expr in objective.items():
        if metric not in core_metrics:
            return False
        v = core_metrics[metric]
        if v is None or (isinstance(v, float) and v != v):  # NaN
            return False
        op, val = _parse_op(expr)
        if not _compare(v, op, val):
            return False
    return True


def _parse_op(expr: str) -> tuple[str, float]:
    """'>=1.5' / '<0.15' / '==0.5' → (op, value)。"""
    s = expr.strip()
    for op in ('>=', '<=', '==', '>', '<'):
        if s.startswith(op):
            return op, float(s[len(op):].strip())
    raise ValueError(f"objective 表达式未识别 op: {expr!r} (支持 > >= < <= ==)")


def _compare(v: float, op: str, threshold: float) -> bool:
    if op == '>': return v > threshold
    if op == '>=': return v >= threshold
    if op == '<': return v < threshold
    if op == '<=': return v <= threshold
    if op == '==': return v == threshold
    raise ValueError(f'unknown op: {op}')


# ---------- 方向池兼容表 (strategy-directions.md §A 同款) ----------
_DIRECTION_POOL_COMPAT: dict[tuple[str, str], list[str]] = {
    ('convertible_bond', '1d'): ['DIR-001', 'DIR-002', 'DIR-006'],
    ('a_share', '1d'):         ['DIR-002', 'DIR-003', 'DIR-005', 'DIR-006',
                                 'DIR-007', 'DIR-008', 'DIR-009', 'DIR-010', 'DIR-011'],
    ('etf', '1d'):             ['DIR-002', 'DIR-003', 'DIR-004', 'DIR-010', 'DIR-011'],
    # 5m/tick — v2 Phase B 锁日线, 表保留供 akquant 0.3.x; 当前 designer 应报 blocked:designer
    ('a_share', '5m'):         ['DIR-002', 'DIR-006'],
    ('etf', '5m'):             ['DIR-002', 'DIR-006'],
    ('convertible_bond', '5m'):['DIR-002', 'DIR-006'],
    ('a_share', 'tick'):       ['DIR-006'],
    ('etf', 'tick'):           ['DIR-006'],
    ('convertible_bond', 'tick'): ['DIR-006'],
    ('stock', '1d'):           ['DIR-003'],
}


# ---------- suggest_next_directions (evolver exit 时, v2 降级版) ----------
def suggest_next_directions(
    pool_type: str,
    period: str,
    current_direction_id: str | None,
    historical_summary: dict | None = None,
    k: int = 3,
) -> list[str]:
    """死方向时推荐替代方向 ID (top k 列表)。

    **v2 降级语义** (strategy-directions.md §E): `historical_summary=None` → 走 §A 选择器重筛
    (无历史加权), 返回 top k 中排除 current_direction_id. **禁止 fallback 到默认 DIR-007**
    (违背证据原则). 不引入大盘加权 (v2 无 scan_market_outlook).

    输入:
      pool_type / period: 当前策略池型 + 周期 (cfg.pool / cfg.period)
      current_direction_id: 当前 spec.direction_id (从这方向上死出来)
      historical_summary: STRAT-HIST 汇总 (v2 永远 None; 保留参数为未来实装预留)
      k: 最多返回几个替代方向

    算法:
      1. 候选池 = _DIRECTION_POOL_COMPAT[(pool_type, period)] (池/周期不兼容 → [])
      2. 排除 current_direction_id (不推荐回头)
      3. (仅 historical_summary 给出时) 硬排除跨策略高占比 + 高 no_improvement 方向
      4. 返回 top k

    返回 [] = 无替代建议, evolver/orchestrator 走原 abort/continue 路径。
    不抛错 — 历史不足 / 池周期不兼容都返 [], 让上层决定。
    """
    candidates: list[str] = list(_DIRECTION_POOL_COMPAT.get((pool_type, period), []))
    if not candidates:
        return []

    if current_direction_id and current_direction_id in candidates:
        candidates.remove(current_direction_id)

    hist = historical_summary or {}
    dist = hist.get('direction_distribution') or {}
    exit_dist = hist.get('exit_reason_distribution') or {}
    total_hist = sum(dist.values()) or 1
    no_imp_ratio = (exit_dist.get('no_improvement', 0) / total_hist) if total_hist else 0.0

    # 硬排除: 跨策略高占比 + 高 no_improvement (v2 降级: historical_summary=None → 跳过)
    if no_imp_ratio >= 0.5:
        for d, cnt in list(dist.items()):
            if cnt / total_hist >= 0.5 and d in candidates:
                candidates.remove(d)

    if not candidates:
        return []

    # v2 降级: 无软降权 (无历史 freq) — 保持 §A 表顺序, 前 k 个即返回
    return candidates[:k]


# ---------- append_learnings (evolver exit 时 orchestrator 落盘) ----------
def append_learnings(stem: str, learnings_dict: dict, spec_snapshot: dict | None = None) -> Path:
    """evolver exit 时落盘 <workspace>/hamuna-strategies/<stem>/learnings.md。

    learnings_dict 必填 3 段: dead_ends / user_signals / applicable_to (schema §2.7)。
    spec_snapshot 可选 (spec_strategy.json path + final metrics)。
    写入策略: append (跨多次 exit 累加, 用 markdown ## 分割)。
    """
    workdir = _strategy_dir(stem)
    workdir.mkdir(exist_ok=True)
    md_path = workdir / 'learnings.md'
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    sections = []
    sections.append(f'# {stem} learnings（{ts}）\n')

    dead = learnings_dict.get('dead_ends') or []
    if dead:
        sections.append('## dead_ends（连续2轮 <0.5% applied_delta 的变量）')
        for d in dead:
            sections.append(f"- {d.get('variable')}: {d.get('from')}→{d.get('to')} "
                            f"(round {d.get('round')}, {d.get('delta_pct', 0):.1f}% delta) → skip")
        sections.append('')

    sigs = learnings_dict.get('user_signals') or []
    if sigs:
        sections.append('## user_signals（用户接受/拒绝的 ticket 摘要）')
        for s in sigs:
            sections.append(f"- {s.get('verdict', '?')}: round {s.get('round')} "
                            f"{s.get('variable')} {s.get('from')}→{s.get('to')} "
                            f"({s.get('note', '')})")
        sections.append('')

    app = learnings_dict.get('applicable_to') or {}
    if app:
        sections.append('## applicable_to（适用池型 / 周期）')
        for k, v in app.items():
            sections.append(f"- {k}: {v}")
        sections.append('')

    if spec_snapshot:
        sections.append('## spec_snapshot（定格该 exit 时刻的策略规格，供复现）')
        for k, v in spec_snapshot.items():
            sections.append(f"- {k}: {v}")
        sections.append('')

    with md_path.open('a', encoding='utf-8') as f:
        f.write('\n'.join(sections) + '\n---\n')
    return md_path


# ---------- append_audit_report (orchestrator 落盘, verify_issue gate 读同一路径) ----------
def append_audit_report(stem: str, round_n: int, audit_report: dict,
                        source: str | None = None,
                        spec_snapshot: dict | None = None) -> Path:
    """落盘 audit_report 到 <workspace>/hamuna-strategies/<stem>/audits/round_<n>.json。

    P5 跨轮回流: 每轮 audit 沉淀, 下一轮 verify_issue gate 读同一路径做 trigger 回归。
    与 change_history.jsonl 同目录层级 (每策略独立子目录); 文件名 round_<n>.json 便于按轮次列。

    args:
      stem: 策略稳定名 (不带 ::<uuid8> 尾巴)
      round_n: 轮次 (>=1, 首轮 = 1)
      audit_report: audit_report dict (含 issues[])
      source: 可选 strategy.py 源码全文 (落盘便于 reproduce)
      spec_snapshot: 可选 spec 快照 ({universe.pool_type, period, ...}), 落盘到 _spec_snapshot
    returns:
      写入的 json 文件路径
    """
    workdir = _strategy_dir(stem)
    workdir.mkdir(exist_ok=True)
    audits_dir = workdir / 'audits'
    audits_dir.mkdir(exist_ok=True)
    json_path = audits_dir / f'round_{round_n}.json'
    payload = dict(audit_report)
    payload['_round'] = round_n
    if source is not None:
        payload['_foo_source'] = source
    if spec_snapshot is not None:
        payload['_spec_snapshot'] = spec_snapshot
    with json_path.open('w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return json_path


# ---------- verify_issue (orchestrator 循环轮 gate) ----------
def verify_issue(prev_issues: list[dict], source: str) -> list[str]:
    """对上一轮 issues[] 逐条 trigger 回归, 返回仍命中的 issue_id 列表 (空 = 全闭环)。

    命中规则 (pipeline.md §2.2):
      1. 上一轮 issue_id 在 issues 里但 trigger 在源码仍命中 → 仍命中 (coder 没改)
      2. 上一轮 issue_id 不在 issues 里但 trigger 仍命中 → 仍命中 (隐藏 bypass)
      3. 上一轮 issue_id 不在 issues 里且 trigger 不命中 → 已闭环

    **v2 适配**: auditor issue 无 `trigger` 字段 (或 trigger 空) → 跳过回归, 靠本轮 auditor
    重审兜底 (不误判闭环)。orchestrator 在 spawn auditor 前跑一次, 不是 auditor 内部职责。

    args:
      prev_issues: 上一轮 audit_report.issues[] (每条含 id + 可选 trigger)
      source: 当前 strategy.py 源码全文 (orchestrator spawn 时 Read 一次)
    returns:
      未闭环的 issue_id 列表 (orchestrator 用此判 blocked:redo_coder)
    """
    bypassed = []
    for issue in prev_issues:
        iid = issue.get('id')
        trig = issue.get('trigger', '')
        if not iid or not trig:
            continue
        # trigger 是 "regex:..." 或裸 regex 字符串
        pattern = trig.split(':', 1)[1] if trig.startswith('regex:') else trig
        try:
            if re.search(pattern, source, re.MULTILINE | re.DOTALL):
                bypassed.append(iid)
        except re.error:
            # trigger regex 写错 → 不判闭环, 跳过这条 (避免 auditor 误报)
            continue
    return bypassed


if __name__ == '__main__':
    _TMP_ROOT = str(Path(tempfile.mkdtemp(prefix='v2_helpers_selfcheck_')) / 'ws')
    # self-check: objective_met
    assert objective_met({'sharpe': 1.6, 'max_drawdown': 0.14},
                         {'sharpe': '>1.5', 'max_drawdown': '<0.15'}) is True
    assert objective_met({'sharpe': 1.4, 'max_drawdown': 0.14},
                         {'sharpe': '>1.5'}) is False
    assert objective_met({'sharpe': float('nan')}, {'sharpe': '>1.5'}) is False
    assert objective_met({'sharpe': 1.6}, {}) is False       # 空 objective = 不达标
    assert objective_met({'total_return': 0.10}, {'total_return': '>=0.10'}) is True
    assert objective_met({'total_return': 0.10}, {'total_return': '==0.5'}) is False
    try:
        objective_met({'x': 1.0}, {'x': '~1.0'})            # 未知 op → ValueError
        assert False, 'should raise'
    except ValueError:
        pass
    print('OK: objective_met')

    # self-check: suggest_next_directions (v2 降级: 无历史)
    # a_share+1d 兼容表 (排除 DIR-003 后): DIR-002/005/006/007/008/009/010/011 → top3
    assert suggest_next_directions('a_share', '1d', 'DIR-003') == \
        ['DIR-002', 'DIR-005', 'DIR-006']
    assert suggest_next_directions('a_share', '1d', 'DIR-003', k=8)[-1] == 'DIR-011'  # 全表末位
    assert 'DIR-003' not in suggest_next_directions('a_share', '1d', 'DIR-003')
    assert suggest_next_directions('stock', '1d', 'DIR-003') == []      # 单股仅 DIR-003, 排除后空
    assert suggest_next_directions('etf', 'tick', None) == ['DIR-006']
    assert suggest_next_directions('convertible_bond', '1d', 'DIR-999') == \
        ['DIR-001', 'DIR-002', 'DIR-006']                    # 未知 current → 不排除
    assert suggest_next_directions('stock', '5m', 'DIR-003') == []      # 池/周期不兼容
    print('OK: suggest_next_directions')

    # self-check: verify_issue
    issues = [
        {'id': 'ISS-001', 'trigger': 'regex:get_market_data_ex'},
        {'id': 'ISS-002'},                                   # 无 trigger → 跳过
        {'id': 'ISS-003', 'trigger': 'no_such_symbol_xyz'},
    ]
    assert verify_issue(issues, 'foo = get_market_data_ex(1, 2)') == ['ISS-001']
    assert verify_issue(issues, 'bar = 42') == []            # ISS-001 已修, ISS-002 跳过, ISS-003 不命中
    assert verify_issue([], 'anything') == []
    print('OK: verify_issue')

    # self-check: append_audit_report (round_trip: 写 → verify_issue gate 读)
    os.environ['HAMUNA_STRATEGIES_ROOT'] = _TMP_ROOT
    p = append_audit_report('selfcheck_strat', 1, {'issues': issues}, source='foo = 1')
    assert p.name == 'round_1.json' and p.exists()
    assert p.parent.name == 'audits'
    loaded = json.loads(p.read_text(encoding='utf-8'))
    assert loaded['_round'] == 1 and len(loaded['issues']) == 3
    assert loaded['_foo_source'] == 'foo = 1'
    print('OK: append_audit_report')

    # self-check: append_learnings (v2 3 段 + suggested_next_direction_ids)
    lp = append_learnings(
        'selfcheck_strat',
        {
            'dead_ends': [{'variable': 'risk_config.max_position_pct', 'from': 0.10, 'to': 0.15, 'round': 3, 'delta_pct': 0.3}],
            'user_signals': [{'verdict': '接受', 'round': 1, 'variable': 'cfg_only.cost', 'from': 5, 'to': 3, 'note': '改善净利润'}],
            'applicable_to': {'pool': 'a_share', 'period': '1d'},
            'suggested_next_direction_ids': ['DIR-007'],
        },
        spec_snapshot={'spec_strategy.json': '<path>', 'final_metrics': '{sharpe: 1.32}'},
    )
    assert lp.name == 'learnings.md' and lp.exists()
    body = lp.read_text(encoding='utf-8')
    assert '## dead_ends' in body and '## user_signals' in body
    assert '## applicable_to' in body and '## spec_snapshot' in body
    print('OK: append_learnings')
    print('ALL OK: references/_helpers.py self-check passed')
