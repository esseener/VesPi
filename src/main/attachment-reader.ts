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
 * refused with it — correctly, since decoding it as UTF-8 is what produced the
 * mojibake in the first place.)
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
 * dialog, so it may live outside the workspace). Images become a Pi-ready base64
 * payload; everything else is read as UTF-8 text to inline.
 *
 * "Everything else" has to actually be text. A non-image file used to be decoded
 * as UTF-8 whatever it held, so attaching a PDF or a ZIP inlined a stream of
 * replacement characters into the model's context — and once the transcript
 * began collapsing attachments into cards, that garbage became invisible to the
 * person paying for it. Refusing is the honest answer: a text-decoded archive
 * was never any use to the model either.
 */
export async function readAttachment(filePath: string): Promise<AttachmentReadResult> {
  const fileStat = await stat(filePath)
  if (fileStat.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment is too large (max ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB)`)
  }
  const name = basename(filePath)
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
    throw new Error(
      `Attachment is not text, and its type is not one of the supported images (${Object.keys(IMAGE_MIME_BY_EXTENSION).join(', ')})`
    )
  }
  return { kind: 'text', name, content: bytes.toString('utf-8') }
}
