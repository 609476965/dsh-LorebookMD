/**
 * host API 路由（/prompt-manager/api）集成测试：
 * 用 stub Context 捕获 webServer 注册的路由，模拟 HTTP 请求调用 handler，
 * 验证 JSON RPC 全流程与磁盘落盘。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import { apply } from '../src/index.ts'

interface StubCtx {
  webServer: { register(route: WebRoute): () => void }
  tools: { register(tool: unknown): void }
  systemPrompt: { section(section: { name: string; text: unknown }): () => void }
  on(event: string, handler: unknown): void
  emit(): void
  effect(fn: () => (() => void) | void): void
}

function stubCtx() {
  const routes: WebRoute[] = []
  const disposers: Array<() => void> = []
  const ctx: StubCtx = {
    webServer: {
      register(route) {
        routes.push(route)
        return () => { }
      },
    },
    tools: { register() { } },
    systemPrompt: { section() { return () => { } } },
    on() { },
    emit() { },
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
  }
  return { ctx, routes, disposers }
}

/** 构造带 JSON body 的假请求。 */
function fakeRequest(body: unknown): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage
  ;(req as unknown as { method: string }).method = 'POST'
  queueMicrotask(() => {
    req.emit('data', Buffer.from(JSON.stringify(body), 'utf8'))
    req.emit('end')
  })
  return req
}

/** 捕获响应的假 res。 */
function fakeResponse() {
  let status = 0
  let payload = ''
  const res = {
    writeHead(code: number) { status = code },
    end(text: string) { payload = text },
  } as unknown as ServerResponse
  return {
    res,
    get status(): number { return status },
    get body(): Record<string, unknown> { return JSON.parse(payload) as Record<string, unknown> },
  }
}

function setup(dataDir: string) {
  const { ctx, routes, disposers } = stubCtx()
  apply(ctx as never, { dataDir, sectionName: 'test:section', sectionOrder: 95, enableTools: false, watchFile: false, worldTrigger: true })
  const route = routes.find(r => r.path === '/prompt-manager/api')
  assert.ok(route, 'api route should be registered')
  return { handler: route.handler, disposers, dataDir }
}

async function post(handler: WebRoute['handler'], body: unknown) {
  const response = fakeResponse()
  await handler(fakeRequest(body), response.res)
  return response
}

test('api: upsert / list / get 全流程', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const { handler, disposers } = setup(dir)
  try {
    const created = await post(handler, { op: 'upsert', name: 'story', content: 'You are a storyteller.', description: '讲故事' })
    assert.equal(created.status, 200)
    assert.equal(created.body.ok, true)
    assert.equal((created.body.data as { created: boolean }).created, true)

    const listed = await post(handler, { op: 'list' })
    const data = listed.body.data as { active: unknown; presets: Array<{ name: string; description?: string }> }
    assert.equal(data.presets.length, 1)
    assert.equal(data.presets[0]?.name, 'story')
    assert.equal(data.presets[0]?.description, '讲故事')
    // list 不携带正文（轻量）
    assert.equal('content' in (data.presets[0] ?? {}), false)

    const got = await post(handler, { op: 'get', name: 'story' })
    assert.equal((got.body.data as { content: string }).content, 'You are a storyteller.')
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('api: use / off 切换激活并落盘', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const { handler, disposers } = setup(dir)
  try {
    await post(handler, { op: 'upsert', name: 'a', content: 'A' })
    await post(handler, { op: 'upsert', name: 'b', content: 'B' })
    const used = await post(handler, { op: 'use', name: 'b' })
    assert.equal((used.body.data as { active: string }).active, 'b')
    const off = await post(handler, { op: 'off' })
    assert.equal((off.body.data as { active: null }).active, null)

    const file = JSON.parse(readFileSync(join(dir, 'presets.json'), 'utf8')) as { active: string | null }
    assert.equal(file.active, null)
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('api: importTavern 从 JSON 角色卡导入', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const cardPath = join(dir, 'aria.json')
  writeFileSync(cardPath, JSON.stringify({
    spec: 'chara_card_v2',
    data: { name: 'Aria', description: 'Forest spirit.', personality: 'Calm.' },
  }), 'utf8')
  const { handler, disposers } = setup(dir)
  try {
    const imported = await post(handler, { op: 'importTavern', path: cardPath })
    assert.equal(imported.body.ok, true)
    const data = imported.body.data as { preset: string; kind: string }
    assert.equal(data.preset, 'Aria')
    assert.equal(data.kind, 'json')

    const got = await post(handler, { op: 'get', name: 'Aria' })
    const content = (got.body.data as { content: string }).content
    assert.ok(content.includes('[Description]\nForest spirit.'))
    assert.ok(content.includes('[Personality]\nCalm.'))
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('api: worlds 列表与 removeWorld 整组删除', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const cardPath = join(dir, 'aria.json')
  writeFileSync(cardPath, JSON.stringify({
    spec: 'chara_card_v2',
    data: {
      name: 'Aria',
      character_book: { name: 'book', entries: [{ keys: ['森林'], content: '薄雾。' }] },
    },
  }), 'utf8')
  const { handler, disposers } = setup(dir)
  try {
    await post(handler, { op: 'importTavern', path: cardPath })

    const listed = await post(handler, { op: 'worlds' })
    assert.equal(listed.body.ok, true)
    const data = listed.body.data as {
      active: string | null
      worlds: Array<{ name: string; worldPreset: string; writingPreset: string; entries: number; documentPath: string; activeMode: unknown }>
    }
    assert.equal(data.worlds.length, 1)
    const world = data.worlds[0]!
    assert.equal(world.name, 'Aria')
    assert.equal(world.worldPreset, 'Aria·世界书')
    assert.equal(world.writingPreset, 'Aria·创作')
    assert.equal(world.entries, 1)
    assert.equal(world.activeMode, null)
    assert.ok(world.documentPath.endsWith('worldbooks\\Aria.md'))

    // 激活创作预设后 activeMode 变为 writing
    await post(handler, { op: 'use', name: 'Aria·创作' })
    const afterUse = await post(handler, { op: 'worlds' })
    assert.equal((afterUse.body.data as { worlds: Array<{ activeMode: string }> }).worlds[0]?.activeMode, 'writing')

    // removeWorld 整组删除（双预设 + 文档）；角色预设本身独立保留
    const removed = await post(handler, { op: 'removeWorld', name: 'Aria' })
    assert.equal(removed.body.ok, true)
    const afterRemove = await post(handler, { op: 'worlds' })
    assert.equal((afterRemove.body.data as { worlds: unknown[] }).worlds.length, 0)
    const listed2 = await post(handler, { op: 'list' })
    const remaining = (listed2.body.data as { presets: Array<{ name: string }> }).presets
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0]?.name, 'Aria')
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('api: 错误路径（未知 op / 缺字段 / 非法 JSON）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const { handler, disposers } = setup(dir)
  try {
    const unknown = await post(handler, { op: 'nope' })
    assert.equal(unknown.body.ok, false)
    assert.ok(String(unknown.body.error).includes('unknown op'))

    const missing = await post(handler, { op: 'upsert', name: 'x' })
    assert.equal(missing.body.ok, false)
    assert.ok(String(missing.body.error).includes('content'))

    const badJson = fakeResponse()
    const req = new EventEmitter() as unknown as IncomingMessage
    ;(req as unknown as { method: string }).method = 'POST'
    queueMicrotask(() => {
      req.emit('data', Buffer.from('{not json', 'utf8'))
      req.emit('end')
    })
    await handler(req, badJson.res)
    assert.equal(badJson.status, 400)
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('api: openDocument 打开本地设定文档', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-plugin-'))
  const cardPath = join(dir, 'aria.json')
  writeFileSync(cardPath, JSON.stringify({
    spec: 'chara_card_v2',
    data: {
      name: 'Aria',
      character_book: { name: 'book', entries: [{ keys: ['森林'], content: '薄雾。' }] },
    },
  }), 'utf8')
  const { handler, disposers } = setup(dir)
  try {
    await post(handler, { op: 'importTavern', path: cardPath })

    // 文档存在 → ok，返回被打开的路径（打开动作尽力而为，不因环境差异报错）
    const opened = await post(handler, { op: 'openDocument', name: 'Aria' })
    assert.equal(opened.body.ok, true)
    assert.ok(String((opened.body.data as { opened: string }).opened).endsWith('worldbooks\\Aria.md'))

    // 文档不存在 → 明确报错
    const missing = await post(handler, { op: 'openDocument', name: 'NoSuchWorld' })
    assert.equal(missing.body.ok, false)
    assert.ok(String(missing.body.error).includes('document not found'))
  } finally {
    for (const dispose of disposers) dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
