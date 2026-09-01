import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'src/renderer/src/assets/vespi-app-icon.png')
const outDir = join(root, 'resources/icons')
const require = createRequire(import.meta.url)
const electronPath = require('electron')
const toIco = (await import('to-ico')).default

const worker = `
const { app, nativeImage } = require('electron')
const { readFileSync, writeFileSync } = require('fs')
const source = process.argv[1]
const outDir = process.argv[2]
const sizes = [16, 32, 48, 64, 128, 256, 512]
app.whenReady().then(() => {
  const image = nativeImage.createFromBuffer(readFileSync(source))
  const pngs = []
  for (const size of sizes) {
    const png = image.resize({ width: size, height: size, quality: 'best' }).toPNG()
    writeFileSync(require('path').join(outDir, 'icon-' + size + '.png'), png)
    pngs.push({ size, png: png.toString('base64') })
  }
  writeFileSync(require('path').join(outDir, 'sizes.json'), JSON.stringify(pngs))
  app.quit()
})
`

const workerPath = join(outDir, '_icon-worker.cjs')
writeFileSync(workerPath, worker)
const result = spawnSync(electronPath, [workerPath, source, outDir], {
  encoding: 'utf8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
})
if (result.status !== 0) {
  console.error(result.stdout)
  console.error(result.stderr)
  process.exit(result.status ?? 1)
}

const pngs = JSON.parse(readFileSync(join(outDir, 'sizes.json'), 'utf8')).map((item) => ({
  size: item.size,
  png: Buffer.from(item.png, 'base64'),
}))
writeFileSync(join(outDir, 'icon.png'), pngs.find((item) => item.size === 256).png)
writeFileSync(join(outDir, 'icon.ico'), await toIco(
  [16, 32, 48, 256].map((size) => pngs.find((item) => item.size === size).png),
))
console.log('wrote', pngs.map((item) => `icon-${item.size}.png`).join(', '), 'icon.png, icon.ico')
