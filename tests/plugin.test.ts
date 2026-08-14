/**
 * my-plugin（prompt-manager）示例测试。
 *
 * 用 Node 内置测试运行器执行（Node >= 22.18 原生剥离 TS 类型）：
 *
 *   npm test            # 等价于: node --test tests/
 *
 * 断言同样可在 vitest 下无改动运行。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PresetRepo, type PresetFile } from '../src/preset-repo.ts'
import { Config } from '../src/index.ts'

/** 内存版持久化端口：模拟文件行为，可断言保存结果。 */
function memoryIo() {
  let file: PresetFile | undefined
  return {
    io: {
      load: (): PresetFile => file ?? { active: null, presets: [] },
      save: (next: PresetFile): void => { file = next },
    },
    get saved(): PresetFile | undefined { return file },
  }
}

/** Schemastery 的 Standard Schema v1 校验接口（类型上未导出，这里按形状断言）。 */
type StandardSchemaLike = {
  '~standard': {
    validate(value: unknown): { value: Record<string, unknown> } | { issues: unknown[] }
  }
}

test('空仓库：列表为空，use 不存在的预设报错', () => {
  const { io } = memoryIo()
  const repo = new PresetRepo(io)
  assert.equal(repo.active, null)
  assert.deepEqual(repo.list().presets, [])
  assert.equal(repo.use('nope').ok, false)
  assert.equal(repo.remove('nope').ok, false)
})

test('upsert 新建预设并持久化', () => {
  const mem = memoryIo()
  const repo = new PresetRepo(mem.io)
  const result = repo.upsert({ name: 'story', content: 'You are a storyteller.' })
  assert.ok(result.ok)
  assert.equal(result.created, true)
  assert.equal(repo.contentOf('story'), 'You are a storyteller.')
  assert.equal(mem.saved?.presets.length, 1)
  assert.equal(mem.saved?.active, null)
})

test('upsert 同名覆盖即修改，且未提供的 description 保留旧值', () => {
  const { io } = memoryIo()
  const repo = new PresetRepo(io)
  repo.upsert({ name: 'story', content: 'v1', description: 'first version' })
  const result = repo.upsert({ name: 'story', content: 'v2' })
  assert.ok(result.ok)
  assert.equal(result.created, false)
  assert.equal(repo.contentOf('story'), 'v2')
  assert.equal(repo.list().presets[0]?.description, 'first version')
})

test('use / off 切换激活预设并持久化 active 指针', () => {
  const mem = memoryIo()
  const repo = new PresetRepo(mem.io)
  repo.upsert({ name: 'a', content: 'A' })
  repo.upsert({ name: 'b', content: 'B' })
  assert.equal(repo.use('b').ok, true)
  assert.equal(repo.active, 'b')
  assert.equal(mem.saved?.active, 'b')
  repo.off()
  assert.equal(repo.active, null)
  assert.equal(mem.saved?.active, null)
})

test('删除激活中的预设会自动取消激活', () => {
  const { io } = memoryIo()
  const repo = new PresetRepo(io)
  repo.upsert({ name: 'a', content: 'A' })
  repo.use('a')
  assert.equal(repo.remove('a').ok, true)
  assert.equal(repo.active, null)
  assert.equal(repo.list().presets.length, 0)
})

test('空 name / 空 content 的预设被拒绝', () => {
  const { io } = memoryIo()
  const repo = new PresetRepo(io)
  assert.equal(repo.upsert({ name: '   ', content: 'x' }).ok, false)
  assert.equal(repo.upsert({ name: 'ok', content: '   ' }).ok, false)
})

test('reload 热载入外部修改：悬空 active 被纠正', () => {
  const mem = memoryIo()
  const repo = new PresetRepo(mem.io)
  repo.upsert({ name: 'a', content: 'A' })
  repo.upsert({ name: 'b', content: 'B' })
  repo.use('a')
  // 模拟文件被手工改成：active 指向已不存在的 a
  mem.io.save({ active: 'a', presets: [{ name: 'b', content: 'B' }] })
  repo.reload()
  assert.equal(repo.active, null)
  assert.deepEqual(repo.list().presets.map(p => p.name), ['b'])
  assert.equal(mem.saved?.presets.length, 1)
})

test('sanitize 过滤非法预设条目', () => {
  const { io } = memoryIo()
  io.save({ active: null, presets: [
    { name: 'good', content: 'ok' },
    { name: 'missing-content' } as never,
    'not-an-object' as never,
    null as never,
  ] })
  const repo = new PresetRepo(io)
  assert.deepEqual(repo.list().presets.map(p => p.name), ['good'])
})

test('Config schema 为空配置填充默认值', () => {
  const result = (Config as unknown as StandardSchemaLike)['~standard'].validate({})
  if ('issues' in result) throw new Error('empty config should validate')
  assert.equal(result.value.sectionName, 'prompt-manager:active')
  assert.equal(result.value.sectionOrder, 95)
  assert.equal(result.value.enableTools, true)
  assert.equal(result.value.watchFile, true)
  assert.equal(typeof result.value.dataDir, 'string')
  assert.ok(String(result.value.dataDir).length > 0)
})

test('Config schema 保留显式传入的值', () => {
  const result = (Config as unknown as StandardSchemaLike)['~standard'].validate({
    dataDir: '~/custom/presets',
    sectionName: 'my:section',
    sectionOrder: 10,
    enableTools: false,
    watchFile: false,
  })
  if ('issues' in result) throw new Error('config should validate')
  assert.equal(result.value.dataDir, '~/custom/presets')
  assert.equal(result.value.sectionName, 'my:section')
  assert.equal(result.value.sectionOrder, 10)
  assert.equal(result.value.enableTools, false)
  assert.equal(result.value.watchFile, false)
})
