// miniappUi.ts — shared display helpers for the MiniApp catalog pages.
//
// `meta.json` declares `icon` as either a lucide icon name ("git-branch") or a
// literal emoji. Rendering the field directly dumps "folder-search" into the
// tile as text, so names are resolved here and anything unrecognised falls
// back to a neutral glyph (see MiniAppIcon).

import {
  FileSearch,
  GitBranch,
  Package,
  Palette,
  Waves,
  type LucideIcon,
} from 'lucide-react';

export const MINIAPP_ICON_MAP: Record<string, LucideIcon> = {
  'file-search': FileSearch,
  'folder-search': FileSearch,
  'git-branch': GitBranch,
  palette: Palette,
  wave: Waves,
};

export const MINIAPP_FALLBACK_ICON: LucideIcon = Package;

export interface MiniAppTint {
  /** Class for the icon tile behind the glyph. */
  tile: string;
  /** Class for the glyph itself. */
  glyph: string;
}

// Every pair is built from tokens in REQUIRED_THEME_CSS_TOKENS, so the tile
// stays correct in all nine themes and in dark mode without new CSS. The
// classes are literal strings because Tailwind has to see them at build time.
const TINTS: readonly MiniAppTint[] = [
  { tile: 'bg-[var(--paper-inset)]', glyph: 'text-[var(--ink-secondary)]' },
  { tile: 'bg-[var(--accent-warm-subtle)]', glyph: 'text-[var(--accent-warm)]' },
  { tile: 'bg-[var(--info-bg)]', glyph: 'text-[var(--info)]' },
  { tile: 'bg-[var(--success-bg)]', glyph: 'text-[var(--success)]' },
  { tile: 'bg-[var(--warning-bg)]', glyph: 'text-[var(--warning)]' },
  { tile: 'bg-[var(--error-bg)]', glyph: 'text-[var(--error)]' },
];

/** Used when a card has no entry in the dealt map (e.g. a filtered-out id). */
export const NEUTRAL_TINT: MiniAppTint = TINTS[0]!;

/**
 * Even colour spread across a catalog. Colours are dealt out over the
 * id-sorted list rather than hashed per id: hashing 4 apps into 6 buckets
 * collided on 3 of the 4, which is exactly the "every card looks the same"
 * outcome this is meant to avoid. Sorting also keeps neighbours apart.
 *
 * The trade-off is deliberate: adding or removing an app re-deals the rest, so
 * a card's colour is stable for as long as the catalog is, not forever.
 */
export function miniAppTints(appIds: readonly string[]): Map<string, MiniAppTint> {
  const tints = new Map<string, MiniAppTint>();
  [...appIds].sort().forEach((id, index) => {
    tints.set(id, TINTS[index % TINTS.length]!);
  });
  return tints;
}
