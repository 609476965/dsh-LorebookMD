/**
 * prompt-manager 的浏览器半（client 插件）。
 *
 * 在 DSH 设置里注册一个「世界书创作」分区（settings.section slot），
 * 页面数据通过同源 fetch 访问 host 半注册的 `/prompt-manager/api`。
 *
 * 依赖链：本包声明 `dsh.client`（package.json），由 dsh-client-modules
 * 扫描进 boot 图，浏览器端经 loader 挂载；`inject: ['slots']` 等待
 * slot 注册表服务。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// 类型合并：settings.section slot 契约（SlotsRegistry 类型与 ctx.slots 服务）。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

import { PresetsSection } from './PresetsSection.tsx'

export const name = 'prompt-manager-client'
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'prompt-presets',
    order: 25,
    label: () => '世界书创作',
  }, PresetsSection))
}
