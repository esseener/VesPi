import { useEffect, useRef, useState } from 'react'
import { droppedFolderCandidates, isFileDrag } from '../../../shared/folder-drop'
import { DRAG_RESET, afterDragEnter, afterDragLeave, showsDropOverlay } from '../drag-depth'
import { COMPOSER_ELEMENT_ID } from '../composer-element'
import { useAppStore } from '../store'

/**
 * Open the first candidate that is actually a directory. Entry-less items
 * (webkitGetAsEntry returned null) can only be classified by asking main, so
 * a file appearing before a folder in the drop must not end the search. When
 * nothing qualifies, the first candidate still goes through
 * openFolderAsWorkspace so its standard "not a folder" message surfaces.
 */
async function openFirstDroppedFolder(candidates: string[]): Promise<void> {
  for (const path of candidates) {
    try {
      const kind = await window.piDesktop.system.pathKind(path)
      if (kind.exists && kind.isDirectory) {
        await useAppStore.getState().openFolderAsWorkspace(path)
        return
      }
    } catch {
      // Unprobeable candidate — try the next one.
    }
  }
  await useAppStore.getState().openFolderAsWorkspace(candidates[0])
}

/**
 * Window-level folder drag-and-drop: drop a directory onto the app to open it
 * as a workspace (create if needed, switch, show Chat).
 *
 * The overlay is only shown while dragging, and it is dismissed from the
 * capture phase so that a drop claimed by a child — the composer takes file
 * drops for attachments — still clears it.
 *
 * Files are the composer's business, not this hook's; this one only speaks up
 * when a drop carrying files lands somewhere the composer cannot see, which
 * would otherwise be a silent no-op.
 */
export function useFolderDrop(): {
  isDraggingFolder: boolean
} {
  const [isDraggingFolder, setIsDraggingFolder] = useState(false)
  const dragDepth = useRef(0)
  /** Folders classified by the capture listener, for the bubble one to open. */
  const dropCandidates = useRef<string[] | null>(null)
  /** Prevent stacking concurrent openFolderAsWorkspace calls; no overlay. */
  const openInFlight = useRef(false)

  useEffect(() => {
    const clearDrag = (): void => {
      dragDepth.current = DRAG_RESET
      setIsDraggingFolder(false)
    }

    /** Apply the counter's new value, and the overlay's, together. */
    const setDepth = (next: number): void => {
      dragDepth.current = next
      setIsDraggingFolder(showsDropOverlay(next))
    }

    const onDragEnter = (e: DragEvent): void => {
      if (!isFileDrag(e.dataTransfer)) return
      e.preventDefault()
      setDepth(afterDragEnter(dragDepth.current, true))
    }

    const onDragLeave = (e: DragEvent): void => {
      setDepth(afterDragLeave(dragDepth.current, e.relatedTarget === null))
    }

    const onDragOver = (e: DragEvent): void => {
      if (!isFileDrag(e.dataTransfer)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }

    const onDrop = (e: DragEvent): void => {
      if (!isFileDrag(e.dataTransfer)) return
      e.preventDefault()
      // Dismiss overlay immediately — do not wait for workspace create/switch.
      clearDrag()
      const candidates = dropCandidates.current ?? []
      dropCandidates.current = null
      if (candidates.length === 0 || openInFlight.current) return

      openInFlight.current = true
      void openFirstDroppedFolder(candidates).finally(() => {
        openInFlight.current = false
      })
    }

    // Capture phase, so it sees every drop — including one a child claims (the
    // composer attaches files and calls `stopPropagation`, which kept the bubble
    // listener above from ever running and left the overlay on screen until some
    // later drag happened to unwind the counter). It never touches the
    // DataTransfer's fate, so who claims the drop is unchanged.
    //
    // It is also the one place that decides what a drop *means*, because only
    // here is every drop visible: a directory is the workspace opener's
    // business, a drop on the composer is an attachment, and anything else
    // carrying files can only have meant an attachment — which used to be a
    // silent no-op, and is what made the whole gesture look broken.
    const onDropCapture = (e: DragEvent): void => {
      clearDrag()
      dropCandidates.current = null
      if (!e.dataTransfer?.files?.length) return

      const candidates = droppedFolderCandidates(e.dataTransfer, (file) =>
        window.piDesktop.system.getPathForFile(file)
      )
      if (candidates.length > 0) {
        dropCandidates.current = candidates
        return
      }

      const target = e.target instanceof Element ? e.target : null
      if (target?.closest(`#${COMPOSER_ELEMENT_ID}`)) return // the composer takes it
      // Image drags reach here too: the window never shows the overlay for them
      // (they cannot become a workspace), so this is the only thing that can
      // tell the user where they should have let go.
      useAppStore.getState().notifyFileNeedsComposer()
    }

    // A drag ended for any reason — including one cancelled over the app.
    const onDragEnd = (): void => clearDrag()

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDropCapture, true)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDropCapture, true)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [])

  return { isDraggingFolder }
}
