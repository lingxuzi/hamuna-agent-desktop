import type { ImageAttachment } from '@/components/SimpleChatInput';
import type { MessageAttachment } from '@/types/chat';

function imageAttachmentName(img: ImageAttachment): string {
  return img.name || img.file.name;
}

function imageAttachmentMimeType(img: ImageAttachment): string {
  return img.mimeType || img.file.type || 'application/octet-stream';
}

function imageAttachmentSize(img: ImageAttachment): number {
  return img.sizeBytes ?? img.file.size;
}

export function imagePayloadForSend(img: ImageAttachment) {
  const name = imageAttachmentName(img);
  const mimeType = imageAttachmentMimeType(img);
  const sizeBytes = imageAttachmentSize(img);
  if (img.source === 'attachment_ref' && img.relativePath) {
    return {
      kind: 'attachment_ref' as const,
      id: img.id,
      name,
      mimeType,
      sizeBytes,
      relativePath: img.relativePath,
    };
  }
  return {
    kind: 'inline_base64' as const,
    id: img.id,
    name,
    mimeType,
    sizeBytes,
    data: img.preview.split(',')[1] ?? '',
  };
}

interface WorkspaceFileReadResult {
  path: string;
  name: string;
  mimeType: string;
  data: string;
  error?: string | null;
}

interface WorkspaceFileReader {
  isAvailable: boolean;
  readPathsAsBase64(args: { paths: string[] }): Promise<{
    success: boolean;
    files: WorkspaceFileReadResult[];
  }>;
}

/**
 * Read workspace files in one batch and return a Map keyed by path. Caller
 * decides how to fold the data into its own shape. Throws on hard failures
 * (Tauri unavailable, batch read returned success:false) so the caller can
 * surface a clear error.
 */
export async function readWorkspaceFilesAsBase64(
  paths: string[],
  fileService: WorkspaceFileReader | null,
): Promise<Map<string, WorkspaceFileReadResult>> {
  if (paths.length === 0) return new Map();
  if (!fileService?.isAvailable) {
    throw new Error(`无法读取 ${paths.length} 个工作区文件：需要在桌面应用中操作`);
  }
  const response = await fileService.readPathsAsBase64({ paths });
  if (!response.success) {
    throw new Error('读取工作区文件失败');
  }
  return new Map(response.files.map((f) => [f.path, f]));
}

/**
 * Read every `attachment_ref` image from the workspace and rebase its
 * `preview` onto a `data:<mimeType>;base64,<...>` URL. The existing
 * `imagePayloadForSend` then takes the inline_base64 branch automatically —
 * the backend's session-scoped validator (`validateAttachmentRelativePath`)
 * rejects workspace-relative paths under `<workspace>/hamuna_files/…` as
 * "Image attachment does not belong to this session".
 *
 * Returns a NEW array (no mutation of caller's `images` state) so the chip
 * preview keeps using the lightweight `asset://` URL until the user sends.
 * The chip is re-rendered from the caller's state which is untouched.
 *
 * On read failure throws so the caller can surface a toast — silently
 * substituting a different payload would let the backend accept garbage
 * or fail with a confusing 4xx.
 */
export async function rebaseAttachmentRefPreviewsToDataUrl(
  images: ImageAttachment[] | undefined,
  fileService: WorkspaceFileReader | null,
): Promise<ImageAttachment[]> {
  if (!images || images.length === 0) return [];
  const workspaceRefImages = images.filter(
    (img) => img.source === 'attachment_ref' && !!img.relativePath,
  );
  if (workspaceRefImages.length === 0) return images;

  const readByPath = await readWorkspaceFilesAsBase64(
    workspaceRefImages.map((img) => img.relativePath!),
    fileService,
  );

  return images.map((img) => {
    if (img.source !== 'attachment_ref' || !img.relativePath) return img;
    const read = readByPath.get(img.relativePath);
    if (!read || read.error) {
      throw new Error(
        `工作区图片 "${imageAttachmentName(img)}" 读取失败：${read?.error ?? '未找到文件'}`,
      );
    }
    if (!read.data) {
      throw new Error(`工作区图片 "${imageAttachmentName(img)}" 内容为空`);
    }
    const mimeType = read.mimeType || imageAttachmentMimeType(img) || 'application/octet-stream';
    return {
      ...img,
      preview: `data:${mimeType};base64,${read.data}`,
    };
  });
}

export function mergeAttachmentPreviews(
  attachments: MessageAttachment[] | undefined,
  previews: MessageAttachment[] | undefined,
): MessageAttachment[] | undefined {
  if (!attachments || attachments.length === 0) return previews;
  if (!previews || previews.length === 0) return attachments;

  const previewIndexesByAttachment = new Map<number, number>();
  const usedPreviewIndexes = new Set<number>();

  // Stable identity is authoritative. Resolve every exact match first so a
  // legacy fallback cannot consume a preview that belongs to a later item.
  attachments.forEach((attachment, attachmentIndex) => {
    const previewIndex = previews.findIndex((preview, index) =>
      !usedPreviewIndexes.has(index) && preview.id === attachment.id
    );
    if (previewIndex === -1) return;
    previewIndexesByAttachment.set(attachmentIndex, previewIndex);
    usedPreviewIndexes.add(previewIndex);
  });

  // Older inline payloads were re-keyed by the server. Preserve compatibility
  // with those in-flight messages by pairing equal descriptors one-to-one.
  attachments.forEach((attachment, attachmentIndex) => {
    if (previewIndexesByAttachment.has(attachmentIndex)) return;
    const previewIndex = previews.findIndex((preview, index) =>
      !usedPreviewIndexes.has(index)
      && preview.name === attachment.name
      && preview.mimeType === attachment.mimeType
    );
    if (previewIndex === -1) return;
    previewIndexesByAttachment.set(attachmentIndex, previewIndex);
    usedPreviewIndexes.add(previewIndex);
  });

  return attachments.map((att, index) => {
    const previewIndex = previewIndexesByAttachment.get(index);
    const match = previewIndex === undefined ? undefined : previews[previewIndex];
    return match?.previewUrl ? { ...att, previewUrl: match.previewUrl } : att;
  });
}
