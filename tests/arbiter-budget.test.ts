import { describe, it, expect } from 'vitest'
import { SourceArbiter } from '../src/collector/sourceArbiter.js'
import { arbiterBudget } from '../src/collector/arbiterBudget.js'
import { DetailBudget } from '../src/collector/detailBudget.js'

function seededRandom(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (1664525 * s + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe('arbiterBudget adapter', () => {
  describe('Equivalence with DetailBudget', () => {
    it('matches DetailBudget(2000) decisions with two callers over 3000 steps', () => {
      let now = 10_000
      const rand = seededRandom(42)
      const arbiter = new SourceArbiter({ now: () => now, minGapMs: 2000 })
      const enrichmentAdapter = arbiterBudget(arbiter, 'enrichment')
      const detailsAdapter = arbiterBudget(arbiter, 'details')
      const budget = new DetailBudget(2000)

      let caller0Holding = false
      let caller1Holding = false

      for (let step = 0; step < 3000; step++) {
        now += Math.floor(rand() * 1500)
        const caller = rand() < 0.5 ? 0 : 1
        const adapter = caller === 0 ? enrichmentAdapter : detailsAdapter
        const isHolding = caller === 0 ? caller0Holding : caller1Holding

        if (isHolding) {
          if (rand() < 0.5) {
            adapter.release()
            budget.release()
            if (caller === 0) caller0Holding = false
            else caller1Holding = false
          } else {
            const a = adapter.claim(now)
            const b = budget.claim(now)
            expect(a).toBe(false)
            expect(b).toBe(false)
          }
        } else {
          const a = adapter.claim(now)
          const b = budget.claim(now)
          expect(a).toBe(b)
          if (a) {
            if (caller === 0) caller0Holding = true
            else caller1Holding = true
          }
        }
      }
    })

    it('matches DetailBudget(5000) decisions with single details caller over 3000 steps', () => {
      let now = 20_000
      const rand = seededRandom(1337)
      const arbiter = new SourceArbiter({ now: () => now, minGapMs: 5000 })
      const adapter = arbiterBudget(arbiter, 'details')
      const budget = new DetailBudget(5000)

      let holding = false

      for (let step = 0; step < 3000; step++) {
        now += Math.floor(rand() * 3000)

        if (holding) {
          if (rand() < 0.5) {
            adapter.release()
            budget.release()
            holding = false
          } else {
            const a = adapter.claim(now)
            const b = budget.claim(now)
            expect(a).toBe(false)
            expect(b).toBe(false)
          }
        } else {
          const a = adapter.claim(now)
          const b = budget.claim(now)
          expect(a).toBe(b)
          if (a) holding = true
        }
      }
    })

    it('exact reproduction: grants at boundary when arbiter clock reads 10001 during first claim and 12000 during second', () => {
      let arbiterNow = 10_001
      const arbiter = new SourceArbiter({
        now: () => arbiterNow,
        minGapMs: 2000
      })
      const adapter = arbiterBudget(arbiter, 'details')
      const budget = new DetailBudget(2000)

      expect(adapter.claim(10_000)).toBe(true)
      expect(budget.claim(10_000)).toBe(true)

      adapter.release()
      budget.release()

      arbiterNow = 12_000
      const adapterGranted = adapter.claim(12_000)
      const budgetGranted = budget.claim(12_000)

      expect(adapterGranted).toBe(true)
      expect(budgetGranted).toBe(true)
    })

    it('matches DetailBudget(2000) decisions over 3000 steps with arbiter clock diverging from caller timestamps', () => {
      let callerNow = 10_000
      const rand = seededRandom(999)
      const arbiter = new SourceArbiter({
        now: () => callerNow + 500 + Math.floor(rand() * 100),
        minGapMs: 2000
      })
      const enrichmentAdapter = arbiterBudget(arbiter, 'enrichment')
      const detailsAdapter = arbiterBudget(arbiter, 'details')
      const budget = new DetailBudget(2000)

      let caller0Holding = false
      let caller1Holding = false

      for (let step = 0; step < 3000; step++) {
        callerNow += Math.floor(rand() * 1500)
        const caller = rand() < 0.5 ? 0 : 1
        const adapter = caller === 0 ? enrichmentAdapter : detailsAdapter
        const isHolding = caller === 0 ? caller0Holding : caller1Holding

        if (isHolding) {
          if (rand() < 0.5) {
            adapter.release()
            budget.release()
            if (caller === 0) caller0Holding = false
            else caller1Holding = false
          } else {
            const a = adapter.claim(callerNow)
            const b = budget.claim(callerNow)
            expect(a).toBe(false)
            expect(b).toBe(false)
          }
        } else {
          const a = adapter.claim(callerNow)
          const b = budget.claim(callerNow)
          expect(a).toBe(b)
          if (a) {
            if (caller === 0) caller0Holding = true
            else caller1Holding = true
          }
        }
      }
    })
  })

  describe('Adapter invariants', () => {
    it('returns false on second claim while holding and does not call arbiter.claim', () => {
      const now = 1000
      const arbiter = new SourceArbiter({ now: () => now, minGapMs: 2000 })
      let claimCalls = 0
      const origClaim = arbiter.claim.bind(arbiter)
      arbiter.claim = (priority, onPreempt) => {
        claimCalls++
        return origClaim(priority, onPreempt)
      }

      const adapter = arbiterBudget(arbiter, 'details')
      expect(adapter.claim(now)).toBe(true)
      expect(claimCalls).toBe(1)

      expect(adapter.claim(now)).toBe(false)
      expect(claimCalls).toBe(1)
    })

    it('treats release without a claim as a no-op', () => {
      const arbiter = new SourceArbiter({ now: () => 1000, minGapMs: 2000 })
      const adapter = arbiterBudget(arbiter, 'enrichment')

      expect(() => adapter.release()).not.toThrow()
      expect(arbiter.snapshot().detailHolder).toBeNull()

      expect(adapter.claim(1000)).toBe(true)
      adapter.release()
      expect(() => adapter.release()).not.toThrow()
      expect(arbiter.snapshot().detailHolder).toBeNull()
    })

    it('denies claim inside the gap after release and grants after the gap', () => {
      let now = 5000
      const arbiter = new SourceArbiter({ now: () => now, minGapMs: 2000 })
      const adapter = arbiterBudget(arbiter, 'enrichment')

      expect(adapter.claim(now)).toBe(true)
      now = 5500
      adapter.release()

      now = 5600
      expect(adapter.claim(now)).toBe(false)

      now = 6999
      expect(adapter.claim(now)).toBe(false)

      now = 7000
      expect(adapter.claim(now)).toBe(true)
    })
  })

  describe('Poll claims independence', () => {
    it('does not alter adapter decisions when poll is claimed before, during, or after adapter claims', () => {
      let now = 10_000
      const arbiter = new SourceArbiter({ now: () => now, minGapMs: 2000 })
      const adapter = arbiterBudget(arbiter, 'enrichment')
      const budget = new DetailBudget(2000)

      // 1. Claim a poll before adapter claim
      const poll1 = arbiter.claim('poll')
      expect(poll1).not.toBeNull()
      const a1 = adapter.claim(now)
      const b1 = budget.claim(now)
      expect(a1).toBe(true)
      expect(b1).toBe(true)
      poll1?.release()
      adapter.release()
      budget.release()

      // 2. Claim a poll during adapter claim
      now = 15_000
      const a2 = adapter.claim(now)
      const b2 = budget.claim(now)
      expect(a2).toBe(true)
      expect(b2).toBe(true)
      const poll2 = arbiter.claim('poll')
      expect(poll2).not.toBeNull()
      expect(adapter.claim(now)).toBe(false)
      expect(budget.claim(now)).toBe(false)
      adapter.release()
      budget.release()
      poll2?.release()

      // 3. Claim a poll after adapter claims
      now = 20_000
      const a3 = adapter.claim(now)
      const b3 = budget.claim(now)
      expect(a3).toBe(true)
      expect(b3).toBe(true)
      adapter.release()
      budget.release()

      const poll3 = arbiter.claim('poll')
      expect(poll3).not.toBeNull()

      now = 21_000
      expect(adapter.claim(now)).toBe(false)
      expect(budget.claim(now)).toBe(false)

      now = 22_001
      expect(adapter.claim(now)).toBe(true)
      expect(budget.claim(now)).toBe(true)

      poll3?.release()
      adapter.release()
      budget.release()
    })
  })
})
