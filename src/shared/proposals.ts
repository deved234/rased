import type { AiProviderId } from './ai.js'
export const GEMINI_MODEL = 'gemini-2.5-flash'

export interface ProposalProfile {
  skills: string
  experience: string
  portfolio: string
  tone: string
  language: 'ar' | 'en'
}

export const emptyProposalProfile = (): ProposalProfile => ({ skills: '', experience: '', portfolio: '', tone: '', language: 'ar' })

export interface ProposalPreview {
  projectId: number
  title: string
  description: string
  provenance: 'full' | 'truncated' | 'excerpt'
  category: string | null
  skills: string[]
  budget: string | null
  profile: ProposalProfile
  projectNotes: string
  fingerprint: string
  model: string
  provider: AiProviderId
  promptVersion: string
}

export interface ProposalDraft {
  projectId: number
  proposal: string
  assumptions: string[]
  questions: string[]
  updatedAt: string
  provider?: AiProviderId | null
  model?: string | null
  promptVersion?: string | null
  generatedAt?: string | null
}

export interface ProposalResult {
  ok: boolean
  error?: string
  retryAfterSeconds?: number
  draft?: ProposalDraft
}

export function sanitizeProposalProfile(value: unknown): ProposalProfile | null {
  if (!value || typeof value !== 'object') return null
  const p = value as Record<string, unknown>
  const field = (name: string, max: number): string | null => typeof p[name] === 'string' && (p[name] as string).length <= max ? (p[name] as string).trim() : null
  const skills = field('skills', 2000)
  const experience = field('experience', 3000)
  const portfolio = field('portfolio', 3000)
  const tone = field('tone', 500)
  if (skills === null || experience === null || portfolio === null || tone === null || (p.language !== 'ar' && p.language !== 'en')) return null
  return { skills, experience, portfolio, tone, language: p.language }
}
