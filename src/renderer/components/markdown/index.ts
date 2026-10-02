/**
 * Markdown components index
 * Export all markdown-related components from this directory
 */

export { default as CodeBlock } from './CodeBlock';
export { default as InlineCode } from './InlineCode';

// MermaidDiagram is deliberately NOT re-exported here. It is ~0.9 MB and its
// only consumer (Markdown.tsx) loads it via `lazy()`. A static re-export on
// this barrel would pull the whole library back into the caller's chunk and
// silently undo that split. Import it directly if you ever need it.
