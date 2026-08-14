/**
 * 浏览器侧访问 host 预设数据的封装。
 *
 * host 半在 `ctx.webServer` 注册了 `/prompt-manager/api`（JSON RPC），
 * 浏览器同源 fetch 即可，无需任何专用 RPC 通道。
 */

export interface PresetSummary {
  name: string
  description?: string
}

export interface PresetDetail extends PresetSummary {
  content: string
}

/** 一本已导入世界书的视图（设置页主列表项）。 */
export interface WorldView {
  name: string
  worldPreset: string
  writingPreset: string
  entries: number
  documentPath: string
  activeMode: 'world' | 'writing' | null
}

interface ApiReply {
  ok: boolean
  data?: unknown
  error?: string
}

async function callApi(payload: Record<string, unknown>): Promise<ApiReply> {
  const response = await fetch('/prompt-manager/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`prompt-manager API responded ${String(response.status)}`)
  const reply = await response.json() as ApiReply
  if (!reply.ok) throw new Error(reply.error ?? 'unknown prompt-manager API error')
  return reply
}

function dataOf(reply: ApiReply): Record<string, unknown> {
  return reply.data as Record<string, unknown>
}

export async function listPresets(): Promise<{ active: string | null; presets: PresetSummary[] }> {
  const reply = await callApi({ op: 'list' })
  return dataOf(reply) as unknown as { active: string | null; presets: PresetSummary[] }
}

export async function getPreset(name: string): Promise<PresetDetail> {
  const reply = await callApi({ op: 'get', name })
  return dataOf(reply) as unknown as PresetDetail
}

export async function usePreset(name: string): Promise<void> {
  await callApi({ op: 'use', name })
}

export async function deactivatePreset(): Promise<void> {
  await callApi({ op: 'off' })
}

export async function upsertPreset(input: { name: string; content: string; description?: string }): Promise<{ created: boolean }> {
  const reply = await callApi({ op: 'upsert', ...input })
  return dataOf(reply) as unknown as { created: boolean }
}

export async function removePreset(name: string): Promise<void> {
  await callApi({ op: 'remove', name })
}

export async function importTavern(path: string, name?: string): Promise<{ preset: string; created: boolean }> {
  const reply = await callApi({ op: 'importTavern', path, ...(name !== undefined ? { name } : {}) })
  return dataOf(reply) as unknown as { preset: string; created: boolean }
}

export async function importWorld(path: string, name?: string, activate = false): Promise<{ preset: string; entries: number; activated: boolean }> {
  const reply = await callApi({
    op: 'importWorld',
    path,
    ...(name !== undefined ? { name } : {}),
    ...(activate ? { activate: true } : {}),
  })
  return dataOf(reply) as unknown as { preset: string; entries: number; activated: boolean }
}

export async function importRegex(path: string, name?: string): Promise<{ preset: string; scripts: number }> {
  const reply = await callApi({ op: 'importRegex', path, ...(name !== undefined ? { name } : {}) })
  return dataOf(reply) as unknown as { preset: string; scripts: number }
}

/** 世界书列表（含双预设名、条目数、本地文档路径与激活模式）。 */
export async function listWorlds(): Promise<{ active: string | null; worlds: WorldView[] }> {
  const reply = await callApi({ op: 'worlds' })
  return dataOf(reply) as unknown as { active: string | null; worlds: WorldView[] }
}

/** 删除整组世界书（世界书预设 + 创作预设 + 本地文档）。 */
export async function removeWorld(name: string): Promise<void> {
  await callApi({ op: 'removeWorld', name })
}

/** 用系统默认程序打开世界书本地设定文档（worldbooks/<名>.md，供编辑）。 */
export async function openWorldDocument(name: string): Promise<{ opened: string }> {
  const reply = await callApi({ op: 'openDocument', name })
  return dataOf(reply) as unknown as { opened: string }
}
