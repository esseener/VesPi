/**
 * Ordering rules for the two updates that can run at once.
 *
 * Downloads may overlap — that is deliberate, and what the banner shows: both
 * channels progress side by side. **Applying** them is a different matter,
 * because the two mechanisms are not interchangeable:
 *
 * - The kernel update swaps a file in place: the working binary is moved aside,
 *   the new one is put in its place, and a failure rolls the old one back.
 * - The UI update hands off to the Windows installer, which takes over the whole
 *   install directory and asks the app to quit.
 *
 * If the app quits while the kernel is between "moved aside" and "new one in
 * place", the rollback never runs and the user is left with no working kernel.
 * So applies are ordered instead of raced:
 *
 * 1. Kernel applies are serialized against each other.
 * 2. The UI installer waits for any kernel apply to finish before it starts —
 *    it is the one that ends by restarting the app, so it goes last.
 * 3. Once the UI installer has been launched, a kernel apply is refused rather
 *    than started: the app is about to be replaced underneath it, and the new
 *    version brings its own bundled kernel anyway.
 *
 * Kept separate from the installers so the rules are unit-testable without
 * downloading anything.
 */
export interface UpdateOrder {
  /** Run a kernel apply, serialized against every other kernel apply. */
  trackKernelApply: <T>(work: () => Promise<T>) => Promise<T>
  /** Resolves once no kernel apply is running or queued. */
  waitForKernelApply: () => Promise<void>
  /** Called once the Windows installer has been handed the job. */
  markUiInstallerLaunched: () => void
  /** Whether the UI installer is already taking over this install. */
  hasUiInstallerLaunched: () => boolean
}

export function createUpdateOrder(): UpdateOrder {
  // Never rejects: a failed apply must not poison the next one.
  let kernelApply: Promise<void> = Promise.resolve()
  let uiInstallerLaunched = false

  return {
    trackKernelApply<T>(work: () => Promise<T>): Promise<T> {
      const run = kernelApply.then(work, work)
      kernelApply = run.then(
        () => undefined,
        () => undefined
      )
      return run
    },

    waitForKernelApply(): Promise<void> {
      return kernelApply
    },

    markUiInstallerLaunched(): void {
      uiInstallerLaunched = true
    },

    hasUiInstallerLaunched(): boolean {
      return uiInstallerLaunched
    },
  }
}

/** The process-wide order; the installers share it. */
export const updateOrder = createUpdateOrder()
