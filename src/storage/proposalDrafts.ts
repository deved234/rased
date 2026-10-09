import type { Db } from './db.js'
import type { ProposalDraft } from '../shared/proposals.js'

export function getProposalDraft(db: Db, projectId: number): ProposalDraft | null {
  const row = db.prepare('SELECT proposal, assumptions_json, questions_json, updated_at, provider, model, prompt_version, generated_at FROM proposal_drafts WHERE project_id = ?').get(projectId) as { proposal: string; assumptions_json: string; questions_json: string; updated_at: string; provider: ProposalDraft['provider']; model: string | null; prompt_version: string | null; generated_at: string | null } | undefined
  if (!row) return null
  return { projectId, proposal: row.proposal, assumptions: JSON.parse(row.assumptions_json) as string[], questions: JSON.parse(row.questions_json) as string[], updatedAt: row.updated_at, provider: row.provider, model: row.model, promptVersion: row.prompt_version, generatedAt: row.generated_at }
}

export function saveProposalDraft(db: Db, draft: ProposalDraft): void {
  db.prepare(`INSERT INTO proposal_drafts (project_id, proposal, assumptions_json, questions_json, updated_at, provider, model, prompt_version, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET proposal=excluded.proposal,
    assumptions_json=excluded.assumptions_json, questions_json=excluded.questions_json, updated_at=excluded.updated_at,
    provider=excluded.provider, model=excluded.model, prompt_version=excluded.prompt_version, generated_at=excluded.generated_at`)
    .run(draft.projectId, draft.proposal, JSON.stringify(draft.assumptions), JSON.stringify(draft.questions), draft.updatedAt, draft.provider ?? null, draft.model ?? null, draft.promptVersion ?? null, draft.generatedAt ?? null)
}

export function deleteProposalDraft(db: Db, projectId: number): void {
  db.prepare('DELETE FROM proposal_drafts WHERE project_id = ?').run(projectId)
}
