// kb-ingest.ts — URL / PDF / Word / Excel ingestion for the knowledge base.
//
// The Rust KbEngine only accepts plain text (it owns the jieba skeleton +
// Tantivy index). This module parses richer inputs into text in the sidecar
// and writes back to Rust over the management API (`/api/kb/add-text`):
//   - url   → SSRF-guarded fetch (https-only + private-IP rejection) → HTML→text
//   - pdf   → pdfjs-dist legacy build → per-page text content
//   - docx  → adm-zip → word/document.xml → <w:t> text runs
//   - xlsx  → SheetJS → cell values per sheet
//   - text  → passthrough (paste path)
//
// Imported lazily from routeAdminApi (kb/ingest) so the heavy parsing libs
// (pdfjs-dist / xlsx / adm-zip) stay out of the cold-start path.

import { lookup } from 'dns/promises';

import { isUrlSchemeSafe } from './runtimes/tool-attachments';
import { cancellableFetch } from './utils/cancellation';

export interface KbIngestRequest {
  kbId: string;
  title: string;
  kind: 'url' | 'pdf' | 'docx' | 'xlsx' | 'text';
  /** url → the URL; pdf/docx/xlsx → base64 file content; text → raw text */
  data: string;
}

const URL_FETCH_TIMEOUT_MS = 20_000;
const MAX_URL_BYTES = 5 * 1024 * 1024; // 5 MiB HTML cap
const MAX_PARSE_CHARS = 200_000; // hard cap on extracted text per document

function cap(text: string): string {
  return text.length > MAX_PARSE_CHARS ? text.slice(0, MAX_PARSE_CHARS) : text;
}

// ── SSRF-guarded URL fetch ──────────────────────────────────────────────

/** Mirror of tool-attachments isBlockedHostLiteral — reject private/loopback. */
function isPrivateIp(address: string): boolean {
  const h = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::1' || h === '::' || h.startsWith('::ffff:')) return true;
  return (
    h === '127.0.0.1' || h.startsWith('127.') || h === '0.0.0.0' ||
    h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) ||
    /^\[?fc00:/i.test(h) || /^\[?fd[0-9a-f]{2}:/i.test(h) || /^\[?fe80:/i.test(h)
  );
}

async function fetchUrlText(url: string, parentSignal?: AbortSignal): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('无效的 URL');
  }
  const schemeCheck = isUrlSchemeSafe(parsed);
  if (!schemeCheck.ok) throw new Error(schemeCheck.reason);

  // DNS post-check: a public hostname resolving to a private address is an
  // SSRF vector (169.254.169.254 etc.). Fail closed.
  try {
    const addresses = await lookup(parsed.hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateIp(address)) {
        throw new Error(`Blocked: ${parsed.hostname} resolves to private address ${address}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Blocked:')) throw err;
    // DNS failure → the fetch below will surface the real error.
  }

  const resp = await cancellableFetch(
    url,
    { redirect: 'error', signal: parentSignal, headers: { 'User-Agent': 'HamunaAgent-KB/1.0' } },
    { timeoutMs: URL_FETCH_TIMEOUT_MS, parentSignal },
  );
  if (!resp.ok) throw new Error(`网页抓取失败: HTTP ${resp.status}`);
  const html = await resp.text();
  if (html.length > MAX_URL_BYTES) throw new Error('网页内容过大');
  return cap(htmlToText(html));
}

/** Minimal HTML→text: strip script/style/head, drop tags, decode entities. */
function htmlToText(html: string): string {
  const s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&hellip;/gi, '…')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// ── PDF ─────────────────────────────────────────────────────────────────

async function parsePdfBase64(base64: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw new Error('文件内容为空');

  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = (content.items as Array<{ str?: string }>)
        .map((item) => item.str ?? '')
        .join(' ');
      pages.push(text.trim());
      page.cleanup();
    }
    return cap(pages.join('\n\n'));
  } finally {
    await doc.destroy();
  }
}

// ── Word (.docx) ────────────────────────────────────────────────────────

async function parseDocxBase64(base64: string): Promise<string> {
  const AdmZip = (await import('adm-zip')).default;
  const bytes = Buffer.from(base64, 'base64');
  const zip = new AdmZip(bytes);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('不是有效的 .docx 文件（缺少 word/document.xml）');
  const xml = entry.getData().toString('utf8');
  // Replace paragraph + tab markers with sentinel placeholders, then extract
  // both <w:t> runs and the sentinels in document order so structure survives.
  // The marker string cannot legitimately appear inside a <w:t> run.
  const PAR = '@@HAMUNA_PAR@@';
  const marked = xml
    .replace(/<\/w:p>/g, PAR)
    .replace(/<w:tab(?:\s[^>]*)?\/>/g, '\t');
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|@@HAMUNA_PAR@@|\t/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(marked)) !== null) {
    if (m[0] === PAR) out += '\n';
    else if (m[0] === '\t') out += '\t';
    else out += m[1] ?? '';
  }
  return cap(out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
}

// ── Excel (.xlsx / .xls) ────────────────────────────────────────────────

async function parseXlsxBase64(base64: string): Promise<string> {
  const XLSX = await import('xlsx');
  const bytes = Buffer.from(base64, 'base64');
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const lines: string[] = [];
  for (const name of wb.SheetNames.slice(0, 20)) {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    lines.push(`【${name}】`);
    for (const row of rows.slice(0, 500)) {
      const cells = (row ?? [])
        .map((c) => String(c ?? '').replace(/[\t\n\r]+/g, ' ').trim())
        .filter(Boolean)
        .join('\t');
      if (cells) lines.push(cells);
    }
  }
  return cap(lines.join('\n'));
}

function defaultTitle(kind: KbIngestRequest['kind'], data: string): string {
  if (kind === 'url') {
    try {
      return new URL(data).hostname;
    } catch {
      return '网页';
    }
  }
  return kind.toUpperCase();
}

// ── Entry point ─────────────────────────────────────────────────────────

/** Parse the input and write the extracted text into the KB via management API. */
export async function ingestKbMaterial(
  req: KbIngestRequest,
  parentSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!req.kbId) return { ok: false, error: 'kbId is required' };

  let text = '';
  try {
    switch (req.kind) {
      case 'url':
        text = await fetchUrlText(req.data, parentSignal);
        break;
      case 'pdf':
        text = await parsePdfBase64(req.data);
        break;
      case 'docx':
        text = await parseDocxBase64(req.data);
        break;
      case 'xlsx':
        text = await parseXlsxBase64(req.data);
        break;
      case 'text':
        text = req.data;
        break;
      default:
        return { ok: false, error: `Unsupported kind: ${String(req.kind)}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }

  if (!text.trim()) {
    return { ok: false, error: '未能从输入中提取到文本内容' };
  }

  const title = req.title.trim() || defaultTitle(req.kind, req.data);
  // In-process TypeGraph store (lazy — kb modules stay out of cold start).
  const { addText } = await import('./kb/kb-store');
  try {
    const summary = await addText(req.kbId, title, text);
    return { ok: true, summary };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
