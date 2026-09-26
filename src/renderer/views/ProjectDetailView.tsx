import React from 'react'
import { rased } from '../api.js'
import { categoryDisplay } from '@shared/categories.js'
import type { PersonalStatus, ProjectDetails, ProjectFull } from '@shared/types.js'
import { STRINGS, type Lang } from '../i18n.js'
import { budgetLabel, fullDate, timeAgo } from '../format.js'
import { ConfirmDialog, EmptyState, SkeletonList } from '../components/ui.js'
import { Icon } from '../components/Icon.js'
import { registerNavigationBlocker, requestAction } from '../router.js'

function statusLabel(s: PersonalStatus, lang: Lang): string {
  const t = STRINGS[lang]
  if (s === 'interested') return t.statusInterested
  if (s === 'submitted') return t.statusSubmitted
  if (s === 'ignored') return t.statusIgnored
  return t.statusNone
}

export function ProjectDetailView({
  lang,
  projectId,
  onBack
}: {
  lang: Lang
  projectId: number
  onBack: () => void
}): React.ReactElement {
  const t = STRINGS[lang]
  const [project, setProject] = React.useState<ProjectFull | null>(null)
  const [details, setDetails] = React.useState<ProjectDetails | null>(null)
  const [missing, setMissing] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [savedNote, setSavedNote] = React.useState('')
  const [justSaved, setJustSaved] = React.useState(false)
  const [confirmLeave, setConfirmLeave] = React.useState<null | (() => void)>(null)
  const [copied, setCopied] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const markedRead = React.useRef(false)
  const autoRequested = React.useRef(false)
  const generation = React.useRef(0)
  const noteRef = React.useRef({ note, savedNote })
  noteRef.current = { note, savedNote }
  const dirty = note !== savedNote

  const load = React.useCallback(async () => {
    const my = ++generation.current
    const [p, d] = await Promise.all([rased.getProject(projectId), rased.getProjectDetails(projectId)])
    if (my !== generation.current) return
    if (!p) {
      setMissing(true)
      return
    }
    setProject(p)
    setMissing(false)
    setDetails(d)
    // on-demand full text: once per mount (retry button handles the rest)
    if (!autoRequested.current && d) {
      autoRequested.current = true
      const fresh = await rased.requestProjectDetails(projectId, d.status === 'failed')
      if (my !== generation.current) return
      setDetails(fresh)
    }
    // keep local note edits; adopt the stored note only when untouched
    if (noteRef.current.note === noteRef.current.savedNote && p.note !== noteRef.current.savedNote) {
      setNote(p.note)
      setSavedNote(p.note)
    }
    if (!p.readAt && !markedRead.current) {
      markedRead.current = true
      await rased.setReadState(projectId, true)
      const fresh = await rased.getProject(projectId)
      if (fresh && my === generation.current) setProject(fresh)
    }
  }, [projectId])

  React.useEffect(() => {
    markedRead.current = false
    void load()
    return () => { generation.current++ }
  }, [load])

  React.useEffect(() => {
    const offP = rased.onProjectsChanged((e) => {
      if (e.changedIds.includes(projectId) || e.newIds.includes(projectId)) void load()
    })
    const offD = rased.onDetailsChanged((e) => {
      if (e.projectIds.includes(projectId)) void load()
    })
    return () => {
      offP()
      offD()
    }
  }, [projectId, load])

  const attemptBack = React.useCallback(() => {
    onBack()
  }, [onBack])

  React.useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent): void => {
      if (noteRef.current.note === noteRef.current.savedNote) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  React.useEffect(() => {
    return registerNavigationBlocker((proceed) => {
      if (noteRef.current.note === noteRef.current.savedNote) return true
      setConfirmLeave(() => proceed)
      return false
    })
  }, [])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
        if (target.matches('input, textarea, select, [contenteditable]')) return
        e.preventDefault()
        if (project) void rased.updateProjectUserState(project.id, { saved: !project.saved }).then(() => load())
        return
      }
      if (e.key === 'Escape' && !target.matches('input, textarea, select')) attemptBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [attemptBack, project, load])

  if (missing) {
    return (
      <div className="detail-wrap">
        <EmptyState title={t.emptyFilter} actions={<button className="btn primary" onClick={onBack}>{t.backToProjects}</button>} />
      </div>
    )
  }
  if (!project) {
    return (
      <div className="detail-wrap">
        <SkeletonList lang={lang} rows={4} />
      </div>
    )
  }

  const budget = budgetLabel(project.budgetMin, project.budgetMax)
  const saveNote = async (): Promise<boolean> => {
    const draft = noteRef.current.note
    try {
      const r = await rased.updateProjectUserState(project.id, { note: draft })
      if (!r.ok) { setActionError(r.error ?? 'save-failed'); return false }
      noteRef.current.savedNote = draft
      setSavedNote(draft)
      setJustSaved(true)
      setActionError(null)
      setTimeout(() => setJustSaved(false), 2500)
      return true
    } catch (err) { setActionError(String(err)); return false }
  }

  const openExternal = async (): Promise<void> => {
    try {
      const r = await rased.openProjectExternal(project.id)
      setActionError(r.ok ? null : (lang === 'ar' ? 'تعذر فتح المتصفح: ' : 'Could not open browser: ') + r.error)
    } catch (err) { setActionError(String(err)) }
  }

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(project.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="split">
      <div className="detail-wrap">
        <div className="detail-article">
          <button className="btn ghost sm" onClick={attemptBack}>
            <Icon name="back" size={15} /> {t.backToProjects}
          </button>
          <div className="meta">
            <span className="muted">{t.projectDetails}</span>
            <span className="faint" aria-hidden="true">
              ·
            </span>
            <span className="muted">مستقل</span>
          </div>
          <h2 dir="auto">{project.title}</h2>
          <div className="meta">
            {!project.readAt && <span className="tag fresh">{t.newBadge}</span>}
            {project.saved && <span className="tag">{t.savedBadge}</span>}
            {project.hidden && <span className="tag uncertain">{t.hiddenBadge}</span>}
          </div>

          <div className="facts">
            <div className="fact">
              <div className="k">{t.factsCategory}</div>
              <div className="v" dir="auto">
                {project.categorySlug ? (categoryDisplay(project.categorySlug, lang) ?? project.categorySlug) : t.unknownCategory}
                {!project.categoryConfirmed && <div className="faint small">{t.uncertainCategory}</div>}
              </div>
            </div>
            <div className="fact">
              <div className="k">{t.factsBudget}</div>
              <div className="v num" dir="ltr">
                {budget ?? t.budgetUnknown}
              </div>
            </div>
            <div className="fact">
              <div className="k">{t.factsPublished}</div>
              <div className="v" title={fullDate(project.publishedAt, lang)}>
                {timeAgo(project.publishedAt, lang)}
              </div>
            </div>
            <div className="fact">
              <div className="k">{t.factsDiscovered}</div>
              <div className="v" title={fullDate(project.firstSeenAt, lang)}>
                {timeAgo(project.firstSeenAt, lang)}
              </div>
            </div>
          </div>

          <h3>{t.descriptionTitle}</h3>
          <div className="faint small">
            {details?.provenance === 'full' ? t.descFullNote : details?.provenance === 'truncated' ? (lang === 'ar' ? 'وصف مقتطع لطوله — افتح مستقل للنص كاملًا' : 'Description truncated — open Mostaql for the complete text') : t.descExcerptNote}
            {details?.fetchedAt ? ` · ${t.descFetchedAt} ${timeAgo(details.fetchedAt, lang)}` : ''}
          </div>
          <div className="prose" dir="auto">
            {(details?.text ?? project.descriptionExcerpt).split(/\n{2,}|\n/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
          {details?.status === 'failed' && (
            <div className="banner warn">
              {t.detailsUnavailable}
              <span className="spacer" />
              <button className="btn sm" onClick={() => void rased.requestProjectDetails(project.id, true).then(() => load())}>
                {t.retryFetch}
              </button>
            </div>
          )}
          {details?.status === 'loading' && <p className="muted">{t.loadingDetails}</p>}
          <button className="btn sm" onClick={() => void rased.requestProjectDetails(project.id, true).then(() => load())}>{t.retryFetch}</button>

          {project.skills && project.skills.length > 0 && (
            <>
              <h3>{t.skills}</h3>
              <div className="chips">
                {project.skills.map((s) => (
                  <span key={s} className="tag" dir="auto">
                    {s}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <aside className="detail-rail" aria-label={t.projectDetails}>
        <div className="detail-wrap">
          {actionError && <p role="alert" className="field-err">{actionError}</p>}
          <button className="btn primary" onClick={() => void openExternal()}>
            <Icon name="external" size={16} /> {t.openExternal}
          </button>
          <div className="row-actions">
            <button className="btn sm" onClick={() => void rased.updateProjectUserState(project.id, { saved: !project.saved }).then(() => load())} aria-pressed={project.saved}>
              <Icon name={project.saved ? 'bookmarkFill' : 'bookmark'} size={15} /> {project.saved ? t.unsaveProject : t.saveProject}
            </button>
            <button className="btn sm" onClick={copyLink}>
              <Icon name="copy" size={15} /> {copied ? t.copied : t.copyLink}
            </button>
          </div>

          <h3>{t.personalStatus}</h3>
          <select
            className="select"
            aria-label={t.personalStatus}
            value={project.personalStatus}
            onChange={(e) => {
              void rased.updateProjectUserState(project.id, { status: e.target.value as PersonalStatus }).then(() => load())
            }}
          >
            <option value="none">{t.statusNone}</option>
            <option value="interested">{t.statusInterested}</option>
            <option value="submitted">{t.statusSubmitted}</option>
            <option value="ignored">{t.statusIgnored}</option>
          </select>
          <p className="faint small">{statusLabel(project.personalStatus, lang)}</p>

          <h3>{t.noteTitle}</h3>
          <textarea
            className="textarea"
            dir="auto"
            maxLength={5000}
            placeholder={t.notePlaceholder}
            aria-label={t.noteTitle}
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              setJustSaved(false)
            }}
          />
          <div className="meta">
            <span className="num">
              {note.length}/5000 {t.noteChars}
            </span>
            {dirty ? <span className="tag uncertain">{t.noteUnsaved}</span> : justSaved ? <span className="tag good">{t.noteSaved}</span> : null}
          </div>
          <button className="btn sm primary" disabled={!dirty} onClick={() => void saveNote()}>
            {t.noteSave}
          </button>

          <div className="row-actions">
            <button
              className="btn sm ghost"
              onClick={() => {
                requestAction(() => { void rased.updateProjectUserState(project.id, { hidden: !project.hidden }).then((r) => {
                  if (!r.ok) { setActionError(r.error ?? 'hide-failed'); return }
                  if (!project.hidden) onBack()
                  else void load()
                }) })
              }}
            >
              <Icon name={project.hidden ? 'eye' : 'eyeOff'} size={15} /> {project.hidden ? t.unhideProject : t.hideProject}
            </button>
          </div>
          <p className="faint small">{t.localDataNote}</p>
        </div>
      </aside>

      {confirmLeave && (
        <ConfirmDialog
          lang={lang}
          title={t.unsavedNoteTitle}
          body={t.unsavedNoteBody}
          confirmLabel={t.noteSave}
          onConfirm={() => {
            void saveNote().then((ok) => {
              if (!ok) return
              const fn = confirmLeave
              setConfirmLeave(null)
              fn()
            })
          }}
          onCancel={() => setConfirmLeave(null)}
          extraAction={<button className="btn danger" onClick={() => {
            const fn = confirmLeave
            noteRef.current.note = noteRef.current.savedNote
            setNote(savedNote)
            setConfirmLeave(null)
            fn()
          }}>{lang === 'ar' ? 'تجاهل التغييرات' : 'Discard changes'}</button>}
        />
      )}
    </div>
  )
}
