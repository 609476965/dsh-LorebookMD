/**
 * tsdown 构建配置：复用 DSH 仓库的 clientBundle 预设（packages/client/tsdown.client.ts）。
 *
 * 产出：
 * - lib/index.js   —— host 半（node），本工程直接以 src 运行，此产物仅作发布备选
 * - lib/client.js  —— 浏览器半 bundle（closure factory，external 走平台模块表），
 *                     由 dsh-client-modules 经 exports["./client"] 供给到 /plugins/dsh-lorebookmd/client.js
 */
import { clientBundle } from '../../deepseek-harness/packages/client/tsdown.client.ts'

// node 半运行时依赖：全部由 DSH profile 运行时提供，必须 external，
// 避免打包进 lib/index.js 造成重复实例（Service/Context instanceof 冲突）。
const HOST_EXTERNALS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/schemastery',
]

export default clientBundle('dsh-lorebookmd', ['src/index.ts'], {
  lib: { external: HOST_EXTERNALS },
})
