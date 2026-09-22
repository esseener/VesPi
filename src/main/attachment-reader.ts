import { readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'
import type { AttachmentReadResult } from '../shared/ipc-contracts'

// Lowercase file extension -> MIME type for images we decode to base64 (for the
// preview pane's image viewer, and as Pi inline-image blocks). Note: the chat
// attachment picker is separately limited to SUPPORTED_IMAGE_EXTENSIONS, so the
// extra preview-only formats here (avif/bmp/ico) are never sent to Pi.
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

// Guard against accidentally base64-inlining a huge file into a prompt.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** How much of a file's head is enough to tell text from binary. */
export const BINARY_SNIFF_BYTES = 8192

/**
 * Whether these bytes are something a prompt can carry as text.
 *
 * A NUL byte in the head is the classic, low-false-positive signal: every format
 * people attach by accident — PDF, ZIP, Office, an executable, an image whose
 * extension is not in IMAGE_MIME_BY_EXTENSION — has one within its first few
 * hundred bytes, while UTF-8/ASCII text never does. (UTF-16 text does, and is
 * treated as binary with them — correctly, since decoding it as UTF-8 is what
 * produced the mojibake in the first place.)
 *
 * A positive answer no longer refuses the file; it routes it to a path
 * reference, where the agent can open it properly.
 */
export function looksBinary(head: Buffer): boolean {
  return head.subarray(0, BINARY_SNIFF_BYTES).includes(0)
}

/** MIME type for a path's extension if it is a supported image, else null. */
export function imageMimeTypeForPath(filePath: string): string | null {
  const ext = extname(filePath).slice(1).toLowerCase()
  return IMAGE_MIME_BY_EXTENSION[ext] ?? null
}

/**
 * Reads a user-selected attachment by absolute path (chosen via the native open
 * dialog, or dropped on the composer, so it may live outside the workspace).
 *
 * Three answers, and the third is the one that keeps this honest:
 *
 *  - an image becomes a Pi-ready base64 payload, because the model can look at it;
 *  - text is inlined, because the model can read it directly with no extra step;
 *  - anything else — a binary format, or a file too large to carry — becomes a
 *    REFERENCE: the app hands over the path and lets the agent open it with its
 *    own tools. A ZIP or a PDF cannot be inlined as text at all, and refusing
 *    them outright (what this used to do, with a lengthy explanation) threw away
 *    work the agent could have done. Reading a path is a normal, permission-
 *    governed agent action, so nothing here widens what the app itself may read.
 */
export async function readAttachment(filePath: string): Promise<AttachmentReadResult> {
  const fileStat = await stat(filePath)
  const name = basename(filePath)
  if (fileStat.size > MAX_ATTACHMENT_BYTES) {
    // Still returned, not thrown: the agent can read it from disk in slices.
    return { kind: 'reference', name, sizeBytes: fileStat.size, reason: 'too-large' }
  }
  const mimeType = imageMimeTypeForPath(filePath)
  if (mimeType) {
    const bytes = await readFile(filePath)
    return {
      kind: 'image',
      name,
      image: { type: 'image', mimeType, data: bytes.toString('base64') },
    }
  }
  const bytes = await readFile(filePath)
  if (looksBinary(bytes)) {
    return { kind: 'reference', name, sizeBytes: fileStat.size, reason: 'binary' }
  }
  return { kind: 'text', name, content: bytes.toString('utf-8') }
}
