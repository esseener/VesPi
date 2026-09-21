import { createPortal } from 'react-dom'

/**
 * Mounts a viewport-anchored layer — modal, popup, context menu, toast — on
 * `document.body` instead of inline.
 *
 * `index.css` carries an UNLAYERED rule that lifts app chrome above the
 * background mesh:
 *
 *   .app-console > :not(.app-console-mesh):not(.window-controls-overlay):not(.titlebar-drag-overlay) {
 *     position: relative;
 *     z-index: 2;
 *   }
 *
 * Unlayered declarations outrank everything in `@layer utilities`, which is
 * where Tailwind keeps `.fixed` and `z-*`, so ANY direct child of `.app-console`
 * silently loses its positioning: `position: fixed` became `relative`, `inset:
 * 0` stopped meaning "the viewport", a backdrop collapsed to a zero-height
 * strip, and the layer piled up at the bottom of the flex column where the
 * window edge clipped it — while `z-index` was forced down to 2 regardless of
 * what the utility asked for.
 *
 * Measured against the built stylesheet with a hidden Electron window:
 * a `fixed inset-0 z-50` child of `.app-console` reported
 * `position: relative, z-index: 50, rect { y: 711, height: 24 }`,
 * while the same element as a child of `document.body` reported
 * `position: fixed` and filled the viewport.
 *
 * `document.body` is the one placement that rule cannot reach. Everything that
 * expects `fixed` to mean the viewport must render through here.
 */
export function OverlayPortal({ children }: { children: React.ReactNode }): React.JSX.Element {
  return createPortal(children, document.body)
}
