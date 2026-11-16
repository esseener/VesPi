import { ipcMain, Notification, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { assertTrustedSender, isString, isObject } from './validation'
import type { IpcContext } from './context'
import { loadAppSettings } from './settings'
import { terminalRuntimeOptions } from './terminal-runtime-options'
import { isWithinSessionRoots } from '../pi-paths'

export function registerTerminalHandlers(ctx: IpcContext): void {
  const { workspaceManager, terminalService, broadcast } = ctx

  // ─── Terminal ──────────────────────────────────────────────────────────
  let lastCompletion = { pid: 0, count: 0 }
  ipcMain.handle(IPC_CHANNELS.TERMINAL_STATE, (event) => {
    assertTrustedSender(event)
    const state = terminalService.getSessionState()
    const pid = terminalService.getPid() ?? 0
    if (state && lastCompletion.pid === pid && state.completed > lastCompletion.count) {
      void loadAppSettings(workspaceManager).then(settings => {
        if (settings.desktopNotifications && !BrowserWindow.getFocusedWindow() && Notification.isSupported()) {
          new Notification({ title: 'VesPi · OMP', body: settings.language === 'zh' ? '当前任务已完成' : 'Current task completed' }).show()
        }
      }).catch(console.error)
    }
    lastCompletion = { pid, count: state?.completed ?? 0 }
    return {
      running: terminalService.isRunning(), cwd: terminalService.getCwd(), pid: terminalService.getPid(),
      sessionPath: null, model: null, thinkingLevel: null, busy: false, completed: 0,
      ...state,
    }
  })

  ipcMain.handle(IPC_CHANNELS.TERMINAL_START, async (event, options: unknown) => {
    assertTrustedSender(event)
    const opts = isObject(options) ? options : {}
    const settings = await loadAppSettings(workspaceManager)
    const cwd = isString(opts.cwd) ? opts.cwd : workspaceManager.getActiveWorkspace()?.path ?? process.cwd()
    return terminalService.start(
      {
        cwd,
        cols: typeof opts.cols === 'number' ? opts.cols : undefined,
        rows: typeof opts.rows === 'number' ? opts.rows : undefined,
      },
      (data) => broadcast(IPC_CHANNELS.EVENT_TERMINAL_DATA, data),
      (event) => broadcast(IPC_CHANNELS.EVENT_TERMINAL_EXIT, event),
      undefined,
      { ...terminalRuntimeOptions(settings, cwd), continueSession: settings.resumeLastSession }
    )
  })

  ipcMain.handle(IPC_CHANNELS.TERMINAL_INPUT, async (event, data: unknown) => {
    assertTrustedSender(event)
    if (!isString(data)) throw new Error('terminal input must be a string')
    terminalService.write(data)
  })

  ipcMain.handle(IPC_CHANNELS.TERMINAL_RESIZE, async (event, size: unknown) => {
    assertTrustedSender(event)
    if (!isObject(size)) throw new Error('terminal size must be an object')
    const cols = typeof size.cols === 'number' ? size.cols : 80
    const rows = typeof size.rows === 'number' ? size.rows : 24
    terminalService.resize(cols, rows)
  })

  ipcMain.handle(IPC_CHANNELS.TERMINAL_STOP, async (event) => {
    assertTrustedSender(event)
    terminalService.stop()
  })

  ipcMain.handle(IPC_CHANNELS.TERMINAL_RESTART, async (event, resumeSessionPath?: unknown) => {
    assertTrustedSender(event)
    const current = terminalService.getSessionState()
    const path = typeof resumeSessionPath === 'string' && resumeSessionPath ? resumeSessionPath : current?.sessionPath ?? null
    if (path && !isWithinSessionRoots(path)) throw new Error('Session path is outside the session store')
    const settings = await loadAppSettings(workspaceManager)
    const runtime = terminalRuntimeOptions(settings, terminalService.getCwd())
    const result = await terminalService.restart({ ...runtime, model: current?.model ?? runtime.model, resumeSessionPath: path, continueSession: false })
    if (result) broadcast(IPC_CHANNELS.EVENT_TERMINAL_RESTARTED, { resumed: Boolean(path) })
    return { ok: Boolean(result) }
  })
}
