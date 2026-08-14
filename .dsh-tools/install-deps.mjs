/**
 * 安装辅助脚本：重建 dsh-LorebookMD 的 node_modules 依赖链。
 *
 * 工程位于 DSH 仓库之外，`@deepseek-ai/*` 由 Node 从插件文件位置向上解析。
 * 这里用 junction（目录联接，无需管理员权限）指回本地 DSH 仓库的已构建包；
 * 传递依赖沿真实路径回落到仓库内各包 node_modules，无需联网安装。
 *
 * 用法：node .dsh-tools/install-deps.mjs
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..') // dsh-LorebookMD
const repo = resolve(here, '../../../deepseek-harness') // 本地 DSH 仓库
const modules = join(root, 'node_modules')

/** [相对链接路径, 仓库内目标] */
const LINKS = [
  ['@deepseek-ai/cordis', 'vendor/cordis'],
  ['@deepseek-ai/dsh-tools', 'packages/core/tools'],
  ['@deepseek-ai/schemastery', 'vendor/schemastery'],
  ['@deepseek-ai/dsh-home-paths', 'packages/util/home-paths'],
  ['@deepseek-ai/dsh-host-webserver', 'packages/host/webserver'],
  ['@deepseek-ai/dsh-client-runtime', 'packages/client/runtime'],
  ['@deepseek-ai/dsh-client-ui-slots', 'packages/client/ui-slots'],
  ['@deepseek-ai/dsh-client-ui-settings', 'packages/client/ui-settings'],
  ['@deepseek-ai/dsh-llm', 'packages/llm/llm'],
  ['@deepseek-ai/dsh-agent', 'packages/core/agent'],
  ['react', 'node_modules/.pnpm/react@18.3.1/node_modules/react'],
  ['@types/react', 'node_modules/.pnpm/@types+react@18.3.31/node_modules/@types/react'],
  ['typescript', 'node_modules/typescript'],
  ['@types/node', 'node_modules/@types/node'],
]

let failed = 0
for (const [link, target] of LINKS) {
  const linkPath = join(modules, link)
  const targetPath = resolve(repo, target)
  if (!existsSync(targetPath)) {
    console.error(`[install-deps] target missing: ${targetPath}`)
    failed += 1
    continue
  }
  mkdirSync(dirname(linkPath), { recursive: true })
  try {
    // 清理可能存在的旧链接/目录
    execFileSync('cmd', ['/c', 'rmdir', '/S', '/Q', linkPath], { stdio: 'ignore' })
  } catch {
    // 不存在时忽略
  }
  try {
    execFileSync('cmd', ['/c', 'mklink', '/J', linkPath, targetPath], { stdio: 'inherit' })
    console.log(`linked ${link} -> ${target}`)
  } catch (error) {
    console.error(`[install-deps] failed to link ${link}: ${String(error)}`)
    failed += 1
  }
}

if (failed > 0) {
  console.error(`[install-deps] ${failed} link(s) failed`)
  process.exit(1)
}
console.log('[install-deps] done')
