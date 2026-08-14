/**
 * tsdown 构建配置：复用 DSH 仓库的 clientBundle 预设（packages/client/tsdown.client.ts）。
 *
 * 产出：
 * - lib/index.js   —— host 半（node），本工程直接以 src 运行，此产物仅作发布备选
 * - lib/client.js  —— 浏览器半 bundle（closure factory，external 走平台模块表），
 *                     由 dsh-client-modules 经 exports["./client"] 供给到 /plugins/dsh-LorebookMD/client.js
 */
import { clientBundle } from '../../deepseek-harness/packages/client/tsdown.client.ts'

export default clientBundle('dsh-LorebookMD', ['src/index.ts'])
