/**
 * 中国广电 Token 平台 — 服务器端账务模块
 *
 * 职责：
 * - 用机器码（~/.hamuna/device_id）调 `POST /api/open/customer/register` 拿 apiKey，
 *   持久化到 ~/.hamuna/nxgd-auth.json；
 * - 暴露余额查询 / 充值订单创建给 HTTP endpoint；
 * - 给 `resolveProviderEnv` 提供当前 apiKey 注入到 ANTHROPIC_API_KEY。
 *
 * 设计：复用 `withFileLock` 做并发注册安全（in-flight promise 复用避免撞 5/60s 限流）；
 * 1h TTL 余额缓存；任何远程失败 fallback 到「上次缓存 + 错误状态」，不抛。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sendLog } from './logger';
import { withFileLock } from './utils/file-lock';
import { cancellableFetch } from './utils/cancellation';
import { NXGD_BILLING_BASE_URL } from '../shared/config-types';

const AUTH_FILE = join(homedir(), '.hamuna', 'nxgd-auth.json');
const AUTH_LOCK = AUTH_FILE + '.lock';
const DEVICE_ID_FILE = join(homedir(), '.hamuna', 'device_id');
const LOW_BALANCE_THRESHOLD = 5; // 元
const BALANCE_CACHE_MS = 60 * 60 * 1000; // 1h，撞 5/60s IP 限流
const REGISTER_TIMEOUT_MS = 10_000;
const BALANCE_TIMEOUT_MS = 10_000;
const RECHARGE_TIMEOUT_MS = 15_000;

export type NxgdAuthStatus = 'idle' | 'registering' | 'registered' | 'error';

export interface NxgdAuthState {
  status: NxgdAuthStatus;
  /** 是否已完成注册（apiKey 已落盘或内存） */
  registered: boolean;
  /** 余额缓存，单位元；未拉过为 null */
  balance: number | null;
  usedBalance: number | null;
  /** 余额最近一次刷新时间（ms epoch） */
  balanceCheckedAt: number | null;
  /** 最近一次错误信息（注册失败 / 余额拉取失败） */
  error: string | null;
}

interface PersistedAuth {
  apiKey: string;
  code: string;
  registeredAt: number;
}

interface BalanceSnapshot {
  balance: number;
  usedBalance: number;
  status: number;
  lastCheckedAt: number;
}

interface RechargeResult {
  orderNo: string;
  payFormHtml: string;
  expiresAt: string;
}

// --- module-level state（单例） ---------------------------------------------

let cachedAuth: PersistedAuth | null = null;
/** `ensureRegistered` in-flight promise，并发调用复用同一 fetch */
let inflightRegister: Promise<PersistedAuth | null> | null = null;
let cachedBalance: BalanceSnapshot | null = null;
/** 当前状态机快照（renderer 可见） */
let currentState: NxgdAuthState = {
  status: 'idle',
  registered: false,
  balance: null,
  usedBalance: null,
  balanceCheckedAt: null,
  error: null,
};

// --- helpers ---------------------------------------------------------------

function logNxgd(level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) {
  sendLog(level, `[nxgd] ${msg}`, meta);
}

function updateState(patch: Partial<NxgdAuthState>) {
  currentState = { ...currentState, ...patch };
}

/** 读 ~/.hamuna/device_id。文件不存在或读失败返回 null（首次启动 device_id 未生成时）。 */
function readDeviceId(): string | null {
  try {
    if (!existsSync(DEVICE_ID_FILE)) return null;
    const id = readFileSync(DEVICE_ID_FILE, 'utf-8').trim();
    return id.length > 0 ? id : null;
  } catch (err) {
    logNxgd('warn', 'read device_id failed', { err: String(err) });
    return null;
  }
}

/** 读 ~/.hamuna/nxgd-auth.json，失败 / 不存在返回 null */
async function readPersistedAuth(): Promise<PersistedAuth | null> {
  return withFileLock(
    { lockPath: AUTH_LOCK, timeoutMs: 5_000, staleMs: 30_000 },
    async () => {
      try {
        if (!existsSync(AUTH_FILE)) return null;
        const raw = readFileSync(AUTH_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedAuth>;
        if (typeof parsed.apiKey !== 'string' || parsed.apiKey.length === 0) return null;
        if (typeof parsed.code !== 'string' || parsed.code.length === 0) return null;
        return {
          apiKey: parsed.apiKey,
          code: parsed.code,
          registeredAt: typeof parsed.registeredAt === 'number' ? parsed.registeredAt : 0,
        };
      } catch (err) {
        logNxgd('warn', 'read persisted auth failed', { err: String(err) });
        return null;
      }
    },
  );
}

async function writePersistedAuth(auth: PersistedAuth): Promise<void> {
  await withFileLock(
    { lockPath: AUTH_LOCK, timeoutMs: 5_000, staleMs: 30_000 },
    async () => {
      const dir = AUTH_FILE.substring(0, AUTH_FILE.lastIndexOf('/'));
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf-8');
    },
  );
}

interface NxgdApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

async function postNxgd<T>(path: string, body: unknown, timeoutMs: number): Promise<NxgdApiResponse<T>> {
  const resp = await cancellableFetch(
    `${NXGD_BILLING_BASE_URL}${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { timeoutMs },
  );
  if (!resp.ok) {
    throw new Error(`nxgd ${path} HTTP ${resp.status}`);
  }
  return (await resp.json()) as NxgdApiResponse<T>;
}

async function getNxgd<T>(path: string, timeoutMs: number): Promise<NxgdApiResponse<T>> {
  const resp = await cancellableFetch(
    `${NXGD_BILLING_BASE_URL}${path}`,
    { method: 'GET' },
    { timeoutMs },
  );
  if (!resp.ok) {
    throw new Error(`nxgd ${path} HTTP ${resp.status}`);
  }
  return (await resp.json()) as NxgdApiResponse<T>;
}

// --- public API ------------------------------------------------------------

/** 懒加载：首次调用时尝试读持久化 + 注册。返回 NxgdAuthState（不抛）。 */
export async function ensureRegistered(): Promise<NxgdAuthState> {
  if (currentState.status === 'registered') return currentState;
  if (inflightRegister) {
    await inflightRegister.catch(() => null);
    return currentState;
  }

  inflightRegister = (async () => {
    try {
      updateState({ status: 'registering', error: null });

      const persisted = cachedAuth ?? (await readPersistedAuth());
      if (persisted) {
        cachedAuth = persisted;
        updateState({ status: 'registered', registered: true, error: null });
        return persisted;
      }

      const deviceId = readDeviceId();
      if (!deviceId) {
        const err = 'device_id not ready yet; first boot in progress';
        updateState({ status: 'error', registered: false, error: err });
        return null;
      }

      const resp = await postNxgd<{ user: unknown; apiKeyName: string; apiKey: string }>(
        '/api/open/customer/register',
        { code: deviceId },
        REGISTER_TIMEOUT_MS,
      );
      if (resp.code !== 200 || !resp.data?.apiKey) {
        const err = resp.message || `register failed (code ${resp.code})`;
        updateState({ status: 'error', registered: false, error: err });
        logNxgd('warn', 'register failed', { code: resp.code, message: resp.message });
        return null;
      }

      const next: PersistedAuth = {
        apiKey: resp.data.apiKey,
        code: deviceId,
        registeredAt: Date.now(),
      };
      await writePersistedAuth(next);
      cachedAuth = next;
      updateState({ status: 'registered', registered: true, error: null });
      logNxgd('info', 'register succeeded');
      return next;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateState({ status: 'error', registered: false, error: msg });
      logNxgd('error', 'register threw', { err: msg });
      return null;
    } finally {
      inflightRegister = null;
    }
  })();

  await inflightRegister;
  return currentState;
}

/** 给 resolveProviderEnv 用的 apiKey。null 表示未注册或注册失败。 */
export async function getNxgdApiKey(): Promise<string | null> {
  if (cachedAuth?.apiKey) return cachedAuth.apiKey;
  const persisted = await readPersistedAuth();
  if (persisted) {
    cachedAuth = persisted;
    updateState({ status: 'registered', registered: true, error: null });
    return persisted.apiKey;
  }
  await ensureRegistered();
  return cachedAuth?.apiKey ?? null;
}

/** 同步读缓存（启动时已 preload）。null 表示尚未注册。 */
export function getNxgdApiKeySync(): string | null {
  return cachedAuth?.apiKey ?? null;
}

/** 启动时调用：sync 读持久化文件，填好 in-memory 缓存，避免首次 session 拿到 undefined。
 *  不持文件锁 — 仅读取；写者用 `withFileLock` 原子写 tmp+rename，不存在 read-write 撕裂。 */
export function preloadNxgdAuth(): void {
  if (cachedAuth) return;
  try {
    if (!existsSync(AUTH_FILE)) return;
    const raw = readFileSync(AUTH_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistedAuth>;
    if (typeof parsed.apiKey !== 'string' || parsed.apiKey.length === 0) return;
    if (typeof parsed.code !== 'string' || parsed.code.length === 0) return;
    cachedAuth = {
      apiKey: parsed.apiKey,
      code: parsed.code,
      registeredAt: typeof parsed.registeredAt === 'number' ? parsed.registeredAt : 0,
    };
    updateState({ status: 'registered', registered: true, error: null });
  } catch (err) {
    // 读失败不阻断 — 由 ensureRegistered 后续触发重新注册
    logNxgd('warn', 'preload auth failed', { err: String(err) });
  }
}

/** renderer 可见的当前状态快照。 */
export function getNxgdAuthState(): NxgdAuthState {
  return currentState;
}

/** 余额查询。1h TTL 缓存；forceRefresh=true 跳过缓存。 */
export async function fetchBalance(forceRefresh = false): Promise<BalanceSnapshot | null> {
  if (!forceRefresh && cachedBalance && Date.now() - cachedBalance.lastCheckedAt < BALANCE_CACHE_MS) {
    return cachedBalance;
  }

  const deviceId = readDeviceId();
  if (!deviceId) {
    updateState({ error: 'device_id not ready' });
    return cachedBalance; // 返旧值（如果有）
  }

  try {
    const resp = await getNxgd<{ username: string; balance: number; usedBalance: number; status: number }>(
      `/api/open/customer/balances?code=${encodeURIComponent(deviceId)}`,
      BALANCE_TIMEOUT_MS,
    );
    if (resp.code !== 200 || !resp.data) {
      const msg = resp.message || `balance failed (code ${resp.code})`;
      updateState({ error: msg });
      logNxgd('warn', 'balance fetch failed', { code: resp.code, message: resp.message });
      return cachedBalance;
    }
    cachedBalance = {
      balance: Number(resp.data.balance ?? 0),
      usedBalance: Number(resp.data.usedBalance ?? 0),
      status: Number(resp.data.status ?? 0),
      lastCheckedAt: Date.now(),
    };
    updateState({
      balance: cachedBalance.balance,
      usedBalance: cachedBalance.usedBalance,
      balanceCheckedAt: cachedBalance.lastCheckedAt,
      error: null,
    });
    return cachedBalance;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateState({ error: msg });
    logNxgd('error', 'balance fetch threw', { err: msg });
    return cachedBalance;
  }
}

/** 创建充值订单。amount 单位元（API 接受 0.1 ~ 5000）。 */
export async function createRechargeOrder(amount: number): Promise<RechargeResult | null> {
  if (!(await ensureRegistered()).registered) return null;

  const clamped = Math.max(0.1, Math.min(5000, Number(amount)));
  if (!Number.isFinite(clamped)) return null;

  const deviceId = readDeviceId();
  if (!deviceId) return null;

  try {
    const resp = await postNxgd<RechargeResult>(
      '/api/open/customer/recharge',
      { code: deviceId, amount: clamped },
      RECHARGE_TIMEOUT_MS,
    );
    if (resp.code !== 200 || !resp.data) {
      const msg = resp.message || `recharge failed (code ${resp.code})`;
      updateState({ error: msg });
      logNxgd('warn', 'recharge failed', { code: resp.code, message: resp.message });
      return null;
    }
    // 成功创建订单后清掉余额缓存，下次 fetchBalance 拿到新值
    cachedBalance = null;
    return resp.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateState({ error: msg });
    logNxgd('error', 'recharge threw', { err: msg });
    return null;
  }
}

/** 强制重置（清掉 in-memory 状态，从持久化文件重读；持久化也没有就重新注册）。 */
export async function refreshNxgdAuth(): Promise<NxgdAuthState> {
  cachedAuth = null;
  cachedBalance = null;
  updateState({
    status: 'idle',
    registered: false,
    balance: null,
    usedBalance: null,
    balanceCheckedAt: null,
    error: null,
  });
  return ensureRegistered();
}

/** Chat / Settings 用：余额是否低于 5 元阈值。 */
export async function isLowBalance(): Promise<boolean> {
  const snap = await fetchBalance();
  if (!snap) return false; // 拉不到不阻断（fail-soft）
  return snap.balance < LOW_BALANCE_THRESHOLD;
}
