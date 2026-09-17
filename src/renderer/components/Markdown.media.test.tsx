import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
  readFileAsBlobUrl: vi.fn(),
  readLocalFileAsBlobUrl: vi.fn(),
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
    readLocalFileAsBlobUrl: mocks.readLocalFileAsBlobUrl,
    checkPaths: vi.fn(),
    checkLocalPaths: vi.fn(),
    openWithDefault: vi.fn(),
    openPathWithDefault: vi.fn(),
    openPathExternal: vi.fn(),
  }),
}));

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: () => Promise.resolve('/Users/zhihu'),
  join: (...parts: string[]) => Promise.resolve(parts.join('/')),
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

function blobHandle(url: string) {
  return { blobUrl: url, mimeType: 'image/png', name: 'file', revoke: vi.fn() };
}

describe('Markdown media rendering', () => {
  it('renders an image markdown as <img>, not a link', () => {
    renderMarkdown('![cat](https://example.com/cat.png)');
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('https://example.com/cat.png');
    expect(img.getAttribute('alt')).toBe('cat');
    expect(document.querySelector('a')).toBeNull();
  });

  it('renders an absolute local image path in a link via local blob', async () => {
    mocks.readLocalFileAsBlobUrl.mockResolvedValue(blobHandle('blob:local-img'));
    renderMarkdown('[photo](/Users/zhihu/Pictures/photo.png)');
    const img = await screen.findByRole('img');
    expect(mocks.readLocalFileAsBlobUrl).toHaveBeenCalledWith({
      fullPath: '/Users/zhihu/Pictures/photo.png',
      workspace: WORKSPACE,
    });
    expect(img.getAttribute('src')).toBe('blob:local-img');
    expect(document.querySelector('a')).toBeNull();
  });

  it('renders a workspace-relative image path via workspace blob', async () => {
    mocks.readFileAsBlobUrl.mockResolvedValue(blobHandle('blob:ws-img'));
    renderMarkdown('[diagram](docs/flow.png)');
    const img = await screen.findByRole('img');
    expect(mocks.readFileAsBlobUrl).toHaveBeenCalledWith({ path: 'docs/flow.png' });
    expect(img.getAttribute('src')).toBe('blob:ws-img');
  });

  it('renders a local video path as <video controls>', async () => {
    mocks.readLocalFileAsBlobUrl.mockResolvedValue({
      blobUrl: 'blob:local-video', mimeType: 'video/mp4', name: 'clip.mp4', revoke: vi.fn(),
    });
    renderMarkdown('[clip](C:\\Videos\\clip.mp4)');
    let video: HTMLVideoElement | null = null;
    await waitFor(() => {
      video = document.querySelector('video');
      expect(video).not.toBeNull();
    });
    expect(video!.getAttribute('src')).toBe('blob:local-video');
    expect(video!.hasAttribute('controls')).toBe(true);
    expect(document.querySelector('a')).toBeNull();
    // Preprocess percent-encodes the drive colon so micromark keeps the
    // destination; MarkdownLocalMedia decodes it back to the real path.
    expect(mocks.readLocalFileAsBlobUrl).toHaveBeenCalledWith({
      fullPath: 'C:\\Videos\\clip.mp4',
      workspace: WORKSPACE,
    });
  });

  it('expands ~/ to the home dir for local media paths', async () => {
    mocks.readLocalFileAsBlobUrl.mockResolvedValue(blobHandle('blob:tilda'));
    renderMarkdown('![wallpaper](~/Pictures/wall.png)');
    await screen.findByRole('img');
    expect(mocks.readLocalFileAsBlobUrl).toHaveBeenCalledWith({
      fullPath: '/Users/zhihu/Pictures/wall.png',
      workspace: WORKSPACE,
    });
  });

  it('falls back to a link when local file read fails', async () => {
    mocks.readLocalFileAsBlobUrl.mockRejectedValue(new Error('File not found'));
    renderMarkdown('[missing](/tmp/nope.png)');
    const link = await screen.findByRole('link');
    expect(link.getAttribute('href')).toBe('/tmp/nope.png');
    expect(document.querySelector('img')).toBeNull();
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

  it('renders a bare remote video URL (preprocess img syntax) as <video controls>', () => {
    // Preprocess 2f rewrites a bare .mp4 URL to ![url](url) — that lands here
    // as an img node, which must render <video>, not a broken <img>.
    renderMarkdown('1. 开场：https://cos-platform-outputs.agnes-ai.cn/videos/agnes-video-v2.0/video_a.mp4');
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.getAttribute('src')).toBe('https://cos-platform-outputs.agnes-ai.cn/videos/agnes-video-v2.0/video_a.mp4');
    expect(video!.hasAttribute('controls')).toBe(true);
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders multimedia-creator plain-text output lines as images (local + remote)', async () => {
    // The exact shape the user reported: the MCP emits the output paths as
    // PLAIN TEXT ("本地：<abs path> 远程：<url>") — preprocess converts them
    // to markdown image syntax, then local → blob img, remote → direct img.
    mocks.readLocalFileAsBlobUrl.mockResolvedValue(blobHandle('blob:local-media'));
    const localPath = '/home/hmcz/.hamuna/projects/mino/outputs/images/agnes-media-1788486645-e0740721.png';
    const remoteUrl = 'https://cos-platform-outputs.agnes-ai.cn/images/agnes-media-1788486645-e0740721.png';
    renderMarkdown(`本地：${localPath} 远程：${remoteUrl}`);
    // Local image loads async via readLocalFileAsBlobUrl → blob URL.
    let imgs: HTMLImageElement[] = [];
    await waitFor(() => {
      imgs = Array.from(document.querySelectorAll('img'));
      expect(imgs.length).toBe(2);
    });
    expect(imgs.some((i) => i.getAttribute('src') === 'blob:local-media')).toBe(true);
    expect(imgs.some((i) => i.getAttribute('src') === remoteUrl)).toBe(true);
    expect(mocks.readLocalFileAsBlobUrl).toHaveBeenCalledWith({
      fullPath: localPath,
      workspace: WORKSPACE,
    });
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
