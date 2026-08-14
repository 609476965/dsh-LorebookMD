/**
 * 集成测试：用 stub Context 真实调用插件 apply，验证：
 * - systemPrompt section 与 5 个管理工具被注册
 * - 工具能完成 保存 → 列表 → 切换 → 停用 → 修改 → 删除 全流程
 * - 数据真实落盘（presets.json）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../src/index.ts'

interface StubTool {
  name: string
  execute(args: Record<string, unknown>): Promise<unknown>
}

interface StubCtx {
  webServer: { register(route: { kind: string; path: string; handler: unknown }): () => void }
  tools: { register(tool: StubTool): void }
  systemPrompt: { section(section: { name: string; text: unknown }): () => void }
  on(event: string, handler: unknown): void
  emit(): void
  effect(fn: () => (() => void) | void): void
}

function stubCtx() {
  const tools: StubTool[] = []
  const disposers: Array<() => void> = []
  const ctx: StubCtx = {
    webServer: { register() { return () => { } } },
    tools: { register(tool) { tools.push(tool) } },
    systemPrompt: { section() { return () => { } } },
    on() { },
    emit() { },
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
  }
  return { ctx, tools, disposers }
}

test('integration: apply 注册 section 与工具，工具全流程可落盘', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const { ctx, tools, disposers } = stubCtx()
  apply(ctx as never, {
    dataDir: dir,
    sectionName: 'test:section',
    sectionOrder: 95,
    enableTools: true,
    watchFile: true,
    worldTrigger: true,
  })
  try {
    const byName = (n: string) => tools.find(t => t.name === n)
    for (const n of ['prompt_preset_list', 'prompt_preset_use', 'prompt_preset_off', 'prompt_preset_save', 'prompt_preset_delete']) {
      assert.ok(byName(n), `tool ${n} should be registered`)
    }

    const save = byName('prompt_preset_save')!
    const list = byName('prompt_preset_list')!
    const use = byName('prompt_preset_use')!
    const off = byName('prompt_preset_off')!
    const remove = byName('prompt_preset_delete')!

    assert.equal(await save.execute({ name: 'story', content: 'You are a storyteller.' }), 'Created preset "story"')
    assert.equal(await save.execute({ name: 'coder', content: 'You are a senior engineer.' }), 'Created preset "coder"')

    const listed = await list.execute({}) as { active: unknown; presets: Array<{ name: string }> }
    assert.equal(listed.presets.length, 2)

    assert.equal(await use.execute({ name: 'story' }), 'Active preset: story')
    assert.equal((await list.execute({}) as { active: unknown }).active, 'story')
    assert.equal(await off.execute({}), 'Prompt preset deactivated')
    assert.equal((await list.execute({}) as { active: unknown }).active, null)

    assert.equal(await save.execute({ name: 'story', content: 'v2' }), 'Updated preset "story"')
    assert.equal(await use.execute({ name: 'story' }), 'Active preset: story')

    // 已真实落盘
    const file = JSON.parse(readFileSync(join(dir, 'presets.json'), 'utf8')) as {
      active: string | null
      presets: Array<{ name: string; content: string }>
    }
    assert.equal(file.active, 'story')
    assert.equal(file.presets.find(p => p.name === 'story')?.content, 'v2')

    // 使用不存在的预设报错
    await assert.rejects(() => use.execute({ name: 'nope' }), /does not exist/)

    assert.equal(await remove.execute({ name: 'coder' }), 'Deleted preset "coder"')
    assert.equal(await remove.execute({ name: 'story' }), 'Deleted preset "story"')
    assert.equal((await list.execute({}) as { presets: unknown[] }).presets.length, 0)
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('integration: prompt_import_tavern 从 JSON 角色卡导入预设并可切换', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const cardPath = join(dir, 'aria.json')
  writeFileSync(cardPath, JSON.stringify({
    spec: 'chara_card_v2',
    data: {
      name: 'Aria',
      description: 'A mysterious forest spirit.',
      personality: 'Calm, curious.',
      scenario: 'At the forest edge.',
      first_mes: '*She tilts her head.* Hello, traveler.',
      creator: 'test-author',
    },
  }), 'utf8')

  const { ctx, tools, disposers } = stubCtx()
  apply(ctx as never, { dataDir: dir, sectionName: 'test:section', sectionOrder: 95, enableTools: true, watchFile: true, worldTrigger: true })
  try {
    const byName = (n: string) => tools.find(t => t.name === n)
    const importer = byName('prompt_import_tavern')!
    const list = byName('prompt_preset_list')!

    const imported = await importer.execute({ path: cardPath }) as { preset: string; created: boolean; kind: string; character: string }
    assert.equal(imported.preset, 'Aria')
    assert.equal(imported.created, true)
    assert.equal(imported.kind, 'json')
    assert.equal(imported.character, 'Aria')

    // 导入的预设可直接激活，且内容包含角色卡字段
    assert.equal(await byName('prompt_preset_use')!.execute({ name: 'Aria' }), 'Active preset: Aria')
    const file = JSON.parse(readFileSync(join(dir, 'presets.json'), 'utf8')) as {
      active: string | null
      presets: Array<{ name: string; content: string; description?: string }>
    }
    assert.equal(file.active, 'Aria')
    const preset = file.presets.find(p => p.name === 'Aria')
    assert.ok(preset?.content.includes('[Personality]\nCalm, curious.'))
    assert.ok(preset?.content.includes('*She tilts her head.* Hello, traveler.'))
    assert.ok(preset?.description?.includes('test-author'))

    // name 覆盖
    const renamed = await importer.execute({ path: cardPath, name: 'Aria-cn' }) as { preset: string }
    assert.equal(renamed.preset, 'Aria-cn')
    assert.equal((await list.execute({}) as { presets: unknown[] }).presets.length, 2)

    // 不存在的文件报错
    await assert.rejects(() => importer.execute({ path: join(dir, 'nope.png') }), /cannot read/)
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
