/**
 * prompt-manager 数据核心：预设仓库。
 *
 * 纯逻辑、无文件系统耦合（持久化通过 PresetIo 端口注入），
 * 便于单元测试；插件主体（src/index.ts）提供基于 node:fs 的实现。
 */

export interface Preset {
  /** 预设唯一名（identity key；需要改名请删除后重建）。 */
  name: string
  /** 一句话说明，展示给用户/模型。 */
  description?: string
  /** 提示词正文。 */
  content: string
}

export interface PresetFile {
  active: string | null
  presets: Preset[]
}

/** 仓库的持久化端口：插件注入文件实现，测试注入内存实现。 */
export interface PresetIo {
  load(): PresetFile
  save(file: PresetFile): void
}

export type RepoResult =
  | { ok: true; created?: boolean }
  | { ok: false; message: string }

export class PresetRepo {
  private readonly io: PresetIo
  private state: PresetFile

  constructor(io: PresetIo) {
    this.io = io
    this.state = sanitize(this.io.load())
  }

  get active(): string | null {
    return this.state.active
  }

  /** 快照视图（只读）。 */
  list(): { active: string | null; presets: readonly Preset[] } {
    return { active: this.state.active, presets: this.state.presets }
  }

  /** 当前激活预设的正文；未激活或名字失效时返回 undefined。 */
  contentOf(name: string): string | undefined {
    return this.state.presets.find(p => p.name === name)?.content
  }

  /** 激活一个已存在的预设。 */
  use(name: string): RepoResult {
    if (!this.state.presets.some(p => p.name === name)) {
      return { ok: false, message: `preset "${name}" does not exist` }
    }
    this.state = { ...this.state, active: name }
    this.commit()
    return { ok: true }
  }

  /** 取消激活（系统提示词恢复原样）。 */
  off(): void {
    this.state = { ...this.state, active: null }
    this.commit()
  }

  /** 新建或按名字覆盖（修改）预设。更新时未提供的 description 保留旧值。 */
  upsert(input: { name: string; content: string; description?: string }): RepoResult {
    const name = input.name.trim()
    if (name === '') return { ok: false, message: 'preset name must not be empty' }
    if (input.content.trim() === '') return { ok: false, message: 'preset content must not be empty' }
    const existing = this.state.presets.find(p => p.name === name)
    const presets = existing === undefined
      ? [...this.state.presets, { name, content: input.content, description: input.description }]
      : this.state.presets.map(p => p.name === name
        ? { name, content: input.content, description: input.description ?? p.description }
        : p)
    this.state = { ...this.state, presets }
    this.commit()
    return { ok: true, created: existing === undefined }
  }

  /** 删除预设；若删除的是激活项则同时取消激活。 */
  remove(name: string): RepoResult {
    if (!this.state.presets.some(p => p.name === name)) {
      return { ok: false, message: `preset "${name}" does not exist` }
    }
    const presets = this.state.presets.filter(p => p.name !== name)
    this.state = {
      ...this.state,
      presets,
      active: this.state.active === name ? null : this.state.active,
    }
    this.commit()
    return { ok: true }
  }

  /** 外部修改数据文件后重新载入（热更新）。 */
  reload(): void {
    this.state = sanitize(this.io.load())
  }

  private commit(): void {
    this.io.save(this.state)
  }
}

/** 兜底清洗：过滤非法预设、纠正悬空的 active 引用。 */
function sanitize(file: PresetFile): PresetFile {
  const presets = Array.isArray(file.presets)
    ? file.presets.filter((p): p is Preset =>
        p !== null && typeof p === 'object'
        && typeof (p as Preset).name === 'string'
        && typeof (p as Preset).content === 'string')
    : []
  const active = typeof file.active === 'string' && presets.some(p => p.name === file.active)
    ? file.active
    : null
  return { active, presets }
}
