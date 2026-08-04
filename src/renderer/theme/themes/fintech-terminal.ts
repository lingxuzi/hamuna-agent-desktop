import stylesheetText from './fintech-terminal.css?inline';
import type { PresetThemeManifest } from './preset-theme';

export const fintechTerminalThemeManifest = {
  id: 'fintech-terminal',
  displayName: 'Fintech Terminal',
  description: 'Bloomberg-inspired dark-mode-first Theme: deep slate near-black, Hermes gold primary, terminal green/red, sharp corners, Inter + JetBrains Mono',
  stylesheetText,
} satisfies PresetThemeManifest;
