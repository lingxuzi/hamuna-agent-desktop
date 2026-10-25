// html-to-markdown.ts — turn a page's raw HTML into markdown for the agent.
//
// The agent reads pages through `hamuna browser read`, and what it gets back
// has to be prose-shaped: an LLM reads markdown far better than it reads
// minified HTML with nested `<div>` soup.
//
// Pipeline: HTML → hast (`hast-util-from-html`) → mdast
// (`hast-util-to-mdast`) → markdown (`mdast-util-to-markdown`).
//
// `hast-util-to-mdast` already handles the interesting cases (links, tables,
// lists, code blocks), so the only pre-pass needed is dropping chrome —
// nav / aside / footer / script / style — and the noisy attributes that
// would otherwise survive as garbage.

import { fromHtml } from 'hast-util-from-html';
import { toMdast } from 'hast-util-to-mdast';
import { toMarkdown } from 'mdast-util-to-markdown';
import type { Element, Nodes, Root } from 'hast';

/** Tags whose entire subtree is chrome rather than content. */
const CHROME_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'nav',
  'aside',
  'footer',
  'form',
]);

/** Attributes that survive into markdown output and only add noise. */
const NOISY_ATTRIBUTES = new Set([
  'style',
  'class',
  'id',
  'width',
  'height',
  'align',
  'valign',
  'bgcolor',
  'border',
  'cellpadding',
  'cellspacing',
  'target',
  'rel',
  'srcset',
  'sizes',
  'loading',
  'decoding',
  'aria-hidden',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'role',
]);

export interface HtmlToMarkdownOptions {
  /** Hard cap on the returned markdown length. */
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 200_000;

function isNoisyAttribute(name: string): boolean {
  if (NOISY_ATTRIBUTES.has(name)) return true;
  // React / Vue scoped-id attributes (`data-v-7ba5bd90`, `data-reactid`).
  return name.startsWith('data-v-') || name.startsWith('data-react');
}

function stripNoise(node: Nodes): void {
  if (node.type === 'element') {
    const element = node as Element;
    element.properties = Object.fromEntries(
      Object.entries(element.properties ?? {}).filter(([name]) => !isNoisyAttribute(name)),
    );
    for (const child of element.children) stripNoise(child);
  } else if (node.type === 'root') {
    for (const child of (node as Root).children) stripNoise(child);
  }
}

function removeChrome(node: Root | Element): void {
  node.children = node.children.filter(
    (child) => !(child.type === 'element' && CHROME_TAGS.has((child as Element).tagName)),
  );
  for (const child of node.children) {
    if (child.type === 'element') removeChrome(child);
  }
}

/**
 * Convert raw page HTML into markdown.
 *
 * Returns markdown text — never throws for malformed input; a page that
 * doesn't parse degrades to whatever text was recoverable.
 */
export function htmlToMarkdown(html: string, options: HtmlToMarkdownOptions = {}): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  if (!html || !html.trim()) return '';

  let tree: Root;
  try {
    tree = fromHtml(html);
  } catch {
    // Unparseable HTML — fall back to the raw tags stripped as text.
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  removeChrome(tree);
  stripNoise(tree);

  let markdown: string;
  try {
    const mdast = toMdast(tree);
    markdown = toMarkdown(mdast, { bullet: '-', fences: true });
  } catch {
    return '';
  }

  // Collapse the blank-line runs that removing chrome leaves behind.
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
  if (markdown.length > maxLength) {
    markdown = `${markdown.slice(0, maxLength)}\n\n[truncated at ${maxLength} characters]`;
  }
  return markdown;
}
