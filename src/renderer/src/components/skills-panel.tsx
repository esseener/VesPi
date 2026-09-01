import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Plus, Sparkles, RefreshCw, Play, Trash2, Wand2 } from 'lucide-react'
import { useAppStore } from '../store'
import { MarkdownRenderer } from './markdown-renderer'
import type { InstalledSkill } from '../../../shared/ipc-contracts'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

const SOURCE_ORDER: InstalledSkill['source'][] = ['project', 'vespi', 'openspace', 'bundled']

const SOURCE_LABEL: Record<InstalledSkill['source'], 'skillSourceProject' | 'skillSourceVespi' | 'skillSourceOpenspace' | 'skillSourceBundled'> = {
  project: 'skillSourceProject',
  vespi: 'skillSourceVespi',
  openspace: 'skillSourceOpenspace',
  bundled: 'skillSourceBundled',
}

const ORIGIN_LABEL: Record<string, 'skillOriginImported' | 'skillOriginCaptured' | 'skillOriginDerived' | 'skillOriginFixed'> = {
  imported: 'skillOriginImported',
  captured: 'skillOriginCaptured',
  derived: 'skillOriginDerived',
  fixed: 'skillOriginFixed',
}

export function SkillsPanel(): React.JSX.Element {
  const skills = useAppStore((s) => s.installedSkills)
  const language = useAppStore((s) => s.settingsDraft.language ?? s.settings?.language ?? DEFAULT_LANGUAGE)
  const loadSkills = useAppStore((s) => s.loadSkills)
  const createSkill = useAppStore((s) => s.createSkill)
  const deleteSkill = useAppStore((s) => s.deleteSkill)
  const evolveSkill = useAppStore((s) => s.evolveSkill)
  const insertPrompt = useAppStore((s) => s.insertPrompt)
  const setCurrentView = useAppStore((s) => s.setCurrentView)

  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [detail, setDetail] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [direction, setDirection] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  const grouped = useMemo(() => {
    const by = new Map<string, InstalledSkill[]>()
    for (const s of skills) {
      const arr = by.get(s.source) ?? []
      arr.push(s)
      by.set(s.source, arr)
    }
    return SOURCE_ORDER.filter((src) => by.has(src)).map((src) => ({
      source: src,
      items: by.get(src)!,
    }))
  }, [skills])

  const selected = skills.find((s) => s.path === selectedPath) ?? null

  useEffect(() => {
    let cancelled = false
    if (!selected) {
      setDetail('')
      return
    }
    window.piDesktop.files
      .read(selected.path)
      .then((content) => {
        if (!cancelled) setDetail(typeof content === 'string' ? content : '')
      })
      .catch(() => {
        if (!cancelled) setDetail('')
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  const runSkill = (skill: InstalledSkill): void => {
    insertPrompt(`/skill:${skill.name} `, true)
    setCurrentView('chat')
  }

  const onCreate = async (): Promise<void> => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await createSkill(name, newDescription.trim())
      if (!result.ok) {
        setNotice(result.error ?? t(language, 'error'))
        return
      }
      setCreating(false)
      setNewName('')
      setNewDescription('')
      if (result.path) setSelectedPath(result.path)
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (skill: InstalledSkill): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await deleteSkill(skill.path)
      if (!result.ok) {
        setNotice(result.error ?? t(language, 'error'))
        return
      }
      setSelectedPath(null)
    } finally {
      setBusy(false)
    }
  }

  const onEvolve = async (skill: InstalledSkill): Promise<void> => {
    const text = direction.trim()
    if (!text || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await evolveSkill(skill.path, text)
      if (!result.ok) {
        setNotice(result.error ?? t(language, 'error'))
        return
      }
      setDirection('')
      setNotice(t(language, 'evolveSkillDone'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex h-12 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-muted" />
            <h2 className="text-sm font-medium text-primary">{t(language, 'skills')}</h2>
            <span className="rounded-full bg-card px-2 py-0.5 text-xs text-dim">
              {skills.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCreating((open) => !open)}
              className="rounded p-1 text-dim hover:bg-surface-hover hover:text-secondary"
              title={t(language, 'addSkill')}
              aria-label={t(language, 'addSkill')}
            >
              <Plus size={13} />
            </button>
            <button
              onClick={() => loadSkills()}
              className="rounded p-1 text-dim hover:bg-surface-hover hover:text-secondary"
              title={t(language, 'refresh')}
              aria-label={t(language, 'refreshSkills')}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
        <div className="border-b border-border px-4 py-2 text-[10px] uppercase tracking-wide text-faint">
          {t(language, 'skillLocalMode')}
        </div>
        {creating ? (
          <div className="space-y-2 border-b border-border px-4 py-3">
            <div className="text-xs font-medium text-primary">{t(language, 'addSkillTitle')}</div>
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t(language, 'skillNamePlaceholder')}
              className="w-full rounded border border-border bg-card px-2 py-1 text-xs text-primary"
            />
            <textarea
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              placeholder={t(language, 'skillDescriptionPlaceholder')}
              rows={3}
              className="w-full resize-none rounded border border-border bg-card px-2 py-1 text-xs text-primary"
            />
            <button
              onClick={() => void onCreate()}
              disabled={busy || !newName.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {t(language, 'createSkill')}
            </button>
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto py-1">
          {skills.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-faint">
              {t(language, 'noSkillsInPaths')}
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.source} className="mb-2">
                <div className="px-4 py-1 text-[10px] uppercase tracking-wide text-faint">
                  {t(language, SOURCE_LABEL[group.source])}
                </div>
                {group.items.map((skill) => (
                  <button
                    key={skill.path}
                    onClick={() => setSelectedPath(skill.path)}
                    className={clsx(
                      'flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left transition-colors',
                      skill.path === selectedPath ? 'bg-card' : 'hover:bg-surface-hover/50'
                    )}
                  >
                    <span className="truncate text-sm text-primary">{skill.name}</span>
                    <span className="line-clamp-1 text-xs text-dim">{skill.description}</span>
                    {skill.origin || skill.generation ? (
                      <span className="text-[10px] text-faint">
                        {[
                          skill.origin ? t(language, ORIGIN_LABEL[skill.origin] ?? 'skillOriginImported') : null,
                          typeof skill.generation === 'number' ? t(language, 'skillGeneration', { n: String(skill.generation) }) : null,
                        ].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {selected ? (
          <>
            <div className="flex h-12 items-center justify-between border-b border-border px-4">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium text-primary">{selected.name}</h3>
                <p className="truncate text-xs text-faint">{selected.path}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {selected.managed ? (
                  <button
                    onClick={() => void onDelete(selected)}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-secondary hover:bg-surface-hover disabled:opacity-50"
                  >
                    <Trash2 size={12} />
                    {t(language, 'deleteSkill')}
                  </button>
                ) : null}
                <button
                  onClick={() => runSkill(selected)}
                  className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover transition-colors"
                >
                  <Play size={12} />
                  {t(language, 'runSkill')}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2 text-xs text-dim">
              {selected.origin ? <span>{t(language, ORIGIN_LABEL[selected.origin] ?? 'skillOriginImported')}</span> : null}
              {typeof selected.generation === 'number' ? <span>{t(language, 'skillGeneration', { n: String(selected.generation) })}</span> : null}
              {typeof selected.uses === 'number' ? <span>{t(language, 'skillUses', { n: String(selected.uses) })}</span> : null}
              {typeof selected.successes === 'number' ? <span>{t(language, 'skillSuccesses', { n: String(selected.successes) })}</span> : null}
            </div>
            {selected.changeSummary ? (
              <div className="border-b border-border px-4 py-2 text-xs text-secondary">{selected.changeSummary}</div>
            ) : null}
            {selected.managed ? (
              <div className="space-y-2 border-b border-border px-4 py-3">
                <div className="text-xs text-dim">{t(language, 'evolveSkillHint')}</div>
                <textarea
                  value={direction}
                  onChange={(event) => setDirection(event.target.value)}
                  placeholder={t(language, 'evolveSkillPlaceholder')}
                  rows={3}
                  className="w-full resize-none rounded border border-border bg-card px-2 py-1 text-xs text-primary"
                />
                <button
                  onClick={() => void onEvolve(selected)}
                  disabled={busy || !direction.trim()}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-secondary hover:bg-surface-hover disabled:opacity-50"
                >
                  <Wand2 size={12} />
                  {busy ? t(language, 'evolvingSkill') : t(language, 'evolveSkill')}
                </button>
              </div>
            ) : null}
            {notice ? <div className="px-4 py-2 text-xs text-secondary">{notice}</div> : null}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <MarkdownRenderer content={detail} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-faint">
            <div>{t(language, 'noSkillsInPaths')}</div>
            <div className="text-xs">{t(language, 'installSkillsHint')}</div>
          </div>
        )}
      </div>
    </div>
  )
}
