import { describe, expect, it, vi } from 'vitest';

import type { ImageAttachment } from '@/components/SimpleChatInput';
import type { MessageAttachment } from '@/types/chat';
import {
  imagePayloadForSend,
  mergeAttachmentPreviews,
  rebaseAttachmentRefPreviewsToDataUrl,
} from './userImageAttachmentProjection';

function inlineImage(id: string, preview: string): ImageAttachment {
  return {
    id,
    file: {
      name: 'image.png',
      type: 'image/png',
      size: 3,
    } as File,
    preview,
    source: 'inline_base64',
  };
}

function workspaceRefImage(id: string, relativePath: string, preview: string): ImageAttachment {
  return {
    id,
    file: {
      name: 'photo.png',
      type: 'image/png',
      size: 3,
    } as File,
    preview,
    source: 'attachment_ref',
    name: 'photo.png',
    mimeType: 'image/png',
    relativePath,
  };
}

function messageAttachment(id: string, previewUrl?: string): MessageAttachment {
  return {
    id,
    name: 'image.png',
    size: 3,
    mimeType: 'image/png',
    previewUrl,
    isImage: true,
  };
}

describe('user image attachment projection', () => {
  it('carries the renderer attachment identity through inline payloads', () => {
    expect(imagePayloadForSend(inlineImage('local-image-1', 'data:image/png;base64,b25l')))
      .toMatchObject({
        kind: 'inline_base64',
        id: 'local-image-1',
        name: 'image.png',
        data: 'b25l',
      });
  });

  it('matches legacy same-name previews one-to-one instead of reusing the first image', () => {
    const merged = mergeAttachmentPreviews(
      [messageAttachment('server-1'), messageAttachment('server-2')],
      [
        messageAttachment('local-1', 'data:image/png;base64,b25l'),
        messageAttachment('local-2', 'data:image/png;base64,dHdv'),
      ],
    );

    expect(merged?.map((attachment) => attachment.previewUrl)).toEqual([
      'data:image/png;base64,b25l',
      'data:image/png;base64,dHdv',
    ]);
  });

  it('reserves exact identities before pairing a same-name legacy attachment', () => {
    const merged = mergeAttachmentPreviews(
      [messageAttachment('server-legacy'), messageAttachment('local-exact')],
      [
        messageAttachment('local-exact', 'data:image/png;base64,ZXhhY3Q='),
        messageAttachment('local-legacy', 'data:image/png;base64,bGVnYWN5'),
      ],
    );

    expect(merged?.map((attachment) => attachment.previewUrl)).toEqual([
      'data:image/png;base64,bGVnYWN5',
      'data:image/png;base64,ZXhhY3Q=',
    ]);
  });

  it('rebases attachment_ref previews onto data URLs read from the workspace', async () => {
    const fileService = {
      isAvailable: true,
      readPathsAsBase64: vi.fn().mockResolvedValue({
        success: true,
        files: [
          { path: 'hamuna_files/photo.png', name: 'photo.png', mimeType: 'image/png', data: 'cGhvdG8=' },
        ],
      }),
    };

    const result = await rebaseAttachmentRefPreviewsToDataUrl(
      [workspaceRefImage('local-ref-1', 'hamuna_files/photo.png', 'asset://localhost/photo.png')],
      fileService,
    );

    expect(fileService.readPathsAsBase64).toHaveBeenCalledWith({ paths: ['hamuna_files/photo.png'] });
    expect(result[0].preview).toBe('data:image/png;base64,cGhvdG8=');
    expect(result[0].source).toBe('attachment_ref');
    expect(result[0].relativePath).toBe('hamuna_files/photo.png');
  });

  it('throws when a workspace read fails for an attachment_ref image', async () => {
    const fileService = {
      isAvailable: true,
      readPathsAsBase64: vi.fn().mockResolvedValue({
        success: true,
        files: [
          { path: 'hamuna_files/missing.png', name: 'missing.png', mimeType: 'image/png', data: '', error: 'NOT_FOUND' },
        ],
      }),
    };

    await expect(
      rebaseAttachmentRefPreviewsToDataUrl(
        [workspaceRefImage('local-ref-2', 'hamuna_files/missing.png', 'asset://localhost/missing.png')],
        fileService,
      ),
    ).rejects.toThrow(/工作区图片 "photo.png" 读取失败：NOT_FOUND/);
  });

  it('throws when fileService is unavailable and a workspace ref needs to be rebased', async () => {
    await expect(
      rebaseAttachmentRefPreviewsToDataUrl(
        [workspaceRefImage('local-ref-3', 'hamuna_files/x.png', 'asset://localhost/x.png')],
        null,
      ),
    ).rejects.toThrow(/无法读取 1 个工作区文件/);
  });
});

