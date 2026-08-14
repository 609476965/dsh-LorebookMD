/**
 * 世界书（World Info）与正则脚本：解析、组合、匹配与导入集成测试。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  composeRegexContent, composeWorldContent, matchWorldEntry, parseRegexScriptsJson,
  parseTavernFile, parseWorldInfoJson, regexPresetName, renderWorldEntry, worldPresetName,
  type RegexScript, type WorldEntry, type WorldInfo,
} from '../src/tavern.ts'
import { apply, sanitizePromptVariables } from '../src/index.ts'

// --- 解析 ---

const CARD_WITH_WORLD = {
  spec: 'chara_card_v2',
  data: {
    name: 'Aria',
    description: 'Forest spirit.',
    extensions: {
      world: {
        name: 'Aria 的世界',
        entries: [
          {
            keys: ['森林', 'forest'],
            comment: '她住的地方',
            content: '森林常年笼罩薄雾，有会发光的蘑菇。',
            constant: false,
            enabled: true,
            insertion_order: 100,
          },
          {
            keys: ['咒语'],
            content: '森林古咒语，不可随意使用。',
            constant: true,
          },
        ],
      },
      regex_scripts: [
        {
          scriptName: '清理引号',
          findRegex: '\\"(.*?)\\"',
          replaceString: '',
          placement: ['user', 'ai'],
        },
      ],
    },
  },
}

test('角色卡 extensions.world 与 regex_scripts 解析', () => {
  const parsed = parseTavernFile(Buffer.from(JSON.stringify(CARD_WITH_WORLD), 'utf8'))
  assert.equal(parsed.world?.name, 'Aria 的世界')
  assert.equal(parsed.world?.entries.length, 2)
  const forest = parsed.world?.entries.find(e => e.keys.includes('森林'))
  assert.deepEqual(forest?.keys, ['森林', 'forest'])
  assert.equal(forest?.comment, '她住的地方')
  assert.equal(forest?.order, 100)
  assert.equal(forest?.constant, undefined)
  const spell = parsed.world?.entries.find(e => e.keys.includes('咒语'))
  assert.equal(spell?.constant, true)
  assert.equal(parsed.regexScripts?.[0]?.scriptName, '清理引号')
  assert.equal(parsed.regexScripts?.[0]?.findRegex, '\\"(.*?)\\"')
  assert.deepEqual(parsed.regexScripts?.[0]?.placement, ['user', 'ai'])
})

test('独立世界书 JSON：数组与对象两种 entries 形态', () => {
  const arrayForm = parseWorldInfoJson(JSON.stringify({
    name: 'world-a',
    entries: [
      { keys: ['a'], content: 'A', constant: true },
      { keys: ['b'], content: 'B', enabled: false },
    ],
  }))
  assert.equal(arrayForm.name, 'world-a')
  assert.equal(arrayForm.entries.length, 2)
  assert.equal(arrayForm.entries[1]?.enabled, false)

  const objectForm = parseWorldInfoJson(JSON.stringify({
    entries: {
      entry1: { keys: ['x'], content: 'X' },
    },
  }))
  assert.equal(objectForm.entries.length, 1)
  assert.equal(objectForm.entries[0]?.content, 'X')

  const bareArray = parseWorldInfoJson(JSON.stringify([
    { keys: ['y'], content: 'Y' },
  ]))
  assert.equal(bareArray.entries.length, 1)

  assert.throws(() => parseWorldInfoJson('{not json'), /无法解析世界书/)
})

test('独立正则脚本 JSON：数组与 {scripts} 形态', () => {
  const arrayForm = parseRegexScriptsJson(JSON.stringify([
    { scriptName: 's1', findRegex: 'a', replaceString: 'b' },
    { scriptName: 's2', findRegex: 'c', disabled: true },
  ]))
  assert.equal(arrayForm.length, 2)
  assert.equal(arrayForm[0]?.replaceString, 'b')
  assert.equal(arrayForm[1]?.disabled, true)

  const wrapped = parseRegexScriptsJson(JSON.stringify({ scripts: [{ scriptName: 's3', findRegex: 'd' }] }))
  assert.equal(wrapped.length, 1)
  assert.equal(wrapped[0]?.scriptName, 's3')
})

// --- 组合 ---

test('composeWorldContent：触发词说明、constant 标记、comment', () => {
  const world: WorldInfo = {
    entries: [
      { keys: ['森林', 'forest'], comment: '她的家', content: '薄雾笼罩。', constant: true, selective: true },
      { keys: ['村庄'], content: '河边小村。' },
      { keys: ['禁用'], content: '不会出现。', enabled: false },
    ],
  }
  const content = composeWorldContent(world, 'Aria')
  assert.ok(content.startsWith('[World Info: Aria]'))
  assert.ok(content.includes('### 森林（触发词：森林、forest） [始终生效/选择性]'))
  assert.ok(content.includes('（她的家）'))
  assert.ok(content.includes('### 村庄'))
  assert.ok(!content.includes('禁用'))
})

test('composeRegexContent：脚本定义结构', () => {
  const scripts: RegexScript[] = [
    { scriptName: '清引号', findRegex: '\\"(.*?)\\"', replaceString: '', placement: ['user', 'ai'], markdownOnly: true },
    { scriptName: '隐藏', findRegex: 'x', disabled: true },
  ]
  const content = composeRegexContent(scripts, 'Aria')
  assert.ok(content.startsWith('[Regex Scripts: Aria]'))
  assert.ok(content.includes('### 清引号'))
  assert.ok(content.includes('- pattern: \\"(.*?)\\"'))
  assert.ok(content.includes('- replace: (删除匹配)'))
  assert.ok(content.includes('- placement: user, ai'))
  assert.ok(!content.includes('隐藏'))
})

// --- 匹配 ---

test('matchWorldEntry：包含/大小写/整词/正则/常驻/禁用', () => {
  const entry: WorldEntry = { keys: ['森林'], content: 'x' }
  assert.equal(matchWorldEntry(entry, '我走进森林里'), true)
  assert.equal(matchWorldEntry(entry, '我走进森-林里'), false)

  const whole: WorldEntry = { keys: ['cat'], content: 'x', matchWholeWords: true }
  assert.equal(matchWorldEntry(whole, 'a cat sits'), true)
  assert.equal(matchWorldEntry(whole, 'category'), false)

  const caseSensitive: WorldEntry = { keys: ['Forest'], content: 'x', caseSensitive: true }
  assert.equal(matchWorldEntry(caseSensitive, 'in the forest'), false)
  assert.equal(matchWorldEntry(caseSensitive, 'in the Forest'), true)

  const regex: WorldEntry = { keys: ['ca\\w+'], content: 'x', useRegex: true }
  assert.equal(matchWorldEntry(regex, 'I see a cat'), true)
  assert.equal(matchWorldEntry(regex, 'I see a dog'), false)

  const constant: WorldEntry = { keys: [], content: 'x', constant: true }
  assert.equal(matchWorldEntry(constant, '任何文本'), true)

  const disabled: WorldEntry = { keys: ['森林'], content: 'x', enabled: false }
  assert.equal(matchWorldEntry(disabled, '森林'), false)
})

test('renderWorldEntry：注入文本结构', () => {
  const text = renderWorldEntry({ keys: ['森林', 'forest'], content: '薄雾笼罩。' })
  assert.ok(text.includes('<world_info_entry keys="森林,forest">'))
  assert.ok(text.includes('薄雾笼罩。'))
  assert.ok(text.includes('</world_info_entry>'))
})

// --- 导入集成（stub ctx） ---

interface StubTool {
  name: string
  execute(args: Record<string, unknown>): Promise<unknown>
}

type PreStepHandler = (payload: { messages: unknown[] }, next: () => Promise<unknown>) => Promise<unknown>

function stubCtx() {
  const tools: StubTool[] = []
  const routes: Array<{ path: string }> = []
  const preStepHandlers: PreStepHandler[] = []
  const sections: Array<{ name: string; text: () => string }> = []
  const disposers: Array<() => void> = []
  const ctx = {
    webServer: { register(route: { path: string }) { routes.push(route); return () => { } } },
    tools: { register(tool: StubTool) { tools.push(tool) } },
    systemPrompt: { section(section: { name: string; text: () => string }) { sections.push(section); return () => { } } },
    on(event: string, handler: PreStepHandler) { if (event === 'agent/pre-step') preStepHandlers.push(handler) },
    emit() { },
    effect(fn: () => (() => void) | void) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
  }
  return { ctx, tools, routes, preStepHandlers, sections, disposers }
}

function setup(dir: string) {
  const { ctx, tools, preStepHandlers, sections, disposers } = stubCtx()
  apply(ctx as never, { dataDir: dir, sectionName: 'test:section', sectionOrder: 95, enableTools: true, watchFile: false, worldTrigger: true })
  const byName = (n: string) => tools.find(t => t.name === n)
  return { byName, preStepHandlers, sections, disposers }
}

test('importTavern 带世界书/正则：生成预设 + worldbooks.json + 预设名', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const cardPath = join(dir, 'aria.json')
  writeFileSync(cardPath, JSON.stringify(CARD_WITH_WORLD), 'utf8')
  const { byName, disposers } = setup(dir)
  try {
    const imported = await byName('prompt_import_tavern')!.execute({ path: cardPath }) as {
      preset: string
      worldPreset?: string
      writingPreset?: string
      worldEntries?: number
      worldDocument?: string
      regexPreset?: string
      regexScripts?: number
    }
    assert.equal(imported.preset, 'Aria')
    assert.equal(imported.worldPreset, 'Aria·世界书')
    assert.equal(imported.writingPreset, 'Aria·创作')
    assert.equal(imported.worldEntries, 2)
    // 默认不导入正则（创作定位下正则无用途）
    assert.equal(imported.regexPreset, undefined)
    assert.equal(imported.regexScripts, undefined)

    // 显式 withRegex 时仍可导入
    const withRegex = await byName('prompt_import_tavern')!.execute({ path: cardPath, withRegex: true }) as { regexPreset?: string }
    assert.equal(withRegex.regexPreset, 'Aria·正则')

    // worldbooks.json 持久化了条目数据
    const worldbooks = JSON.parse(readFileSync(join(dir, 'worldbooks.json'), 'utf8')) as Record<string, WorldInfo>
    assert.equal(worldbooks['Aria·世界书']?.entries.length, 2)

    // 本地 Markdown 设定文档已落地（DSH 易读格式）
    assert.ok(imported.worldDocument !== undefined)
    const doc = readFileSync(imported.worldDocument!, 'utf8')
    assert.ok(doc.startsWith('# 世界设定：'))
    assert.ok(doc.includes('###') === false || doc.includes('## 1.'))
    assert.ok(doc.includes('森林'))

    // 创作预设已生成：创作指令 + 设定全文
    const writingContent = (await byName('prompt_preset_list')!.execute({}) as { presets: Array<{ name: string }> })
    assert.ok(writingContent.presets.some(p => p.name === 'Aria·创作'))

    // 激活世界书预设后可切换
    assert.equal(await byName('prompt_preset_use')!.execute({ name: 'Aria·世界书' }), 'Active preset: Aria·世界书')
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('prompt_import_world：独立世界书 + activate；删除联动清理', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const worldPath = join(dir, 'lore.json')
  writeFileSync(worldPath, JSON.stringify({
    name: 'my-lore',
    entries: [{ keys: ['城堡'], content: '山顶城堡。', constant: true }],
  }), 'utf8')
  const { byName, disposers } = setup(dir)
  try {
    const imported = await byName('prompt_import_world')!.execute({ path: worldPath, activate: true }) as {
      preset: string
      writingPreset: string
      document: string
      activated: boolean
    }
    assert.equal(imported.preset, 'my-lore·世界书')
    assert.equal(imported.writingPreset, 'my-lore·创作')
    assert.equal(imported.activated, true)
    assert.equal(worldPresetName('my-lore'), 'my-lore·世界书')
    assert.equal(regexPresetName('x'), 'x·正则')

    // 本地设定文档存在且可读
    assert.ok(readFileSync(imported.document, 'utf8').includes('山顶城堡。'))

    // 删除世界书预设 → worldbooks.json 清理
    await byName('prompt_preset_delete')!.execute({ name: 'my-lore·世界书' })
    const worldbooks = JSON.parse(readFileSync(join(dir, 'worldbooks.json'), 'utf8')) as Record<string, unknown>
    assert.equal(Object.keys(worldbooks).length, 0)
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('激活「·创作」预设：section 注入创作指令 + 设定全文', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const worldPath = join(dir, 'lore.json')
  writeFileSync(worldPath, JSON.stringify({
    name: 'lore',
    entries: [
      { keys: ['森林'], content: '{{user}}在森林里。' },
      { keys: ['城堡'], content: '山顶城堡。', constant: true },
    ],
  }), 'utf8')
  const { byName, sections, disposers } = setup(dir)
  try {
    await byName('prompt_import_world')!.execute({ path: worldPath })
    await byName('prompt_preset_use')!.execute({ name: 'lore·创作' })

    const section = sections.find(s => s.name === 'test:section')
    assert.ok(section)
    const text = section.text()
    assert.ok(text.includes('[创作模式]'))
    assert.ok(text.includes('小说创作助手'))
    assert.ok(text.includes('—— 以下为世界设定全文 ——'))
    assert.ok(text.includes('山顶城堡。'))
    // {{user}} 占位符在注入前已清理
    assert.ok(!text.includes('{{user}}'))
    assert.ok(text.includes('用户'))
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('prompt_import_regex：独立正则文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const regexPath = join(dir, 'regex.json')
  writeFileSync(regexPath, JSON.stringify([
    { scriptName: 's1', findRegex: 'a', replaceString: 'b' },
  ]), 'utf8')
  const { byName, disposers } = setup(dir)
  try {
    const imported = await byName('prompt_import_regex')!.execute({ path: regexPath }) as { preset: string; scripts: number }
    assert.equal(imported.preset, 'regex·正则')
    assert.equal(imported.scripts, 1)
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pre-step 世界书触发：激活世界书后按关键词注入匹配条目', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const worldPath = join(dir, 'lore.json')
  writeFileSync(worldPath, JSON.stringify({
    name: 'lore',
    entries: [
      { keys: ['森林'], content: '森林有会发光的蘑菇。' },
      { keys: ['城堡'], content: '山顶城堡。' },
      { keys: ['常驻'], content: '始终注入的设定。', constant: true },
    ],
  }), 'utf8')
  const { byName, preStepHandlers, disposers } = setup(dir)
  try {
    await byName('prompt_import_world')!.execute({ path: worldPath, activate: true })
    assert.equal(preStepHandlers.length, 1)
    const handler = preStepHandlers[0]!

    const userMessages = [
      { content: [{ type: 'text', text: '我走向森林深处。' }], source: { kind: 'user' } },
    ] as never
    const decision = await handler({ messages: userMessages }, async () => ({ kind: 'enter', messages: [] })) as {
      kind: string
      messages: Array<{ content: Array<{ text: string }> }>
    }
    assert.equal(decision.kind, 'enter')
    const texts = decision.messages.map(m => m.content.map(b => b.text).join(''))
    // 命中 森林（关键词）与 常驻（constant），未命中 城堡
    assert.ok(texts.some(t => t.includes('森林有会发光的蘑菇。')))
    assert.ok(texts.some(t => t.includes('始终注入的设定。')))
    assert.ok(!texts.some(t => t.includes('山顶城堡。')))

    // 未激活世界书时不注入
    await byName('prompt_preset_off')!.execute({})
    const decision2 = await handler({ messages: userMessages }, async () => ({ kind: 'enter', messages: [] })) as { messages: unknown[] }
    assert.equal(decision2.messages.length, 0)
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- 真实世界卡兼容（character_book / 无效字段容错） ---

test('character_book（角色书）解析为世界书，且与 extensions.world 合并', () => {
  const card = {
    spec: 'chara_card_v2',
    data: {
      name: 'Test',
      character_book: {
        name: '我的角色书',
        entries: [
          { keys: ['森林'], content: '薄雾。', constant: true },
          { keys: ['城堡'], content: '山顶。' },
        ],
      },
    },
  }
  const parsed = parseTavernFile(Buffer.from(JSON.stringify(card), 'utf8'))
  assert.equal(parsed.world?.name, '我的角色书')
  assert.equal(parsed.world?.entries.length, 2)
  assert.equal(parsed.world?.entries.find(e => e.keys.includes('城堡'))?.content, '山顶。')

  // 与 extensions.world 并存时条目合并
  const mergedCard = {
    spec: 'chara_card_v2',
    data: {
      name: 'Test',
      extensions: { world: { entries: [{ keys: ['a'], content: 'A' }] } },
      character_book: { name: 'book', entries: [{ keys: ['b'], content: 'B' }] },
    },
  }
  const merged = parseTavernFile(Buffer.from(JSON.stringify(mergedCard), 'utf8'))
  assert.equal(merged.world?.entries.length, 2)
  assert.equal(merged.world?.name, 'book') // extensions.world 无 name 时保留 character_book 的
})

test('extensions.world 为名字字符串 / null 时容错，不抛错', () => {
  const stringWorld = {
    spec: 'chara_card_v2',
    data: { name: 'A', extensions: { world: 'Yokozi-重置' } },
  }
  const parsed = parseTavernFile(Buffer.from(JSON.stringify(stringWorld), 'utf8'))
  assert.equal(parsed.data.name, 'A')
  assert.equal(parsed.world, undefined)

  const nullWorld = {
    spec: 'chara_card_v2',
    data: { name: 'B', extensions: { world: null } },
  }
  const parsedNull = parseTavernFile(Buffer.from(JSON.stringify(nullWorld), 'utf8'))
  assert.equal(parsedNull.world, undefined)

  // 字符串 world + character_book 并存 → character_book 仍生效
  const mixed = {
    spec: 'chara_card_v2',
    data: {
      name: 'C',
      extensions: { world: '仅名字' },
      character_book: { entries: [{ keys: ['x'], content: 'X' }] },
    },
  }
  const parsedMixed = parseTavernFile(Buffer.from(JSON.stringify(mixed), 'utf8'))
  assert.equal(parsedMixed.world?.entries.length, 1)
})

test('regex_scripts 为非数组时容错，不抛错', () => {
  const card = {
    spec: 'chara_card_v2',
    data: { name: 'D', extensions: { regex_scripts: null } },
  }
  const parsed = parseTavernFile(Buffer.from(JSON.stringify(card), 'utf8'))
  assert.equal(parsed.data.name, 'D')
  assert.equal(parsed.regexScripts, undefined)
})

// --- {{变量}} 占位符清理（避免 DSH 渲染器对 ST 占位符报错） ---

test('sanitizePromptVariables：user/char 替换、DSH 变量保留、未知丢弃', () => {
  assert.equal(sanitizePromptVariables('{{user}}是主人', '林优子-重置'), '用户是主人')
  assert.equal(sanitizePromptVariables('我是{{char}}', '林优子-重置'), '我是林优子-重置')
  // DSH 自身注册变量保留给渲染器插值
  assert.equal(sanitizePromptVariables('模型是 {{model}}', 'X'), '模型是 {{model}}')
  // 未知变量丢弃，不残留花括号
  assert.equal(sanitizePromptVariables('见 {{random}} 内容', 'X'), '见  内容')
  // 混合
  assert.equal(
    sanitizePromptVariables('{{user}}与{{char}}在{{random}}地见面 {{provider}}', 'Aria'),
    '用户与Aria在地见面 {{provider}}',
  )
  // charName 缺省时 {{char}} 保留原文
  assert.equal(sanitizePromptVariables('{{char}}'), '{{char}}')
})

test('集成：激活含 {{user}} 的预设后，section 注入内容已清理（不再触发渲染报错）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const worldPath = join(dir, 'lore.json')
  writeFileSync(worldPath, JSON.stringify({
    name: 'lore',
    entries: [
      { keys: ['主人'], content: '{{user}}是唯一的主人。' },
      { keys: ['设定'], content: '我是{{char}}。', constant: true },
    ],
  }), 'utf8')
  const { byName, sections, disposers } = setup(dir)
  try {
    await byName('prompt_import_world')!.execute({ path: worldPath, activate: true })

    const section = sections.find(s => s.name === 'test:section')
    assert.ok(section, 'systemPrompt section should be registered')
    const text = section.text()
    assert.ok(!text.includes('{{user}}'), '注入内容不应残留 {{user}}')
    assert.ok(!text.includes('{{char}}'), '注入内容不应残留 {{char}}')
    assert.ok(text.includes('用户是唯一的主人。'))
    assert.ok(text.includes('我是lore·世界书。')) // {{char}} 替换为激活预设名
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
