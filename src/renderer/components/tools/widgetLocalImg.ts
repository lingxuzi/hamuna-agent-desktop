/**
 * Widget local-image resolution — pure helpers, no DOM/theme deps.
 *
 * Widgets render in a sandboxed iframe whose CSP is `img-src data: https:`
 * (widgetSandboxHtml.ts). An AI-generated widget that embeds a LOCAL file path
 * (e.g. `/home/…/outputs/images/agnes-media-*.png`, which multimedia-creator /
 * agnes-image return as `local_paths`) renders a broken image: the sandbox has
 * an opaque origin and can't read local files, and the path isn't a CSP-allowed
 * src. We rewrite such `<img src>` to `data:` URLs (base64 from Rust
 * `cmd_workspace_read_files_b64`) before finalizing. `data:` is already in the
 * sandbox CSP, and unlike a parent-created blob: URL it works inside the
 * opaque-origin iframe.
 *
 * Kept in its own module so the unit test (node env) doesn't pull in
 * WidgetRenderer.tsx → theme registry (which needs `document` at load).
 */
import type { WorkspaceFileService } from '@/hooks/useWorkspaceFileService';

function isLocalImagePath(src: string): boolean {
  // POSIX /…, Windows drive C:\…/C:/…, home ~/… AND an image extension.
  return /^(?:[a-zA-Z]:[\\/]|~\/|\/)/.test(src) && /\.(png|jpe?g|gif|webp|svg|avif|bmp)(?:[?#].*)?$/i.test(src);
}

/** Rewrite every `<img src="<local absolute image path>">` to a data: URL. */
export async function resolveLocalImgSrcs(
  html: string,
  fileService: WorkspaceFileService | null,
): Promise<string> {
  if (!fileService) return html;
  // Collect distinct local image paths referenced by <img src>.
  const imgRe = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?>/gi;
  const paths = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    if (isLocalImagePath(m[1])) paths.add(m[1]);
  }
  if (paths.size === 0) return html;

  let result;
  try {
    result = await fileService.readPathsAsBase64({ paths: [...paths] });
  } catch {
    return html; // read failure → leave as-is (broken image, not a crash)
  }
  if (!result || !result.success) return html;

  const dataUrlByPath = new Map<string, string>();
  for (const f of result.files) {
    if (!f.error && f.data) {
      dataUrlByPath.set(f.path, `data:${f.mimeType || 'image/png'};base64,${f.data}`);
    }
  }
  if (dataUrlByPath.size === 0) return html;

  const replaceRe = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?>/gi;
  return html.replace(replaceRe, (full, src: string) => {
    const dataUrl = dataUrlByPath.get(src);
    return dataUrl ? full.replace(src, dataUrl) : full;
  });
}
