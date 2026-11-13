import type { SourceArbiter, ArbiterClaim } from './sourceArbiter.js'
import type { DetailSlot } from './detailBudget.js'

export function arbiterBudget(arbiter: SourceArbiter, priority: 'enrichment' | 'details'): DetailSlot {
  let heldClaim: ArbiterClaim | null = null

  return {
    claim(now: number): boolean {
      if (heldClaim !== null) return false
      const c = arbiter.claim(priority, undefined, now)
      heldClaim = c
      return c !== null
    },

    release(): void {
      if (heldClaim === null) return
      const toRelease = heldClaim
      heldClaim = null
      toRelease.release()
    }
  }
}
