/**
 * Unified API fetch utility that works in both browser and Tauri modes.
 * - Browser mode: Uses native fetch with relative URLs (Vite proxy)
 * - Tauri mode: Uses proxyFetch with full URLs through Rust proxy
 * 
 * For Tauri mode, this now uses the global Sidecar URL, which is suitable
 * for global operations like API key verification in Settings.
 */

import { getGlobalServerUrlWithWait, proxyFetch } from './tauriClient';
import { isTauriEnvironment } from '@/utils/browserMock';

/**
 * 把服务端 `{ error, message }` 失败响应包装成 Error：
 *  - Error.message 保持原 code 字符串（向后兼容：既有 grep / catch 习惯不动）
 *  - Error.serverMessage 是服务端 `message` 字段（人类可读原因，如 "recharge failed (code 403)"
 *    / "fetch failed"），消费者想看真因时自行读 `err.serverMessage`，不想看时忽略即可
 *  - 不想污染 Error.prototype 把 serverMessage 做成每个实例 ad-hoc 字段
 */
function buildApiError(errorData: unknown, status: number, statusPrefix = 'HTTP'): Error & { serverMessage?: string; isApiError?: boolean } {
  const code = (errorData as { error?: string }).error || `${statusPrefix} ${status}`;
  const err = new Error(code) as Error & { serverMessage?: string; isApiError?: boolean };
  err.serverMessage = (errorData as { message?: string }).message;
  // isApiError 标志：让 apiGetJson 的 catch 块能区分"buildApiError 自己 throw 的"和"JSON.parse 失败的"，
  // 避免 serverMessage === undefined 时被误判吞掉。
  err.isApiError = true;
  return err;
}

/**
 * Fetch from API endpoint, handling both browser and Tauri modes
 * Uses the global Sidecar for API calls (suitable for Settings page)
 * Will wait for global sidecar to be ready before making requests
 * @param endpoint - API endpoint starting with / (e.g., '/agent/dir')
 * @param options - Fetch options
 */
export async function apiFetch(endpoint: string, options?: RequestInit): Promise<Response> {
    if (isTauriEnvironment()) {
        // Tauri mode: use global Sidecar URL (waits for sidecar to be ready)
        const baseUrl = await getGlobalServerUrlWithWait();
        const url = `${baseUrl}${endpoint}`;
        return proxyFetch(url, options);
    } else {
        // Browser mode: use relative URL (Vite proxy handles it)
        return fetch(endpoint, options);
    }
}

/**
 * POST JSON to API endpoint
 */
export async function apiPostJson<T>(endpoint: string, data: unknown): Promise<T> {
    const response = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw buildApiError(errorData, response.status);
    }

    return response.json();
}

/**
 * GET JSON from API endpoint
 */
export async function apiGetJson<T>(endpoint: string): Promise<T> {
    const response = await apiFetch(endpoint);

    if (!response.ok) {
        const responseText = await response.text();
        console.error('[apiGetJson] Error response:', {
            status: response.status,
            endpoint,
            body: responseText.slice(0, 500) // First 500 chars
        });
        try {
            const errorData = JSON.parse(responseText);
            throw buildApiError(errorData, response.status);
        } catch (e) {
            if (e instanceof Error && (e as { isApiError?: boolean }).isApiError) {
                throw e; // 已是 buildApiError 产物，原样透传
            }
            throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 100)}`);
        }
    }

    return response.json();
}

/**
 * POST FormData to API endpoint (for file uploads)
 * 
 * WARNING: FormData uploads don't work in Tauri mode through proxyFetch.
 * This function only works in browser development mode.
 * For Tauri mode file uploads, use Tauri's native file dialog APIs.
 */
export async function apiPostFormData<T>(endpoint: string, formData: FormData): Promise<T> {
    if (isTauriEnvironment()) {
        // FormData doesn't serialize properly through Tauri's proxyFetch
        // Need to use Tauri's native file APIs for file uploads in desktop mode
        throw new Error(
            'FormData uploads are not supported in desktop mode. ' +
            'Please use Tauri file dialog APIs for file operations.'
        );
    }

    // Browser mode: use native fetch
    const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw buildApiError(errorData, response.status);
    }

    return response.json();
}

/**
 * PUT JSON to API endpoint
 */
export async function apiPutJson<T>(endpoint: string, data: unknown): Promise<T> {
    const response = await apiFetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw buildApiError(errorData, response.status);
    }

    return response.json();
}

/**
 * DELETE request to API endpoint
 */
export async function apiDelete<T>(endpoint: string): Promise<T> {
    const response = await apiFetch(endpoint, {
        method: 'DELETE',
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw buildApiError(errorData, response.status);
    }

    return response.json();
}
