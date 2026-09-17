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
import { NXGD_BILLING_BASE_URL, NXGD_LLM_BASE_URL } from '../shared/config-types';

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
  /** 平台返回的数字用户 ID（注册时 `data.user.id`）— 用于充值页面对账 */
  userId: number | null;
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
  userId: number;
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
  /** 上游返的支付收银台 URL（用户在 OS 默认浏览器/Tauri shell.open 完成付款） */
  checkoutUrl: string;
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
  userId: null,
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
          userId: typeof parsed.userId === 'number' ? parsed.userId : 0,
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
        updateState({ status: 'registered', registered: true, userId: persisted.userId || null, error: null });
        return persisted;
      }

      const deviceId = readDeviceId();
      if (!deviceId) {
        const err = 'device_id not ready yet; first boot in progress';
        updateState({ status: 'error', registered: false, error: err });
        return null;
      }

      const resp = await postNxgd<{ user: { id?: number }; apiKeyName: string; apiKey: string }>(
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
        userId: typeof resp.data.user?.id === 'number' ? resp.data.user.id : 0,
        registeredAt: Date.now(),
      };
      await writePersistedAuth(next);
      cachedAuth = next;
      updateState({ status: 'registered', registered: true, userId: next.userId || null, error: null });
      logNxgd('info', 'register succeeded', { userId: next.userId });
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

/** 幂等重拉 apiKey — 调 register 同 code 拿当前有效 token（可能与磁盘一致，也可能上游已轮换）。
 *  用于上游 LLM endpoint 返 401 时自动恢复；register 本身是幂等的（重复调返既有令牌）。 */
export async function refreshNxgdApiKey(): Promise<string | null> {
  const deviceId = readDeviceId();
  if (!deviceId) {
    logNxgd('warn', 'refreshNxgdApiKey: no device_id');
    return cachedAuth?.apiKey ?? null;
  }
  try {
    const resp = await postNxgd<{ user: { id?: number }; apiKeyName: string; apiKey: string }>(
      '/api/open/customer/register',
      { code: deviceId },
      REGISTER_TIMEOUT_MS,
    );
    if (resp.code !== 200 || !resp.data?.apiKey) {
      logNxgd('warn', 'refreshNxgdApiKey: register failed', { code: resp.code, message: resp.message });
      return cachedAuth?.apiKey ?? null;
    }
    const rotated = resp.data.apiKey !== cachedAuth?.apiKey;
    const next: PersistedAuth = {
      apiKey: resp.data.apiKey,
      code: deviceId,
      userId: typeof resp.data.user?.id === 'number' ? resp.data.user.id : (cachedAuth?.userId ?? 0),
      registeredAt: cachedAuth?.registeredAt ?? Date.now(),
    };
    await writePersistedAuth(next);
    cachedAuth = next;
    updateState({ status: 'registered', registered: true, userId: next.userId || null, error: null });
    logNxgd('info', 'refreshNxgdApiKey ok', { rotated, userId: next.userId });
    return next.apiKey;
  } catch (err) {
    logNxgd('error', 'refreshNxgdApiKey threw', { err: err instanceof Error ? err.message : String(err) });
    return cachedAuth?.apiKey ?? null;
  }
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
      userId: typeof parsed.userId === 'number' ? parsed.userId : 0,
      registeredAt: typeof parsed.registeredAt === 'number' ? parsed.registeredAt : 0,
    };
    updateState({ status: 'registered', registered: true, userId: cachedAuth.userId, error: null });
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
    userId: null,
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

// --- model list ------------------------------------------------------------

interface NxgdModelEntity {
  id: string;
  displayName?: string;
  createdAt?: string;
}

interface NxgdModelsResponse {
  data: NxgdModelEntity[];
  has_more?: boolean;
}

/** 拉广电可用模型列表（调 /v1/models with Authorization: Bearer, 24h 内存缓存）。
 *  失败 / 无 apiKey 返 null（Settings 卡片显示空列表 + 「稍后重试」）。
 *  上游 429 时进入冷却期（默认 60s），期间不再发起请求，直接返缓存。 */
let cachedModels: { models: NxgdModelEntity[]; checkedAt: number } | null = null;
const MODELS_CACHE_MS = 24 * 60 * 60 * 1000;
let rateLimitedUntil = 0; // 上游 429 时设到这里；期间 fetchModels 直接返缓存，不再撞墙

/** 给 endpoint 用的「最后一次成功的 models 缓存快照」，方便 502 时透传给 renderer。 */
export function getCachedNxgdModelsSnapshot(): NxgdModelEntity[] | null {
  return cachedModels?.models ?? null;
}

/** 给 endpoint 用的「是否处于上游 429 冷却期」标志 + 剩余秒数（renderer UI 用来显示「稍后重试」倒计时）。 */
export function getNxgdModelsCooldown(): { cooling: boolean; secondsLeft: number } {
  const secondsLeft = Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
  return { cooling: secondsLeft > 0, secondsLeft };
}

/** 构造 /v1/models 请求的 fetch opts。401 retry 复用，避免 headers 漂移。 */
function buildModelsRequestOpts(apiKey: string): Parameters<typeof cancellableFetch>[1] {
  return {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
    },
  };
}

export async function fetchModels(forceRefresh = false): Promise<NxgdModelEntity[] | null> {
  if (!forceRefresh && cachedModels && Date.now() - cachedModels.checkedAt < MODELS_CACHE_MS) {
    return cachedModels.models;
  }

  // 冷却期内不发起请求，避免继续撞 429
  if (Date.now() < rateLimitedUntil) {
    logNxgd('warn', 'fetchModels: in rate-limit cooldown, returning cache');
    return cachedModels?.models ?? null;
  }

  // 走 getNxgdApiKey — 复用 ensureRegistered / preload 路径，确保从缓存或磁盘拿到真实可用 key
  const apiKey = await getNxgdApiKey();
  if (!apiKey) {
    logNxgd('warn', 'fetchModels: no apiKey (register first)', {
      cachedAuthExists: cachedAuth !== null,
      cachedAuthHasKey: cachedAuth ? Boolean(cachedAuth.apiKey) : false,
    });
    return cachedModels?.models ?? null;
  }

  // 上游用 Authorization: Bearer，不是 Anthropic 原生 x-api-key
  const url = `${NXGD_LLM_BASE_URL}/v1/models?limit=100`;
  logNxgd('info', 'fetchModels: requesting', {
    url,
    apiKeyPrefix: apiKey.slice(0, 7),
  });

  try {
    let currentKey = apiKey;
    let resp = await cancellableFetch(url, buildModelsRequestOpts(currentKey), {
      timeoutMs: BALANCE_TIMEOUT_MS,
    });

    // 上游 401：register 是幂等的，重调拿当前有效 apiKey（可能上游已轮换），用新 key 重试一次。
    // 仍 401 则返回缓存（fetchModels 永抛不出，caller 拿到 null 由 renderer 兜底）。
    if (resp.status === 401) {
      logNxgd('warn', 'fetchModels upstream 401 — refreshing apiKey and retrying');
      const rotatedKey = await refreshNxgdApiKey();
      if (rotatedKey && rotatedKey !== currentKey) {
        currentKey = rotatedKey;
        resp = await cancellableFetch(url, buildModelsRequestOpts(currentKey), {
          timeoutMs: BALANCE_TIMEOUT_MS,
        });
      } else {
        logNxgd('warn', 'fetchModels 401 refresh returned same/null key; skipping retry', {
          rotated: rotatedKey !== currentKey,
        });
      }
    }

    if (resp.status === 429) {
      // 上游限流：尊重 Retry-After（秒），缺失则默认 60s。期间不撞墙
      const retryAfter = Number(resp.headers.get('retry-after')) || 60;
      rateLimitedUntil = Date.now() + retryAfter * 1000;
      logNxgd('warn', 'fetchModels upstream 429 — entering cooldown', {
        retryAfterSeconds: retryAfter,
        cooldownUntil: new Date(rateLimitedUntil).toISOString(),
      });
      return cachedModels?.models ?? null;
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const snippet = body.slice(0, 200);
      logNxgd('warn', 'fetchModels upstream non-OK', {
        status: resp.status,
        bodySnippet: snippet,
      });
      return cachedModels?.models ?? null;
    }
    const body = (await resp.json()) as NxgdModelsResponse;
    const models = Array.isArray(body.data) ? body.data : [];
    cachedModels = { models, checkedAt: Date.now() };
    logNxgd('info', 'fetchModels ok', { count: models.length });
    return models;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logNxgd('error', 'fetchModels threw', { err: msg });
    return cachedModels?.models ?? null;
  }
}
