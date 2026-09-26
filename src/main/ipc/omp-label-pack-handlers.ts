/**
 * IPC: get / rebuild OMP label pack; load into renderer via omp-labels.ts
 */
import type { IpcMain } from 'electron'
import { ensureLaya } from '../laya-ensure'
import { rebuildOmpLabelPack, readOrSeedPack, loadPackFile } from '../omp-label-pack'

export function registerOmpLabelPackHandlers(ipcMain: IpcMain): void {
  // 自动：启动后尽力装好 Laya 并写一版译包（失败则仍用内置中文表）
  void ensureLaya()
    .then(() => rebuildOmpLabelPack('auto'))
    .catch(() => readOrSeedPack('auto'))

  ipcMain.handle('omp:labels:get', async () => {
    return loadPackFile() ?? readOrSeedPack('')
  })
  ipcMain.handle('omp:labels:rebuild', async (_e, kernelVersion: string) => {
    return rebuildOmpLabelPack(String(kernelVersion ?? ''))
  })
  ipcMain.handle('omp:labels:status', async () => {
    const py = await ensureLaya()
    return {
      layaReady: Boolean(py),
      hasPack: Boolean(loadPackFile()),
      note: py
        ? 'Laya 就绪，可在升级时自动择优译名'
        : '未检测到本机 Python/Laya venv，暂用内置中文词表',
    }
  })
}
