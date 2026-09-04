import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
  readFileAsBlobUrl: vi.fn(),
}));

vi.mock('@/utils/openExternal', async () => {
  const actual = await vi.importActual<typeof import('@/utils/openExternal')>('@/utils/openExternal');
  return { ...actual, openExternal: mocks.openExternal };
});

vi.mock('@/context/ImagePreviewContext', () => ({
  useImagePreview: () => ({ openPreview: vi.fn() }),
}));

vi.mock('@/hooks/useWorkspaceFileService', () => ({
  useWorkspaceFileService: () => ({
    isAvailable: true,
    readPreview: vi.fn(),
    readLocalPreview: vi.fn(),
    readFileAsBlobUrl: mocks.readFileAsBlobUrl,
    checkPaths: vi.fn(),
    checkLocalPaths: vi.fn(),
    openWithDefault: vi.fn(),
    openPathWithDefault: vi.fn(),
    openPathExternal: vi.fn(),
  }),
}));

import { FileActionProvider } from '@/context/FileActionContext';

import Markdown from './Markdown';

const WORKSPACE = '/Users/zhihu/Documents/project/HamunaAgent';

function renderMarkdown(markdown: string) {
  render(
    <FileActionProvider workspacePath={WORKSPACE}>
      <Markdown>{markdown}</Markdown>
    </FileActionProvider>,
  );
}

describe('Markdown media rendering', () => {
  it('renders an image markdown as <img>, not a link', () => {
    renderMarkdown('![cat](https://example.com/cat.png)');
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('https://example.com/cat.png');
    expect(img.getAttribute('alt')).toBe('cat');
    expect(document.querySelector('a')).toBeNull();
  });

  it('renders an absolute image URL wrapped in a link as <img> inline', () => {
    renderMarkdown('[view](https://example.com/photo.jpg)');
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('https://example.com/photo.jpg');
    // No hyperlink should remain for the media URL.
    expect(document.querySelector('a')).toBeNull();
  });

  it('renders a video URL as <video controls> instead of a link', () => {
    renderMarkdown('[watch](https://example.com/clip.mp4)');
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.getAttribute('src')).toBe('https://example.com/clip.mp4');
    expect(video!.hasAttribute('controls')).toBe(true);
    expect(document.querySelector('a')).toBeNull();
  });

  it('wraps multiple same-line images in a grid container', () => {
    renderMarkdown('![a](https://example.com/a.png) ![b](https://example.com/b.png) ![c](https://example.com/c.png)');
    const grid = document.querySelector('.grid');
    expect(grid).not.toBeNull();
    // All three images live inside the grid.
    expect(grid!.querySelectorAll('img')).toHaveLength(3);
    expect(document.querySelector('p')).toBeNull();
  });

  it('keeps plain (non-media) links as hyperlinks', () => {
    renderMarkdown('[docs](https://example.com/guide)');
    const link = document.querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('https://example.com/guide');
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders raw HTML <video> with controls (rehype-raw path)', () => {
    renderMarkdown('<video src="https://example.com/movie.webm" poster="https://example.com/p.jpg"></video>');
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.getAttribute('src')).toBe('https://example.com/movie.webm');
    expect(video!.hasAttribute('controls')).toBe(true);
  });
});
