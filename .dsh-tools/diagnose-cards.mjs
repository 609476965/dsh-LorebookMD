/**
 * 临时诊断脚本：实测角色卡/正则文件的解析结果（world / regex 检测）。
 * 用法：node .dsh-tools/diagnose-cards.mjs <file...>
 */
import { readFileSync } from 'node:fs'

const { parseTavernFile, parseRegexScriptsJson, parseWorldInfoJson } = await import('../src/tavern.ts')

function inspectWorld(rawWorld, indent) {
  if (rawWorld === undefined || rawWorld === null) return `${indent}world: 无`
  const lines = []
  if (Array.isArray(rawWorld)) lines.push(`${indent}world: 数组(entries=${rawWorld.length})`)
  else {
    const keys = Object.keys(rawWorld)
    lines.push(`${indent}world: 对象 keys=[${keys.join(',')}]`)
    const entries = rawWorld.entries
    if (Array.isArray(entries)) lines.push(`${indent}  entries 数组，条目数=${entries.length}`)
    else if (entries !== undefined && typeof entries === 'object') lines.push(`${indent}  entries 对象，条目数=${Object.keys(entries).length}`)
  }
  return lines.join('\n')
}

function scan(path) {
  const buffer = readFileSync(path)
  const sig = buffer.subarray(0, 8).toString('hex')
  const isPng = sig === '89504e470d0a1a0a'
  console.log(`\n========== ${path}`)
  console.log(`  类型: ${isPng ? 'PNG' : (path.endsWith('.json') ? 'JSON' : '其他')}  大小: ${buffer.length}`)

  if (path.endsWith('.json') && !isPng) {
    // 先试角色卡解析
    try {
      const parsed = parseTavernFile(buffer)
      console.log(`  角色卡: name=${parsed.data.name ?? '(无)'} spec=${parsed.spec ?? '(无)'}`)
      console.log(`  world: ${parsed.world === undefined ? '未检测到' : `检测到 (entries=${parsed.world.entries.length})`}`)
      console.log(`  regex: ${parsed.regexScripts === undefined ? '未检测到' : `检测到 (${parsed.regexScripts.length})`}`)
      if (parsed.world === undefined) {
        // 检查原始 JSON 里 world 的位置
        try {
          const json = JSON.parse(buffer.toString('utf8'))
          const data = typeof json.spec === 'string' && json.data ? json.data : json
          console.log(`  [原始结构] 顶层 keys=[${Object.keys(json).slice(0, 15).join(',')}]`)
          if (data.extensions !== undefined) {
            console.log(`  [原始结构] data.extensions keys=[${Object.keys(data.extensions).slice(0, 15).join(',')}]`)
            if (data.extensions.world !== undefined) console.log(inspectWorld(data.extensions.world, '  '))
            else console.log(`  [原始结构] data.extensions.world: 不存在`)
          } else console.log(`  [原始结构] data.extensions: 不存在`)
          if (data.world !== undefined) console.log(inspectWorld(data.world, '  [data.world] '))
        } catch { console.log('  (顶层不是对象)') }
      }
    } catch (error) {
      console.log(`  角色卡解析失败: ${error.message}`)
      // 也许是大模型 json / 正则包
      try {
        const regex = parseRegexScriptsJson(buffer.toString('utf8'))
        console.log(`  → 是正则脚本包 (${regex.length} 个脚本)`)
      } catch { }
      try {
        const world = parseWorldInfoJson(buffer.toString('utf8'))
        console.log(`  → 是世界书 (${world.entries.length} 条)`)
      } catch { }
    }
  } else if (isPng) {
    try {
      const parsed = parseTavernFile(buffer)
      console.log(`  角色卡: name=${parsed.data.name ?? '(无)'} spec=${parsed.spec ?? '(无)'}`)
      console.log(`  world: ${parsed.world === undefined ? '未检测到' : `检测到 (entries=${parsed.world.entries.length})`}`)
      console.log(`  regex: ${parsed.regexScripts === undefined ? '未检测到' : `检测到 (${parsed.regexScripts.length})`}`)
      if (parsed.world === undefined) console.log('  → PNG 已成功解析出角色卡数据，但其中没有 world 字段')
    } catch (error) {
      console.log(`  不是角色卡: ${error.message}`)
    }
  } else {
    console.log('  跳过（非 PNG/JSON）')
  }
}

for (const path of process.argv.slice(2)) {
  try {
    scan(path)
  } catch (error) {
    console.log(`\n========== ${path}\n  读取失败: ${error.message}`)
  }
}
