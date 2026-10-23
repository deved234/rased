import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_ERROR_CODES } from '../src/shared/ai.js'
import { phases } from '../src/shared/extension/protocol.js'

// The public guide is the only place users can look up a failure code, so keep it
// mechanically in sync with the runtime contracts instead of trusting prose review.
const quickApplyGuide = readFileSync(join(__dirname, '..', 'docs', 'QUICK_APPLY.md'), 'utf8')
const documented = new Set(
  quickApplyGuide.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|/)
    return match?.[1] ? [match[1]] : []
  })
)

const quickApplySource = readFileSync(join(__dirname, '..', 'src', 'shared', 'quickApply.ts'), 'utf8')
const quickApplyErrors = [...(quickApplySource.match(/export type QuickApplyError =([^\n]+)/)?.[1] ?? '')
  .matchAll(/'([a-z-]+)'/g)].map(match => match[1] ?? '')

// extensionStatus.ts does not export its message map, and renderer internals stay
// untouched: read the authored keys from the source text instead.
const extensionStatusSource = readFileSync(join(__dirname, '..', 'src', 'renderer', 'components', 'extensionStatus.ts'), 'utf8')
const messageBlock = extensionStatusSource.match(/const quickErrorMessages: Record<string, Bilingual> = \{([\s\S]*?)\n\}/)?.[1] ?? ''
const messageKeys = [...messageBlock.matchAll(/^\s+'?([a-z][a-z-]*)'?:/gm)].map(match => match[1] ?? '')

function uncovered(codes: readonly string[]): string[] {
  return codes.filter(code => !documented.has(code))
}

describe('Quick Apply guide coverage', () => {
  it('parses a non-empty set of documented codes and runtime lists', () => {
    expect(documented.size).toBeGreaterThanOrEqual(40)
    expect(phases).toHaveLength(10)
    expect(quickApplyErrors.length).toBeGreaterThanOrEqual(13)
    expect(messageKeys.length).toBeGreaterThanOrEqual(27)
    expect(AI_ERROR_CODES.length).toBeGreaterThanOrEqual(21)
  })

  it('documents every preparation phase', () => {
    expect(uncovered(phases)).toEqual([])
  })

  it('documents every QuickApplyError code', () => {
    expect(uncovered(quickApplyErrors)).toEqual([])
  })

  it('documents every quickErrorText message key', () => {
    expect(uncovered(messageKeys)).toEqual([])
  })

  it('documents every delegated AI provider error code', () => {
    expect(uncovered(AI_ERROR_CODES)).toEqual([])
  })
})
