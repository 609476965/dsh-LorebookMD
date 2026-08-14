/**
 * tsdown 启动 shim：定位本地 DSH 仓库 node_modules/.pnpm 里的 tsdown，
 * 以插件目录为 cwd 转发调用（构建 lib/client.js 客户端 bundle）。
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pnpmRoot = resolve(here, '../../../../deepseek-harness/node_modules/.pnpm')

const candidates = readdirSync(pnpmRoot).filter(name => name.startsWith('tsdown@'))
if (candidates.length === 0) {
  throw new Error(`tsdown not found under ${pnpmRoot}`)
}
const bin = join(pnpmRoot, candidates[0], 'node_modules/tsdown/dist/run.mjs')

const result = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], {
  cwd: resolve(here, '../..'),
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
