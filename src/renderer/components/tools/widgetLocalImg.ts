/**
 * Widget local-media resolution — pure helpers, no DOM/theme deps.
 *
 * Widgets render in a sandboxed iframe whose CSP is `img-src data: https:`
 * and `media-src data: https:` (widgetSandboxHtml.ts). An AI-generated widget
 * that embeds a LOCAL file path (e.g. `/home/…/outputs/videos/xxx.mp4` or
 * `…/images/agnes-media-*.png`, which multimedia-creator / agnes-image /
 * agnes-video return as `local_paths`) renders broken: the sandbox has an
 * opaque origin and can't read local files, and the path isn't a CSP-allowed
 * src. We rewrite such `<img src>` / `<video src>` to `data:` URLs (base64
 * from Rust `cmd_workspace_read_files_b64`) before finalizing. `data:` is
 * already in the sandbox CSP, and unlike a parent-created blob: URL it works
 * inside the opaque-origin iframe.
 *
 * Kept in its own module so the unit test (node env) doesn't pull in
 * WidgetRenderer.tsx → theme registry (which needs `document` at load).
 */
import type { WorkspaceFileService } from '@/hooks/useWorkspaceFileService';

const LOCAL_PATH_RE = /^(?:[a-zA-Z]:[\\/]|~\/|\/)/;
const MEDIA_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|mp4|webm|ogg|ogv|mov|m4v)(?:[?#].*)?$/i;

function isLocalMediaPath(src: string): boolean {
  // POSIX /…, Windows drive C:\…/C:/…, home ~/… AND a media extension.
  return LOCAL_PATH_RE.test(src) && MEDIA_EXT_RE.test(src);
}

/** Rewrite every `<img src>` / `<video src>` pointing at a local absolute
 *  media path to a data: URL. `<source src>` inside `<video>` is left as-is —
 *  the AI-generated widgets use the direct `src` attribute form. */
export async function resolveLocalMediaSrcs(
  html: string,
  fileService: WorkspaceFileService | null,
): Promise<string> {
  if (!fileService) return html;
  // Collect distinct local media paths referenced by <img>/<video> src.
  const srcRe = /<(?:img|video)\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?>/gi;
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
