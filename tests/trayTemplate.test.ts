import { describe, expect, it } from 'vitest'
import { toTemplateBitmap } from '../src/main/platform/trayTemplate.js'

describe('toTemplateBitmap', () => {
  it('turns BGRA pixels black while preserving alpha', () => {
    const src = Buffer.from([
      10, 20, 30, 255, // opaque blue-ish
      40, 50, 60, 0, // transparent
      200, 150, 100, 128 // semi-transparent
    ])
    const out = toTemplateBitmap(src)
    expect([...out]).toEqual([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 128])
  })

  it('returns a new buffer and does not mutate the input', () => {
    const src = Buffer.from([1, 2, 3, 4])
    const out = toTemplateBitmap(src)
    expect(out).not.toBe(src)
    expect([...src]).toEqual([1, 2, 3, 4])
  })
})
