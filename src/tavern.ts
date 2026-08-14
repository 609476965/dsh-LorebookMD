/**
 * 酒馆（SillyTavern / TavernAI）角色卡与世界书/正则解析与转换。
 *
 * 支持三种输入：
 * - PNG 角色卡：PNG 的 tEXt chunk 中 keyword 为 "chara" 的数据，
 *   值为 base64 编码的 JSON（兼容未编码的直接 JSON 文本）
 * - JSON 角色卡：chara_card_v2 格式（{ spec, data }）或旧版字段直接置顶的格式；
 *   卡内 `data.extensions.world`（世界书）与 `extensions.regex_scripts`/`regex`（正则）一并提取
 * - 独立世界书 / 正则 JSON 文件（`{ entries: [...] }` / 脚本数组）
 *
 * 纯函数、无文件系统耦合（接收 Buffer / 文本），便于单元测试。
 */

export interface TavernCharacterFields {
  name?: string
  description?: string
  personality?: string
  scenario?: string
  first_mes?: string
  mes_example?: string
  system_prompt?: string
  post_history_instructions?: string
  creator?: string
  creator_notes?: string
  character_version?: string
  tags?: string[]
  alternate_greetings?: string[]
}

export interface TavernParseResult {
  /** 输入格式：png-embed（PNG 内嵌）或 json（独立 JSON 文件）。 */
  kind: 'png-embed' | 'json'
  /** 角色卡 spec 版本（如 chara_card_v2）；旧版无 spec。 */
  spec?: string
  data: TavernCharacterFields
  /** 卡内 world 设定（extensions.world）。 */
  world?: WorldInfo
  /** 卡内正则脚本（extensions.regex_scripts / extensions.regex）。 */
  regexScripts?: RegexScript[]
}

// --- 世界书 ---

export interface WorldEntry {
  /** 触发词（主）。 */
  keys: string[]
  /** 次级触发词（selective 条目用，此处按主 keys 匹配）。 */
  secondaryKeys?: string[]
  comment?: string
  content: string
  /** 常驻条目：不依赖触发词，总是注入。 */
  constant?: boolean
  selective?: boolean
  enabled?: boolean
  caseSensitive?: boolean
  matchWholeWords?: boolean
  useRegex?: boolean
  order?: number
}

export interface WorldInfo {
  name?: string
  entries: WorldEntry[]
}

export interface RegexScript {
  scriptName?: string
  findRegex?: string
  replaceString?: string
  placement?: string[]
  disabled?: boolean
  markdownOnly?: boolean
  promptOnly?: boolean
  runOnEdit?: boolean
  flags?: string
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)
}

/** 解析角色卡文件内容（PNG 或 JSON），含内置世界书与正则。 */
export function parseTavernFile(buffer: Buffer): TavernParseResult {
  if (isPng(buffer)) {
    const text = readPngCharaText(buffer)
    if (text === undefined) {
      throw new Error('PNG 中找不到角色卡数据（无 keyword 为 "chara" 的 tEXt chunk）')
    }
    return { kind: 'png-embed', ...parseCharaJson(text) }
  }
  const raw = buffer.toString('utf8').trim()
  if (raw === '') throw new Error('文件为空')
  return { kind: 'json', ...parseCharaJson(raw) }
}

/** 解析独立世界书 JSON 文本：顶层 `{ entries: [...] }`（兼容 `{ entries: { key: … } }` 与纯数组）。 */
export function parseWorldInfoJson(text: string): WorldInfo {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(`无法解析世界书 JSON：${String(error)}`)
  }
  if (Array.isArray(json)) return parseWorldObject({ entries: json })
  return parseWorldObject(json)
}

/** 解析独立正则脚本 JSON 文本：顶层数组（或 `{ scripts: [...] }`）。 */
export function parseRegexScriptsJson(text: string): RegexScript[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(`无法解析正则脚本 JSON：${String(error)}`)
  }
  if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
    const scripts = (json as Record<string, unknown>).scripts
    if (scripts !== undefined) return parseRegexArray(scripts)
  }
  return parseRegexArray(json)
}

/** 从角色卡中提取一句展示用描述（供预设 description 使用）。 */
export function describeTavernCard(parsed: TavernParseResult): string {
  const parts = [`Imported from Tavern card "${parsed.data.name ?? 'unnamed'}" (${parsed.kind}`]
  if (parsed.spec !== undefined) parts.push(parsed.spec)
  parts[parts.length - 1] += ')'
  if (parsed.data.creator !== undefined) parts.push(`by ${parsed.data.creator}`)
  if (parsed.data.tags !== undefined && parsed.data.tags.length > 0) parts.push(`tags: ${parsed.data.tags.join(', ')}`)
  return parts.join('; ')
}

/** 把角色卡字段拼成提示词预设正文（只含非空字段；name 用于首行的角色声明）。 */
export function composeTavernContent(data: TavernCharacterFields, name: string): string {
  const sections: Array<[string, string | undefined]> = [
    ['Description', data.description],
    ['Personality', data.personality],
    ['Scenario', data.scenario],
    ['First message', data.first_mes],
    ['Example messages', data.mes_example],
    ['System prompt', data.system_prompt],
    ['Post-history instructions', data.post_history_instructions],
  ]
  if (data.alternate_greetings !== undefined && data.alternate_greetings.length > 0) {
    sections.push(['Alternate greetings', data.alternate_greetings.join('\n\n---\n\n')])
  }
  const body = sections
    .filter(([, value]) => value !== undefined && value.trim() !== '')
    .map(([label, value]) => `[${label}]\n${value}`)
    .join('\n\n')
  const opening = `You are roleplaying as ${name}.`
  return body === '' ? opening : `${opening}\n\n${body}`
}

/** 世界书 → 组合预设正文（带触发词说明；constant 条目标 [始终生效]）。 */
export function composeWorldContent(world: WorldInfo, ownerName: string): string {
  const lines = [
    `[World Info: ${ownerName}]`,
    '以下为世界设定条目。仅当对话内容涉及条目的触发词时，才应用该条目的设定；标注 [始终生效] 的条目不受触发词限制，始终有效。',
  ]
  for (const entry of world.entries) {
    if (entry.enabled === false) continue
    const tags: string[] = []
    if (entry.constant === true) tags.push('始终生效')
    if (entry.selective === true) tags.push('选择性')
    const keys = entry.keys
    const heading = `### ${keys[0] ?? '(无触发词)'}${keys.length > 1 ? `（触发词：${keys.join('、')}）` : ''}${tags.length > 0 ? ` [${tags.join('/')}]` : ''}`
    lines.push('', heading)
    if (entry.comment !== undefined && entry.comment !== '') lines.push(`（${entry.comment}）`)
    lines.push(entry.content === '' ? '（条目无正文）' : entry.content)
  }
  return lines.join('\n')
}

/** 正则脚本 → 组合预设正文（定义说明；DSH 无聊天正则渲染管线）。 */
export function composeRegexContent(scripts: RegexScript[], ownerName: string): string {
  const lines = [
    `[Regex Scripts: ${ownerName}]`,
    '以下为 SillyTavern 正则脚本定义。DSH 没有聊天正则渲染管线，这些定义仅供查看与参考：如需对消息做等价清理/替换，请按定义的 pattern 手动执行。',
  ]
  for (const script of scripts) {
    if (script.disabled === true) continue
    lines.push('', `### ${script.scriptName ?? '(未命名)'}`)
    if (script.findRegex !== undefined) lines.push(`- pattern: ${script.findRegex}`)
    if (script.replaceString !== undefined) lines.push(`- replace: ${script.replaceString === '' ? '(删除匹配)' : script.replaceString}`)
    if (script.placement !== undefined && script.placement.length > 0) lines.push(`- placement: ${script.placement.join(', ')}`)
    if (script.flags !== undefined && script.flags !== '') lines.push(`- flags: ${script.flags}`)
    if (script.markdownOnly === true) lines.push('- 仅 Markdown 渲染')
    if (script.promptOnly === true) lines.push('- 仅提示词')
    if (script.runOnEdit === true) lines.push('- 编辑时执行')
  }
  return lines.join('\n')
}

/** 世界书组合预设名（激活它即开启该世界书的关键词触发）。 */
export function worldPresetName(ownerName: string): string {
  return `${ownerName}·世界书`
}

/** 创作模式预设名（激活它即进入"参考该世界书创作小说"模式）。 */
export function writingPresetName(ownerName: string): string {
  return `${ownerName}·创作`
}

/** 正则组合预设名。 */
export function regexPresetName(ownerName: string): string {
  return `${ownerName}·正则`
}

/**
 * 世界书 → 本地设定文档（Markdown，DSH/模型易读，保存到 worldbooks/<名>.md）。
 * 比组合预设更完整：带编号、触发词、注释与分节，适合作为创作参考素材。
 */
export function composeWorldDocument(world: WorldInfo, ownerName: string): string {
  const title = world.name !== undefined && world.name !== '' ? world.name : ownerName
  const lines = [
    `# 世界设定：${title}`,
    '',
    `> 来源角色卡/世界书：${ownerName}（${world.entries.length} 条设定条目）`,
    '> 创作小说时请严格参考以下设定；「始终生效」条目不受触发词限制。',
    '',
  ]
  let number = 0
  for (const entry of world.entries) {
    if (entry.enabled === false) continue
    number += 1
    const tags: string[] = []
    if (entry.constant === true) tags.push('始终生效')
    if (entry.selective === true) tags.push('选择性')
    const keys = entry.keys
    lines.push(`## ${String(number)}. ${keys[0] ?? '(无触发词)'}${tags.length > 0 ? `（${tags.join('/')}）` : ''}`)
    if (keys.length > 1) lines.push('', `触发词：${keys.join('、')}`)
    if (entry.comment !== undefined && entry.comment !== '') lines.push('', `> ${entry.comment}`)
    lines.push('', entry.content === '' ? '（条目无正文）' : entry.content, '')
  }
  return lines.join('\n')
}

/**
 * 创作模式预设正文：创作指令 + 世界设定全文。
 * 激活该预设后，模型根据用户输入、参考设定创作小说。
 */
export function composeWritingContent(worldDocument: string, ownerName: string): string {
  return [
    '[创作模式]',
    `你是小说创作助手，正基于世界设定《${ownerName}》进行创作。`,
    '规则：',
    '1. 严格参考下文世界设定：其中的规则、组织、人物关系与世界观必须被尊重，不得擅自违背或新增；',
    '2. 根据用户给出的输入（场景、情节、人物、事件），创作连贯、生动的小说正文，而不是对话式回复；',
    '3. 采用第三人称叙述，细节描写符合设定的风格基调；',
    '4. 设定条目带有触发词的，仅在与创作内容相关时参考对应条目；',
    '5. 直接输出正文：不要复述设定，不要解释创作过程，不要询问确认。',
    '',
    '—— 以下为世界设定全文 ——',
    '',
    worldDocument,
  ].join('\n')
}

/** 判断一条世界书条目是否应在本轮注入（触发词匹配；constant 常驻）。 */
export function matchWorldEntry(entry: WorldEntry, text: string): boolean {
  if (entry.enabled === false) return false
  if (entry.constant === true) return true
  if (entry.keys.length === 0) return false
  return entry.keys.some(key => keyMatches(key, text, entry))
}

/** 单条匹配条目的注入文本。 */
export function renderWorldEntry(entry: WorldEntry): string {
  const keys = entry.keys.join(',')
  return [
    `<world_info_entry${keys !== '' ? ` keys="${keys}"` : ''}>`,
    entry.content,
    '</world_info_entry>',
  ].join('\n')
}

// --- 内部实现 ---

function keyMatches(key: string, text: string, entry: WorldEntry): boolean {
  if (entry.useRegex === true) {
    try {
      const regex = new RegExp(key, entry.caseSensitive === true ? '' : 'i')
      return regex.test(text)
    } catch {
      return false
    }
  }
  const hay = entry.caseSensitive === true ? text : text.toLowerCase()
  const needle = entry.caseSensitive === true ? key : key.toLowerCase()
  const index = hay.indexOf(needle)
  if (index < 0) return false
  if (entry.matchWholeWords !== true) return true
  const before = index === 0 ? '' : hay[index - 1]
  const after = index + needle.length >= hay.length ? '' : hay[index + needle.length]
  return !isWordChar(before) && !isWordChar(after)
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch)
}

/** 遍历 PNG chunk，返回 keyword 为 "chara" 的 tEXt 块文本；找不到返回 undefined。 */
function readPngCharaText(buffer: Buffer): string | undefined {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) break // chunk 数据截断，停止遍历
    if (type === 'tEXt') {
      const data = buffer.subarray(dataStart, dataEnd)
      const nul = data.indexOf(0)
      if (nul > 0) {
        const keyword = data.subarray(0, nul).toString('latin1')
        if (keyword === 'chara') {
          return data.subarray(nul + 1).toString('latin1')
        }
      }
    }
    offset = dataEnd + 4 // 跳过 CRC
    if (type === 'IEND') break
  }
  return undefined
}

/** 解析角色卡 JSON 文本：兼容 base64 编码与直接 JSON，兼容 v2（{spec,data}）与旧版。 */
function parseCharaJson(text: string): {
  spec?: string
  data: TavernCharacterFields
  world?: WorldInfo
  regexScripts?: RegexScript[]
} {
  const attempts: Array<() => unknown> = [
    () => JSON.parse(text),
    () => JSON.parse(Buffer.from(text, 'base64').toString('utf8')),
  ]
  let json: unknown
  let lastError: unknown
  for (const attempt of attempts) {
    try {
      json = attempt()
      break
    } catch (error) {
      lastError = error
    }
  }
  if (json === undefined) {
    throw new Error(`无法解析角色卡 JSON：${String(lastError)}`)
  }
  return normalizeChara(json)
}

function normalizeChara(json: unknown): {
  spec?: string
  data: TavernCharacterFields
  world?: WorldInfo
  regexScripts?: RegexScript[]
} {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('角色卡 JSON 必须是对象')
  }
  const root = json as Record<string, unknown>
  // chara_card_v2/v3：{ spec, data: {...} }
  const rawData = typeof root.spec === 'string' && typeof root.data === 'object' && root.data !== null
    ? root.data as Record<string, unknown>
    : root
  const data = pickFields(rawData)
  const result: { spec?: string; data: TavernCharacterFields; world?: WorldInfo; regexScripts?: RegexScript[] } = {
    ...(typeof root.spec === 'string' ? { spec: root.spec } : {}),
    data,
  }

  // 1) extensions.world（标准内嵌世界书）与 regex 脚本。
  //    容错：world 可能是名字字符串 / null（部分工具仅存名字引用，条目另在
  //    character_book），此时不抛错、不产出条目。
  const extensions = rawData.extensions
  if (extensions !== null && typeof extensions === 'object') {
    const ext = extensions as Record<string, unknown>
    const worldValue = ext.world
    if (worldValue !== null && typeof worldValue === 'object' && !Array.isArray(worldValue)) {
      try {
        result.world = mergeWorlds(result.world, parseWorldObject(worldValue))
      } catch {
        // 结构异常时忽略该来源，不阻塞整卡导入
      }
    }
    const regexRaw = ext.regex_scripts ?? ext.regex ?? ext.regexScripts
    if (Array.isArray(regexRaw)) {
      try {
        result.regexScripts = parseRegexArray(regexRaw)
      } catch {
        // 同上
      }
    }
  }

  // 2) character_book（SillyTavern 角色书，等价角色卡内嵌世界书），与上面合并。
  const book = rawData.character_book
  if (book !== null && typeof book === 'object' && !Array.isArray(book)) {
    try {
      const parsedBook = parseWorldObject(book)
      if (parsedBook.entries.length > 0) result.world = mergeWorlds(result.world, parsedBook)
    } catch {
      // 结构异常时忽略
    }
  }

  return result
}

/** 合并两个世界书来源（extensions.world 优先保留名字；条目拼接）。 */
function mergeWorlds(a: WorldInfo | undefined, b: WorldInfo): WorldInfo {
  if (a === undefined) return b
  return { name: a.name ?? b.name, entries: [...a.entries, ...b.entries] }
}

function pickFields(raw: Record<string, unknown>): TavernCharacterFields {
  const str = (key: string): string | undefined =>
    typeof raw[key] === 'string' && (raw[key] as string).length > 0 ? raw[key] as string : undefined
  const strings = (key: string): string[] | undefined => {
    const value = raw[key]
    if (!Array.isArray(value)) return undefined
    const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    return items.length > 0 ? items : undefined
  }
  return {
    name: str('name'),
    description: str('description'),
    personality: str('personality'),
    scenario: str('scenario'),
    first_mes: str('first_mes'),
    mes_example: str('mes_example'),
    system_prompt: str('system_prompt'),
    post_history_instructions: str('post_history_instructions'),
    creator: str('creator'),
    creator_notes: str('creator_notes'),
    character_version: str('character_version'),
    tags: strings('tags'),
    alternate_greetings: strings('alternate_greetings'),
  }
}

function parseWorldObject(value: unknown): WorldInfo {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('世界书必须是对象')
  }
  const root = value as Record<string, unknown>
  // 兼容顶层就是条目数组的形态
  const entriesRaw = root.entries ?? root
  const entries: WorldEntry[] = []
  if (Array.isArray(entriesRaw)) {
    for (const item of entriesRaw) {
      if (item === null || typeof item !== 'object') continue
      const entry = pickWorldEntry(item as Record<string, unknown>)
      if (entry !== undefined) entries.push(entry)
    }
  } else if (typeof entriesRaw === 'object' && entriesRaw !== null) {
    for (const item of Object.values(entriesRaw)) {
      if (item === null || typeof item !== 'object') continue
      const entry = pickWorldEntry(item as Record<string, unknown>)
      if (entry !== undefined) entries.push(entry)
    }
  } else {
    throw new Error('世界书 entries 必须是数组或对象')
  }
  entries.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return {
    ...(typeof root.name === 'string' && root.name !== '' ? { name: root.name } : {}),
    entries,
  }
}

function pickWorldEntry(raw: Record<string, unknown>): WorldEntry | undefined {
  const keys = stringArray(raw.keys)
  const content = typeof raw.content === 'string' ? raw.content : ''
  if (keys.length === 0 && content === '') return undefined
  const entry: WorldEntry = { keys, content }
  const secondaryKeys = stringArray(raw.secondary_keys)
  if (secondaryKeys.length > 0) entry.secondaryKeys = secondaryKeys
  if (typeof raw.comment === 'string' && raw.comment !== '') entry.comment = raw.comment
  if (raw.constant === true) entry.constant = true
  if (raw.selective === true) entry.selective = true
  if (raw.enabled === false) entry.enabled = false
  if (raw.case_sensitive === true) entry.caseSensitive = true
  if (raw.match_whole_words === true) entry.matchWholeWords = true
  if (raw.use_regex === true) entry.useRegex = true
  if (typeof raw.insertion_order === 'number') entry.order = raw.insertion_order
  return entry
}

function parseRegexArray(value: unknown): RegexScript[] {
  if (!Array.isArray(value)) throw new Error('正则脚本必须是数组')
  const scripts: RegexScript[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const script: RegexScript = {}
    if (typeof raw.scriptName === 'string' && raw.scriptName !== '') script.scriptName = raw.scriptName
    if (typeof raw.findRegex === 'string' && raw.findRegex !== '') script.findRegex = raw.findRegex
    if (typeof raw.replaceString === 'string') script.replaceString = raw.replaceString
    const placement = (Array.isArray(raw.placement) ? raw.placement.filter((p): p is string => typeof p === 'string') : undefined)
    if (placement !== undefined && placement.length > 0) script.placement = placement
    if (raw.disabled === true) script.disabled = true
    if (raw.markdownOnly === true) script.markdownOnly = true
    if (raw.promptOnly === true) script.promptOnly = true
    if (raw.runOnEdit === true) script.runOnEdit = true
    if (typeof raw.flags === 'string' && raw.flags !== '') script.flags = raw.flags
    scripts.push(script)
  }
  return scripts
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}
