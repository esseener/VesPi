import { useEffect, useRef } from 'react'

/**
 * Close a tool-view panel when Escape is pressed.
 *
 * The seven tool panels (settings, extensions, notes, about, timeline, mission
 * control, diagnostics) all live in the same slot as Chat and had no way out of
 * their own — you had to find the small × on the workspace tab above. Every
 * dialog in the app already answers Escape; the panels should too.
 *
 * `enabled` keeps the listener inert while the panel is not the visible view.
 *
 * Escape is claimed conservatively, because panels host their own overlays:
 *
 * - Listeners run in the bubble phase, and the app's modals (theme editor,
 *   theme gallery, context menu, extension dialog) `stopPropagation()` — so a
 *   modal inside a panel consumes Escape before the panel ever sees it.
 * - Text fields keep their Escape (settings search box, note editor): clearing
 *   the field is what the user asked for, not leaving the page.
 * - Composing text (IME) holds the key, same guard the rest of the app uses.
 */
export function useEscapeToClose(enabled: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return
      if (event.isComposing || event.keyCode === 229) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      event.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
