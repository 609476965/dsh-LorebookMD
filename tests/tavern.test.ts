/**
 * 酒馆角色卡解析与转换的单元测试。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'

import {
  composeTavernContent,
  describeTavernCard,
  isPng,
  parseTavernFile,
  type TavernCharacterFields,
} from '../src/tavern.ts'

// --- PNG fixture 生成器：按 PNG 规范构造 chunk（CRC 不校验，写 0） ---

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)])
}

/** 1x1 RGBA 白色像素的合法 PNG，可附加 chara tEXt 块。 */
function makePng(charaText: string | undefined): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0) // width
  ihdr.writeUInt32BE(1, 4) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const idat = deflateSync(Buffer.from([0, 255, 255, 255, 255])) // filter + 1px RGBA
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr)]
  if (charaText !== undefined) {
    parts.push(chunk('tEXt', Buffer.concat([Buffer.from('chara\0', 'latin1'), Buffer.from(charaText, 'latin1')])))
  }
  parts.push(chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

const V2_CARD = {
  spec: 'chara_card_v2',
  data: {
    name: 'Aria',
    description: 'A mysterious forest spirit.',
    personality: 'Calm, curious, protective.',
    scenario: 'You meet her at the edge of the forest.',
    first_mes: '*She tilts her head.* Hello, traveler.',
    mes_example: '<START>\n{{user}}: Hi\n{{char}}: Welcome.',
    system_prompt: 'Always describe the environment with rich sensory detail.',
    post_history_instructions: 'Keep responses under 200 words.',
    creator: 'test-author',
    tags: ['fantasy', 'soft'],
    alternate_greetings: ['*A breeze stirs.*', 'You found me.'],
    creator_notes: 'internal notes',
  },
}

const LEGACY_CARD = {
  name: 'OldBot',
  description: 'Legacy card without spec.',
}

test('isPng 识别 PNG 签名', () => {
  assert.equal(isPng(makePng(undefined)), true)
  assert.equal(isPng(Buffer.from('not a png')), false)
})

test('解析 PNG 内嵌 base64 角色卡（chara_card_v2）', () => {
  const b64 = Buffer.from(JSON.stringify(V2_CARD), 'utf8').toString('base64')
  const parsed = parseTavernFile(makePng(b64))
  assert.equal(parsed.kind, 'png-embed')
  assert.equal(parsed.spec, 'chara_card_v2')
  assert.equal(parsed.data.name, 'Aria')
  assert.equal(parsed.data.description, 'A mysterious forest spirit.')
  assert.equal(parsed.data.system_prompt, 'Always describe the environment with rich sensory detail.')
  assert.deepEqual(parsed.data.tags, ['fantasy', 'soft'])
  assert.deepEqual(parsed.data.alternate_greetings, ['*A breeze stirs.*', 'You found me.'])
})

test('解析 PNG 内嵌未 base64 的 JSON 文本（兼容）', () => {
  const parsed = parseTavernFile(makePng(JSON.stringify(LEGACY_CARD)))
  assert.equal(parsed.kind, 'png-embed')
  assert.equal(parsed.data.name, 'OldBot')
  assert.equal(parsed.spec, undefined)
})

test('PNG 无 chara 数据时报错', () => {
  assert.throws(() => parseTavernFile(makePng(undefined)), /chara/)
})

test('解析 JSON 角色卡（chara_card_v2）', () => {
  const parsed = parseTavernFile(Buffer.from(JSON.stringify(V2_CARD), 'utf8'))
  assert.equal(parsed.kind, 'json')
  assert.equal(parsed.spec, 'chara_card_v2')
  assert.equal(parsed.data.name, 'Aria')
})

test('解析旧版 JSON 角色卡（字段直接置顶）', () => {
  const parsed = parseTavernFile(Buffer.from(JSON.stringify(LEGACY_CARD), 'utf8'))
  assert.equal(parsed.kind, 'json')
  assert.equal(parsed.spec, undefined)
  assert.equal(parsed.data.name, 'OldBot')
  assert.equal(parsed.data.description, 'Legacy card without spec.')
})

test('非法 JSON / 空文件报错', () => {
  assert.throws(() => parseTavernFile(Buffer.from('{not json', 'utf8')), /无法解析/)
  assert.throws(() => parseTavernFile(Buffer.alloc(0)), /为空/)
})

test('composeTavernContent 按序拼接非空字段、跳过空字段', () => {
  const data: TavernCharacterFields = {
    description: 'Desc here.',
    personality: 'Brave.',
    scenario: 'In a cave.',
    mes_example: undefined,
    system_prompt: '',
    alternate_greetings: ['Alt one.', 'Alt two.'],
  }
  const content = composeTavernContent(data, 'Aria')
  assert.ok(content.startsWith('You are roleplaying as Aria.'))
  assert.ok(content.includes('[Description]\nDesc here.'))
  assert.ok(content.includes('[Personality]\nBrave.'))
  assert.ok(content.includes('[Scenario]\nIn a cave.'))
  assert.ok(content.includes('[Alternate greetings]\nAlt one.\n\n---\n\nAlt two.'))
  assert.ok(!content.includes('[Example messages]'))
  assert.ok(!content.includes('[System prompt]'))
  // 字段顺序：Description 在 Personality 之前
  assert.ok(content.indexOf('[Description]') < content.indexOf('[Personality]'))
})

test('composeTavernContent 全空时只剩角色声明', () => {
  assert.equal(composeTavernContent({}, 'Aria'), 'You are roleplaying as Aria.')
})

test('describeTavernCard 生成一句话说明', () => {
  const parsed = parseTavernFile(Buffer.from(JSON.stringify(V2_CARD), 'utf8'))
  const description = describeTavernCard(parsed)
  assert.ok(description.includes('Aria'))
  assert.ok(description.includes('json'))
  assert.ok(description.includes('test-author'))
  assert.ok(description.includes('fantasy, soft'))
})
