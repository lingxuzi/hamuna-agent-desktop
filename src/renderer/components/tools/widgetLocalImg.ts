/**
 * Widget local-media resolution — pure helpers, no DOM/theme deps.
 *
 * Widgets render in a sandboxed iframe whose CSP is `img-src data: https:
 * hamuna:` and `media-src data: https: hamuna:` (widgetSandboxHtml.ts). An
 * AI-generated widget that embeds a LOCAL file path (e.g.
 * `/home/…/outputs/videos/xxx.mp4` or `…/images/agnes-media-*.png`, which
 * multimedia-creator / agnes-image / agnes-video return as `local_paths`)
 * renders broken otherwise: the sandbox has an opaque origin and can't read
 * local files.
 *
 * Two resolution strategies, chosen by environment:
 * - Tauri: rewrite local <img>/<video> src to a `hamuna://widget-media/…`
 *   URL (Windows: `http://hamuna.localhost/widget-media/…`). The Rust
 *   attachment_protocol handler streams the file with HTTP Range support, so
 *   <video> seeks/buffers progressively — no base64 bloat in the widget HTML
 *   (the old base64 path pegged the renderer thread on every large video).
 * - Browser dev (vite): `hamuna://` isn't registered, so fall back to base64
 *   data: URLs read through `cmd_workspace_read_files_b64`.
 *
 * Kept in its own module so the unit test (node env) doesn't pull in
 * WidgetRenderer.tsx → theme registry (which needs `document` at load).
 */
import type { WorkspaceFileService } from '@/hooks/useWorkspaceFileService';
import { isTauriEnvironment } from '@/utils/browserMock';
import { resolveHamunaAgentProtocolUrl } from '@/utils/hamunaProtocol';

const LOCAL_PATH_RE = /^(?:[a-zA-Z]:[\\/]|~\/|\/)/;
const MEDIA_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|mp4|webm|ogg|ogv|mov|m4v)(?:[?#].*)?$/i;

function isLocalMediaPath(src: string): boolean {
  // POSIX /…, Windows drive C:\…/C:/…, home ~/… AND a media extension.
  return LOCAL_PATH_RE.test(src) && MEDIA_EXT_RE.test(src);
}

/** Build the streamable `hamuna://widget-media/<encoded absolute path>` URL. */
function widgetMediaUrl(path: string): string {
  // Encode the WHOLE path (including slashes) so Rust
  // extract_path_after_marker + percent_decode round-trips it exactly.
  return resolveHamunaAgentProtocolUrl(`/widget-media/${encodeURIComponent(path)}`);
}

/**
 * Rewrite every `<img src>` / `<video src>` pointing at a local absolute media
 * path. Tauri → streamable hamuna:// URL; dev → base64 data: URL fallback.
 * `<source src>` inside `<video>` is left as-is — the AI-generated widgets use
 * the direct `src` attribute form.
 */
export async function resolveLocalMediaSrcs(
  html: string,
  fileService: WorkspaceFileService | null,
): Promise<string> {
  const srcRe = /<(?:img|video)\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?>/gi;

  // Tauri: pure URL rewrite — no file read, no base64, browser streams via
  // Range requests through the Rust protocol handler.
  if (isTauriEnvironment()) {
    return html.replace(srcRe, (full, src: string) =>
      isLocalMediaPath(src) ? full.replace(src, widgetMediaUrl(src)) : full,
    );
  }

  // Browser dev fallback: base64 data: URL so local media still renders.
  if (!fileService) return html;
  const paths = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = srcRe.exec(html)) !== null) {
    if (isLocalMediaPath(m[1])) paths.add(m[1]);
  }
  if (paths.size === 0) return html;

  let result;
  try {
    result = await fileService.readPathsAsBase64({ paths: [...paths] });
  } catch {
    return html; // read failure → leave as-is (broken media, not a crash)
  }
  if (!result || !result.success) return html;

  const dataUrlByPath = new Map<string, string>();
  for (const f of result.files) {
    if (!f.error && f.data) {
      dataUrlByPath.set(f.path, `data:${f.mimeType || 'application/octet-stream'};base64,${f.data}`);
    }
  }
  if (dataUrlByPath.size === 0) return html;

  const replaceRe = /<(?:img|video)\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?>/gi;
  return html.replace(replaceRe, (full, src: string) => {
    const dataUrl = dataUrlByPath.get(src);
    return dataUrl ? full.replace(src, dataUrl) : full;
  });
}
