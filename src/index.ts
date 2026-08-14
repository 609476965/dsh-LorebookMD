/**
 * prompt-manager — DSH 提示词预设管理器插件。
 *
 * 集中管理提示词预设（增删改查），并把当前激活的预设注入系统提示词：
 * - 预设数据存于 JSON 文件（默认 `~/.dsh/dsh-LorebookMD/presets.json`，`Config.dataDir` 可覆盖）
 * - `systemPrompt.section()` 的 text 用求值函数读取当前激活预设——
 *   切换/修改后对下一轮对话立即生效，无需重新加载插件
 * - 提供 prompt_preset_* 工具，对话中随时：列出 / 激活 / 停用 / 保存(新建或修改) / 删除
 * - 监听数据文件变化：直接编辑 JSON 文件也会热载入
 *
 * 用法示例（对话中直接说）：
 *   "列出所有提示词预设"            → prompt_preset_list
 *   "切换到 story 预设"             → prompt_preset_use
 *   "停用提示词预设"                → prompt_preset_off
 *   "把这段保存为预设 roleplay：…"  → prompt_preset_save
 *   "导入 C:/cards/xxx.png 角色卡"  → prompt_import_tavern（酒馆角色卡 PNG/JSON）
 */

import { watch, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
// 类型合并：ctx.webServer（WebServer 服务）与 WebRoute 类型。
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'

import { PresetRepo, type PresetFile, type PresetIo, type RepoResult } from './preset-repo.ts'
import {
  composeRegexContent, composeTavernContent, composeWorldContent, composeWorldDocument,
  composeWritingContent, describeTavernCard, matchWorldEntry, parseRegexScriptsJson,
  parseTavernFile, parseWorldInfoJson, regexPresetName, renderWorldEntry, worldPresetName,
  writingPresetName, type WorldInfo,
} from './tavern.ts'

export const name = 'prompt-manager'
export const inject = ['tools', 'systemPrompt', 'webServer']

export interface Config {
  /** 预设数据目录（支持 `~` 展开；默认 `~/.dsh/dsh-LorebookMD`）。 */
  dataDir: string
  /** 系统提示词 section 名（唯一，勿与其他插件冲突）。 */
  sectionName: string
  /** 系统提示词 section 排序权重（越小越靠前）。 */
  sectionOrder: number
  /** 是否注册 prompt_preset_* 工具。 */
  enableTools: boolean
  /** 是否监听数据文件变化并热载入。 */
  watchFile: boolean
  /** 世界书关键词自动触发（激活世界书预设后，按触发词把匹配条目注入本轮）。 */
  worldTrigger: boolean
}

export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string().default(dshHomePath('dsh-LorebookMD')),
  sectionName: Schema.string().default('prompt-manager:active'),
  sectionOrder: Schema.number().default(95),
  enableTools: Schema.boolean().default(true),
  watchFile: Schema.boolean().default(true),
  worldTrigger: Schema.boolean().default(true),
})

export function apply(ctx: Context, config: Config) {
  const dataDir = expandHomePath(config.dataDir)
  const dataFile = join(dataDir, 'presets.json')
  const worldbooksFile = join(dataDir, 'worldbooks.json')
  mkdirSync(dataDir, { recursive: true })
  const repo = new PresetRepo(createFileIo(dataFile))
  const worldbooks = new Map<string, WorldInfo>(loadWorldbooks(worldbooksFile))

  // 1) 注入当前激活预设。text 是求值函数：每次组装系统提示词时读取最新状态，
  //    因此切换 / 修改无需重新注册 section，下一轮对话即生效。
  //    内容中的 {{变量}} 占位符先清理（见 sanitizePromptVariables），避免 DSH
  //    渲染器对 SillyTavern 占位符（{{user}} 等）报"unknown prompt variable"。
  ctx.systemPrompt.section({
    name: config.sectionName,
    order: config.sectionOrder,
    text: () => {
      const active = repo.active
      if (active === null) return ''
      const content = repo.contentOf(active)
      return content === undefined ? '' : sanitizePromptVariables(content, active)
    },
  })

  // 1b) 世界书关键词自动触发：激活的预设是世界书时，把触发词命中的条目注入本轮
  if (config.worldTrigger) {
    registerWorldTrigger(ctx, repo, worldbooks)
  }

  // 2) 管理工具（对话中随时切换与修改）
  if (config.enableTools) {
    registerTools(ctx, repo, worldbooks, worldbooksFile, dataDir)
  }

  // 2b) 浏览器设置页的数据通道：/prompt-manager/api（JSON RPC，同源 fetch）
  registerApiRoute(ctx, repo, worldbooks, worldbooksFile, dataDir)

  // 3) 数据文件热载入：直接改 JSON 文件，防抖后自动 reload
  if (config.watchFile) {
    let debounce: ReturnType<typeof setTimeout> | undefined
    const watcher = watch(dataDir, { persistent: false }, (_event, filename) => {
      if (filename !== basename(dataFile)) return
      if (debounce !== undefined) clearTimeout(debounce)
      debounce = setTimeout(() => {
        repo.reload()
        ctx.emit('system-prompt/change')
        console.log(`[prompt-manager] ${basename(dataFile)} changed on disk; reloaded`)
      }, 200)
    })
    ctx.effect(() => {
      return () => {
        if (debounce !== undefined) clearTimeout(debounce)
        watcher.close()
      }
    })
  }

  console.log(`[prompt-manager] ready: ${dataFile} (active=${repo.active ?? 'none'})`)
}

function registerTools(
  ctx: Context,
  repo: PresetRepo,
  worldbooks: Map<string, WorldInfo>,
  worldbooksFile: string,
  dataDir: string,
): void {
  ctx.tools.register(defineTool({
    name: 'prompt_preset_list',
    description:
      'List every prompt preset managed by prompt-manager and which one is currently active. '
      + 'Call this before prompt_preset_use, prompt_preset_save, or prompt_preset_delete.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      return { active: repo.active, presets: repo.list().presets } as unknown as JsonValue
    },
  }))

  ctx.tools.register(defineTool({
    name: 'prompt_preset_use',
    description:
      'Activate a prompt preset by exact name. Its content becomes part of the system prompt '
      + 'from the next turn. Use prompt_preset_off to deactivate.',
    parameters: {
      name: { type: 'string', required: true, description: 'Exact preset name from prompt_preset_list.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = repo.use(args.name)
      if (!result.ok) throw new Error(result.message)
      ctx.emit('system-prompt/change')
      return `Active preset: ${args.name}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'prompt_preset_off',
    description: 'Deactivate the active prompt preset. The system prompt returns to its base form.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      repo.off()
      ctx.emit('system-prompt/change')
      return 'Prompt preset deactivated'
    },
  }))

  ctx.tools.register(defineTool({
    name: 'prompt_preset_save',
    description:
      'Create a new prompt preset or replace (edit) an existing one with the same name. '
      + 'Content is stored verbatim and, when this preset is active, injected into the system prompt.',
    parameters: {
      name: { type: 'string', required: true, description: 'Preset name; reuse an existing name to edit it.' },
      content: { type: 'string', required: true, description: 'Full prompt text to store.' },
      description: { type: 'string', description: 'Optional one-line note shown in prompt_preset_list.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = repo.upsert({ name: args.name, content: args.content, description: args.description })
      if (!result.ok) throw new Error(result.message)
      ctx.emit('system-prompt/change')
      return result.created ? `Created preset "${args.name}"` : `Updated preset "${args.name}"`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'prompt_preset_delete',
    description:
      'Permanently delete a prompt preset. If it was active, the system prompt returns to its base form.',
    parameters: {
      name: { type: 'string', required: true, description: 'Exact preset name from prompt_preset_list.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = removePresetAndWorld(repo, worldbooks, worldbooksFile, args.name)
      if (!result.ok) throw new Error(result.message)
      ctx.emit('system-prompt/change')
      return `Deleted preset "${args.name}"`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'prompt_import_tavern',
    description:
      'Import a Tavern/SillyTavern character card as a prompt preset. Accepts a .png character card '
      + '(with embedded "chara" JSON) or a .json character card (chara_card_v2 or legacy format). '
      + 'The card\'s description, personality, scenario, first message, example messages, system prompt, '
      + 'post-history instructions, and alternate greetings are composed into the preset content. '
      + 'When the card carries a world info book (extensions.world) or regex scripts, they are imported '
      + 'as additional presets named "<name>·世界书" and "<name>·正则"; activating the world preset '
      + 'enables keyword-triggered entry injection. Use an absolute file path; pass name to override '
      + 'the preset name.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path to the character card file (.png or .json).' },
      name: { type: 'string', description: 'Preset name override; defaults to the character card name.' },
      withWorld: { type: 'boolean', description: 'Import the card\'s world info book as a preset (default true).' },
      withRegex: { type: 'boolean', description: 'Import the card\'s regex scripts as a preset (default true).' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const parsed = readTavernFile(args.path)
      const presetName = (args.name ?? parsed.data.name ?? '').trim()
      if (presetName === '') {
        throw new Error('character card has no name; pass the name parameter')
      }
      const result = repo.upsert({
        name: presetName,
        content: composeTavernContent(parsed.data, presetName),
        description: describeTavernCard(parsed),
      })
      if (!result.ok) throw new Error(result.message)

      const importedWorld = importWorldPreset(repo, worldbooks, worldbooksFile, dataDir, parsed.world, presetName)
      const regexPreset = args.withRegex === true ? importRegexPreset(repo, parsed.regexScripts, presetName) : undefined

      ctx.emit('system-prompt/change')
      return {
        preset: presetName,
        created: result.created,
        kind: parsed.kind,
        spec: parsed.spec,
        character: parsed.data.name,
        ...(importedWorld !== undefined
          ? {
            worldPreset: importedWorld.worldPreset,
            writingPreset: importedWorld.writingPreset,
            worldEntries: parsed.world?.entries.length ?? 0,
            worldDocument: importedWorld.documentPath,
          }
          : {}),
        ...(regexPreset !== undefined ? { regexPreset, regexScripts: parsed.regexScripts?.length ?? 0 } : {}),
      } as unknown as JsonValue
    },
  }))

  ctx.tools.register(defineTool({
    name: 'prompt_import_world',
    description:
      'Import a standalone SillyTavern world info / lorebook JSON file ({ "entries": [...] }) as a '
      + '"<name>·世界书" preset. Activating that preset enables keyword-triggered entry injection: when '
      + 'the conversation mentions an entry\'s trigger keys, its content is injected into the turn. '
      + 'Use an absolute file path; pass name to override the preset name; pass activate to switch to '
      + 'the world preset immediately.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path to the world info JSON file.' },
      name: { type: 'string', description: 'World preset name base; defaults to the file\'s name field or the file basename.' },
      activate: { type: 'boolean', description: 'Activate the world preset after import (default false).' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const resolved = expandHomePath(args.path)
      let world: WorldInfo
      try {
        world = parseWorldInfoJson(readFileSync(resolved, 'utf8'))
      } catch (error) {
        throw new Error(`cannot import world file ${resolved}: ${(error as Error).message}`)
      }
      if (world.entries.length === 0) throw new Error('world file has no usable entries')
      const baseName = (args.name ?? world.name ?? basename(resolved).replace(/\.[^.]+$/, '')).trim()
      if (baseName === '') throw new Error('cannot derive a world preset name; pass the name parameter')
      const importedWorld = importWorldPreset(repo, worldbooks, worldbooksFile, dataDir, world, baseName)
      if (importedWorld === undefined) throw new Error('world file has no usable entries')
      if (args.activate === true) {
        const used = repo.use(importedWorld.worldPreset)
        if (!used.ok) throw new Error(used.message)
      }
      ctx.emit('system-prompt/change')
      return {
        preset: importedWorld.worldPreset,
        writingPreset: importedWorld.writingPreset,
        document: importedWorld.documentPath,
        entries: world.entries.length,
        activated: args.activate === true,
      } as unknown as JsonValue
    },
  }))

  ctx.tools.register(defineTool({
    name: 'prompt_import_regex',
    description:
      'Import standalone SillyTavern regex scripts (a JSON array) as a "<name>·正则" preset containing '
      + 'the script definitions. DSH has no chat regex rendering pipeline, so the definitions are for '
      + 'reference and manual application by the model. Use an absolute file path; pass name to override '
      + 'the preset name.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path to the regex scripts JSON file.' },
      name: { type: 'string', description: 'Preset name base; defaults to the file basename.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const resolved = expandHomePath(args.path)
      let scripts: ReturnType<typeof parseRegexScriptsJson>
      try {
        scripts = parseRegexScriptsJson(readFileSync(resolved, 'utf8'))
      } catch (error) {
        throw new Error(`cannot import regex file ${resolved}: ${(error as Error).message}`)
      }
      if (scripts.length === 0) throw new Error('regex file has no usable scripts')
      const baseName = (args.name ?? basename(resolved).replace(/\.[^.]+$/, '')).trim()
      if (baseName === '') throw new Error('cannot derive a regex preset name; pass the name parameter')
      const presetName = regexPresetName(baseName)
      const result = repo.upsert({
        name: presetName,
        content: composeRegexContent(scripts, baseName),
        description: `Imported regex scripts (${scripts.length}): ${scripts.map(s => s.scriptName ?? '(unnamed)').join(', ')}`,
      })
      if (!result.ok) throw new Error(result.message)
      ctx.emit('system-prompt/change')
      return { preset: presetName, scripts: scripts.length } as unknown as JsonValue
    },
  }))
}

/** 基于 node:fs 的持久化实现：原子写（tmp + rename），损坏文件先备份再空库启动。 */
function createFileIo(dataFile: string): PresetIo {
  return {
    load(): PresetFile {
      try {
        return JSON.parse(readFileSync(dataFile, 'utf8')) as PresetFile
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') return { active: null, presets: [] }
        // JSON 损坏：备份原文件再以空库启动，避免后续保存覆盖用户数据
        try {
          renameSync(dataFile, `${dataFile}.broken-${Date.now()}`)
        } catch {
          // 备份失败也不阻塞启动
        }
        console.warn(`[prompt-manager] invalid JSON in ${dataFile}; moved to *.broken-* and started empty`)
        return { active: null, presets: [] }
      }
    },
    save(file: PresetFile): void {
      mkdirSync(dirname(dataFile), { recursive: true })
      const tmp = `${dataFile}.${process.pid}.tmp`
      writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
      renameSync(tmp, dataFile)
    },
  }
}

// --- 浏览器设置页数据通道（/prompt-manager/api） ---

const API_PATH = '/prompt-manager/api'
const MAX_API_BODY_BYTES = 10 * 1024 * 1024
/** 世界书预设名后缀（与 tavern.ts 的 worldPresetName 保持一致）。 */
const WORLD_PRESET_SUFFIX = '·世界书'

/** 注册 JSON RPC 路由：op 分派到 PresetRepo，设置页与 host 共享同一份数据。 */
function registerApiRoute(
  ctx: Context,
  repo: PresetRepo,
  worldbooks: Map<string, WorldInfo>,
  worldbooksFile: string,
  dataDir: string,
): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: API_PATH,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req, MAX_API_BODY_BYTES)
        sendJson(res, 200, handleApiOp(ctx, repo, worldbooks, worldbooksFile, dataDir, body))
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message })
      }
    },
  }), 'prompt-manager: api route')
}

function handleApiOp(
  ctx: Context,
  repo: PresetRepo,
  worldbooks: Map<string, WorldInfo>,
  worldbooksFile: string,
  dataDir: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  switch (body.op) {
    case 'list': {
      const { active, presets } = repo.list()
      return { ok: true, data: { active, presets: presets.map(p => ({ name: p.name, description: p.description })) } }
    }
    case 'get': {
      const name = requireString(body, 'name')
      const preset = repo.list().presets.find(p => p.name === name)
      if (preset === undefined) return { ok: false, error: `preset "${name}" does not exist` }
      return { ok: true, data: { name: preset.name, description: preset.description, content: preset.content } }
    }
    case 'use': {
      const name = requireString(body, 'name')
      const result = repo.use(name)
      if (!result.ok) return { ok: false, error: result.message }
      ctx.emit('system-prompt/change')
      return { ok: true, data: { active: name } }
    }
    case 'off':
      repo.off()
      ctx.emit('system-prompt/change')
      return { ok: true, data: { active: null } }
    case 'upsert': {
      const name = requireString(body, 'name')
      const content = requireString(body, 'content')
      const description = typeof body.description === 'string' && body.description !== '' ? body.description : undefined
      const result = repo.upsert({ name, content, description })
      if (!result.ok) return { ok: false, error: result.message }
      ctx.emit('system-prompt/change')
      return { ok: true, data: { created: result.created } }
    }
    case 'remove': {
      const name = requireString(body, 'name')
      const result = removePresetAndWorld(repo, worldbooks, worldbooksFile, name)
      if (!result.ok) return { ok: false, error: result.message }
      ctx.emit('system-prompt/change')
      return { ok: true, data: {} }
    }
    case 'importTavern': {
      const parsed = readTavernFile(expandHomePath(requireString(body, 'path')))
      const presetName = (typeof body.name === 'string' ? body.name : parsed.data.name ?? '').trim()
      if (presetName === '') return { ok: false, error: 'character card has no name; pass the name parameter' }
      const result = repo.upsert({
        name: presetName,
        content: composeTavernContent(parsed.data, presetName),
        description: describeTavernCard(parsed),
      })
      if (!result.ok) return { ok: false, error: result.message }
      const withWorld = body.withWorld !== false
      const withRegex = body.withRegex === true
      const importedWorld = withWorld
        ? importWorldPreset(repo, worldbooks, worldbooksFile, dataDir, parsed.world, presetName)
        : undefined
      const regexPreset = withRegex ? importRegexPreset(repo, parsed.regexScripts, presetName) : undefined
      ctx.emit('system-prompt/change')
      return {
        ok: true,
        data: {
          preset: presetName,
          created: result.created,
          kind: parsed.kind,
          spec: parsed.spec,
          character: parsed.data.name,
          ...(importedWorld !== undefined
            ? {
              worldPreset: importedWorld.worldPreset,
              writingPreset: importedWorld.writingPreset,
              worldEntries: parsed.world?.entries.length ?? 0,
              worldDocument: importedWorld.documentPath,
            }
            : {}),
          ...(regexPreset !== undefined ? { regexPreset, regexScripts: parsed.regexScripts?.length ?? 0 } : {}),
        },
      }
    }
    case 'importWorld': {
      const path = expandHomePath(requireString(body, 'path'))
      let world: WorldInfo
      try {
        world = parseWorldInfoJson(readFileSync(path, 'utf8'))
      } catch (error) {
        return { ok: false, error: `cannot import world file ${path}: ${(error as Error).message}` }
      }
      if (world.entries.length === 0) return { ok: false, error: 'world file has no usable entries' }
      const baseName = (typeof body.name === 'string' && body.name !== ''
        ? body.name
        : world.name ?? basename(path).replace(/\.[^.]+$/, '')).trim()
      if (baseName === '') return { ok: false, error: 'cannot derive a world preset name; pass the name parameter' }
      const importedWorld = importWorldPreset(repo, worldbooks, worldbooksFile, dataDir, world, baseName)
      if (importedWorld === undefined) return { ok: false, error: 'world file has no usable entries' }
      if (body.activate === true) {
        const used = repo.use(importedWorld.worldPreset)
        if (!used.ok) return { ok: false, error: used.message }
      }
      ctx.emit('system-prompt/change')
      return {
        ok: true,
        data: {
          preset: importedWorld.worldPreset,
          writingPreset: importedWorld.writingPreset,
          document: importedWorld.documentPath,
          entries: world.entries.length,
          activated: body.activate === true,
        },
      }
    }
    case 'importRegex': {
      const path = expandHomePath(requireString(body, 'path'))
      let scripts: ReturnType<typeof parseRegexScriptsJson>
      try {
        scripts = parseRegexScriptsJson(readFileSync(path, 'utf8'))
      } catch (error) {
        return { ok: false, error: `cannot import regex file ${path}: ${(error as Error).message}` }
      }
      if (scripts.length === 0) return { ok: false, error: 'regex file has no usable scripts' }
      const baseName = (typeof body.name === 'string' && body.name !== ''
        ? body.name
        : basename(path).replace(/\.[^.]+$/, '')).trim()
      if (baseName === '') return { ok: false, error: 'cannot derive a regex preset name; pass the name parameter' }
      const presetName = regexPresetName(baseName)
      const result = repo.upsert({
        name: presetName,
        content: composeRegexContent(scripts, baseName),
        description: `Imported regex scripts (${scripts.length}): ${scripts.map(s => s.scriptName ?? '(unnamed)').join(', ')}`,
      })
      if (!result.ok) return { ok: false, error: result.message }
      ctx.emit('system-prompt/change')
      return { ok: true, data: { preset: presetName, scripts: scripts.length } }
    }
    case 'worlds': {
      // 世界书列表（设置页主视图）：每本世界书的双预设名、条目数、本地文档路径与当前激活模式
      const { active } = repo.list()
      const worlds = [...worldbooks.entries()].map(([worldPresetName_, world]) => {
        const name = worldPresetName_.endsWith(WORLD_PRESET_SUFFIX)
          ? worldPresetName_.slice(0, -WORLD_PRESET_SUFFIX.length)
          : worldPresetName_
        const writingPreset = writingPresetName(name)
        const activeMode = active === worldPresetName_ ? 'world' : active === writingPreset ? 'writing' : null
        return {
          name,
          worldPreset: worldPresetName_,
          writingPreset,
          entries: world.entries.length,
          documentPath: join(dataDir, 'worldbooks', `${safeFileName(name)}.md`),
          activeMode,
        }
      })
      return { ok: true, data: { active, worlds } }
    }
    case 'removeWorld': {
      // 删除整组：世界书预设（联动 worldbooks 条目）+ 创作预设 + 本地文档
      const name = requireString(body, 'name')
      const worldResult = removePresetAndWorld(repo, worldbooks, worldbooksFile, worldPresetName(name))
      if (!worldResult.ok) return { ok: false, error: worldResult.message }
      const writingResult = repo.remove(writingPresetName(name))
      if (!writingResult.ok) return { ok: false, error: writingResult.message }
      try {
        rmSync(join(dataDir, 'worldbooks', `${safeFileName(name)}.md`), { force: true })
      } catch {
        // 文档不存在也视为成功
      }
      ctx.emit('system-prompt/change')
      return { ok: true, data: {} }
    }
    case 'openDocument': {
      // 用系统默认方式打开世界书本地设定文档（供编辑）
      const name = requireString(body, 'name')
      const filePath = join(dataDir, 'worldbooks', `${safeFileName(name)}.md`)
      if (!existsSync(filePath)) return { ok: false, error: `document not found: ${filePath}` }
      try {
        openInSystem(filePath)
      } catch (error) {
        // 打开动作尽力而为：spawn 失败（如无关联程序/受限环境）不使 API 报错
        console.warn(`[prompt-manager] failed to open ${filePath}: ${String(error)}`)
      }
      return { ok: true, data: { opened: filePath } }
    }
    default:
      return { ok: false, error: `unknown op "${String(body.op)}"` }
  }
}

/** 用系统默认程序打开文件（Windows: start；macOS: open；Linux: xdg-open）。 */
function openInSystem(filePath: string): void {
  const { platform } = process
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', filePath], { detached: true, stdio: 'ignore' }).unref()
  } else if (platform === 'darwin') {
    spawn('open', [filePath], { detached: true, stdio: 'ignore' }).unref()
  } else {
    spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref()
  }
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value === '') throw new Error(`missing or invalid field "${key}"`)
  return value
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function readJsonBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('request body must be a JSON object')
        }
        resolve(parsed as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

// --- 世界书 / 正则：持久化、导入、删除联动、关键词触发 ---

/** 读取角色卡文件（统一错误信息）。 */
function readTavernFile(path: string): ReturnType<typeof parseTavernFile> {
  let buffer: Buffer
  try {
    buffer = readFileSync(path)
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`)
  }
  return parseTavernFile(buffer)
}

/** 载入 worldbooks.json（{ [presetName]: WorldInfo }）。 */
function loadWorldbooks(worldbooksFile: string): Array<[string, WorldInfo]> {
  try {
    const parsed = JSON.parse(readFileSync(worldbooksFile, 'utf8')) as Record<string, unknown>
    const entries: Array<[string, WorldInfo]> = []
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || typeof value !== 'object') continue
      entries.push([key, value as WorldInfo])
    }
    return entries
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[prompt-manager] failed to load ${worldbooksFile}: ${String(error)}`)
    }
    return []
  }
}

/** 原子写 worldbooks.json。 */
function saveWorldbooks(worldbooksFile: string, worldbooks: Map<string, WorldInfo>): void {
  const object = Object.fromEntries(worldbooks)
  mkdirSync(dirname(worldbooksFile), { recursive: true })
  const tmp = `${worldbooksFile}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(object, null, 2)}\n`, 'utf8')
  renameSync(tmp, worldbooksFile)
}

/**
 * 把世界书导入为双预设并落地本地文档：
 * - `<ownerName>·世界书`：纯设定（关键词触发用）
 * - `<ownerName>·创作`：创作指令 + 设定全文（激活即进入创作模式）
 * - `worldbooks/<ownerName>.md`：本地 Markdown 设定文档（DSH/模型易读、可编辑）
 * 同时持久化条目数据（供关键词触发）。
 * @returns 生成的预设名与文档路径；无世界书时返回 undefined。
 */
function importWorldPreset(
  repo: PresetRepo,
  worldbooks: Map<string, WorldInfo>,
  worldbooksFile: string,
  dataDir: string,
  world: WorldInfo | undefined,
  ownerName: string,
): { worldPreset: string; writingPreset: string; documentPath: string } | undefined {
  if (world === undefined || world.entries.length === 0) return undefined

  const worldName = worldPresetName(ownerName)
  const worldDoc = composeWorldDocument(world, ownerName)
  const worldResult = repo.upsert({
    name: worldName,
    content: composeWorldContent(world, ownerName),
    description: `Imported world info (${world.entries.length} entries${world.name !== undefined ? `, "${world.name}"` : ''}); activating it enables keyword-triggered injection`,
  })
  if (!worldResult.ok) throw new Error(worldResult.message)

  const writingName = writingPresetName(ownerName)
  const writingResult = repo.upsert({
    name: writingName,
    content: composeWritingContent(worldDoc, ownerName),
    description: `创作模式：参考《${ownerName}》世界设定创作小说；激活后输入场景即可`,
  })
  if (!writingResult.ok) throw new Error(writingResult.message)

  worldbooks.set(worldName, world)
  saveWorldbooks(worldbooksFile, worldbooks)
  const documentPath = writeWorldDocument(dataDir, ownerName, worldDoc)
  return { worldPreset: worldName, writingPreset: writingName, documentPath }
}

/** 文件名安全化：把路径保留字符替换为下划线。 */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

/** 把世界书设定文档写到 dataDir/worldbooks/<ownerName>.md，返回文件路径。 */
function writeWorldDocument(dataDir: string, ownerName: string, document: string): string {
  const dir = join(dataDir, 'worldbooks')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${safeFileName(ownerName)}.md`)
  writeFileSync(file, document, 'utf8')
  return file
}

/** 把正则脚本导入为 `<ownerName>·正则` 预设。@returns 生成的预设名；无脚本时返回 undefined。 */
function importRegexPreset(
  repo: PresetRepo,
  scripts: ReturnType<typeof parseRegexScriptsJson> | undefined,
  ownerName: string,
): string | undefined {
  if (scripts === undefined || scripts.length === 0) return undefined
  const presetName = regexPresetName(ownerName)
  const result = repo.upsert({
    name: presetName,
    content: composeRegexContent(scripts, ownerName),
    description: `Imported regex scripts (${scripts.length}): ${scripts.map(s => s.scriptName ?? '(unnamed)').join(', ')}`,
  })
  if (!result.ok) throw new Error(result.message)
  return presetName
}

/** 删除预设；若删的是世界书预设则同步清理 worldbooks 条目。 */
function removePresetAndWorld(
  repo: PresetRepo,
  worldbooks: Map<string, WorldInfo>,
  worldbooksFile: string,
  name: string,
): RepoResult {
  const result = repo.remove(name)
  if (!result.ok) return result
  if (worldbooks.delete(name)) saveWorldbooks(worldbooksFile, worldbooks)
  return result
}

/**
 * 世界书关键词自动触发：激活的预设是某世界书时，对当前轮用户消息做触发词匹配，
 * 把命中条目以 user-role context 注入本轮（source 标记为插件指令）。
 */
function registerWorldTrigger(ctx: Context, repo: PresetRepo, worldbooks: Map<string, WorldInfo>): void {
  ctx.on('agent/pre-step', async ({ messages }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const active = repo.active
    if (active === null) return decision
    const world = worldbooks.get(active)
    if (world === undefined) return decision
    const userText = messages
      .filter(message => message.source.kind === 'user')
      .flatMap(message => message.content
        .filter(block => block.type === 'text')
        .map(block => block.text))
      .join('\n')
    const matched = world.entries.filter(entry => matchWorldEntry(entry, userText))
    if (matched.length === 0) return decision
    const injected = matched.map(entry => createUserMessage({
      content: [{ type: 'text', text: renderWorldEntry(entry) }],
      source: { kind: 'plugin', plugin: name, form: 'instructions' },
    }))
    return { kind: 'enter', messages: [...decision.messages, ...injected] }
  })
}

/**
 * 清理预设文本中的 `{{变量}}` 占位符。
 *
 * DSH 的 renderPrompt 会插值 `{{name}}`，未注册变量直接抛错（无转义机制），
 * 因此 SillyTavern 内容里的 `{{user}}`/`{{char}}` 等必须在注入前处理：
 * - `{{user}}` → 「用户」
 * - `{{char}}` → charName（激活预设名；角色卡预设即角色名）
 * - DSH 自身注册变量（provider/model/cwd）保留，交给 DSH 插值
 * - 其余未知变量丢弃（避免渲染失败）
 */
export function sanitizePromptVariables(text: string, charName?: string): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, rawName: string) => {
    const name = rawName.trim()
    if (DSH_PROMPT_VARIABLES.has(name)) return match
    if (name === 'user') return '用户'
    if (name === 'char') return charName ?? match
    return ''
  })
}

const DSH_PROMPT_VARIABLES = new Set(['provider', 'model', 'cwd'])
