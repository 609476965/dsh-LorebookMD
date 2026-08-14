/**
 * 世界书 · 小说创作设置页（settings.section 分区）。
 *
 * 数据经 host 的 `/prompt-manager/api`（同源 fetch）读写，与 host 半共享
 * 同一份 presets.json / worldbooks.json。界面聚焦小说创作场景：
 * - 世界书列表：一键「进入创作」（激活 ·创作 预设）或「世界书模式」（关键词触发）
 * - 导入：角色卡（内嵌世界书）或独立世界书 JSON
 * - 本地设定文档路径展示（worldbooks/<名>.md，可直接编辑）
 */

import { useCallback, useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

import {
  deactivatePreset, importTavern, importWorld, listWorlds, openWorldDocument, removeWorld, usePreset,
  type WorldView,
} from './presets-api.ts'
import css from './PresetsSection.module.css'

export type PresetsSectionProps = PropsRuntime<'settings.section'>

export function PresetsSection(_props: PresetsSectionProps) {
  const [worlds, setWorlds] = useState<readonly WorldView[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const [cardPath, setCardPath] = useState('')
  const [worldPath, setWorldPath] = useState('')

  const refresh = useCallback(async () => {
    try {
      const next = await listWorlds()
      setActive(next.active)
      setWorlds(next.worlds)
      setError(undefined)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    setError(undefined)
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.page}>
      <h2 className={css.heading}>世界书 · 小说创作</h2>
      <p className={css.intro}>
        导入世界书（角色卡内嵌或独立 JSON），激活「创作」模式后输入场景，模型将参考设定创作小说。
        每本世界书会生成创作预设与本地设定文档（worldbooks/&lt;名&gt;.md，可直接编辑）。
      </p>

      {error !== undefined && <p className={css.error}>{error}</p>}

      <div className={css.toolbar}>
        <button type="button" className={css.button} disabled={busy} onClick={() => { void run(() => Promise.resolve()) }}>
          刷新
        </button>
        {active !== null && (
          <button
            type="button"
            className={css.button}
            disabled={busy}
            onClick={() => { void run(deactivatePreset) }}
          >
            停用当前模式
          </button>
        )}
      </div>

      {worlds.length === 0 && !busy && (
        <p className={css.empty}>还没有世界书。用下方导入角色卡或世界书 JSON。</p>
      )}

      <ul className={css.list}>
        {worlds.map(world => {
          const writingActive = world.activeMode === 'writing'
          const worldActive = world.activeMode === 'world'
          return (
            <li key={world.name} className={css.item}>
              <div className={css.itemHeader}>
                <span className={css.itemName}>
                  {world.name}
                  {writingActive && <span className={css.activeBadge}>创作模式中</span>}
                  {worldActive && <span className={css.worldBadge}>世界书模式</span>}
                </span>
                <span className={css.itemActions}>
                  {!writingActive && (
                    <button
                      type="button"
                      className={css.buttonPrimary}
                      disabled={busy}
                      onClick={() => { void run(() => usePreset(world.writingPreset)) }}
                    >
                      进入创作
                    </button>
                  )}
                  {!worldActive && (
                    <button
                      type="button"
                      className={css.button}
                      disabled={busy}
                      onClick={() => { void run(() => usePreset(world.worldPreset)) }}
                    >
                      世界书模式
                    </button>
                  )}
                  <button
                    type="button"
                    className={css.button}
                    disabled={busy}
                    onClick={() => { void run(() => openWorldDocument(world.name)) }}
                  >
                    编辑文档
                  </button>
                  <button
                    type="button"
                    className={css.buttonDanger}
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`删除世界书 "${world.name}"（含创作预设与本地文档）？`)) {
                        void run(() => removeWorld(world.name))
                      }
                    }}
                  >
                    删除
                  </button>
                </span>
              </div>
              <p className={css.itemDescription}>
                {world.entries} 条设定条目 · 文档：{world.documentPath}
              </p>
            </li>
          )
        })}
      </ul>

      <div className={css.card}>
        <h3 className={css.cardTitle}>导入角色卡（.png / .json）</h3>
        <label className={css.field}>
          文件路径
          <input value={cardPath} onChange={e => { setCardPath(e.target.value) }} placeholder="C:/path/to/card.png" />
        </label>
        <p className={css.hint}>
          角色卡内嵌的世界书（extensions.world / character_book）会生成「·世界书」「·创作」预设与本地设定文档。
        </p>
        <div className={css.actions}>
          <button
            type="button"
            className={css.button}
            disabled={busy || cardPath.trim() === ''}
            onClick={() => {
              const path = cardPath.trim()
              void run(() => importTavern(path)).then(() => { setCardPath('') })
            }}
          >
            导入
          </button>
        </div>
      </div>

      <div className={css.card}>
        <h3 className={css.cardTitle}>导入独立世界书（JSON）</h3>
        <label className={css.field}>
          文件路径（{'{'} "entries": [...] {'}'}）
          <input value={worldPath} onChange={e => { setWorldPath(e.target.value) }} placeholder="C:/path/to/lorebook.json" />
        </label>
        <div className={css.actions}>
          <button
            type="button"
            className={css.button}
            disabled={busy || worldPath.trim() === ''}
            onClick={() => {
              const path = worldPath.trim()
              void run(() => importWorld(path, undefined, false)).then(() => { setWorldPath('') })
            }}
          >
            导入
          </button>
        </div>
      </div>
    </div>
  )
}
