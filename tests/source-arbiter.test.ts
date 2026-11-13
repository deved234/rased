import { describe, expect, it } from 'vitest'
import { DetailBudget } from '../src/collector/detailBudget.js'
import {
  ARBITER_EXPECTED_INITIAL_MS,
  ARBITER_EXPECTED_MAX_MS,
  ARBITER_EXPECTED_WINDOW,
  ARBITER_WATCH_MARGIN_MS,
  SourceArbiter,
  type ArbiterClaim
} from '../src/collector/sourceArbiter.js'

describe('SourceArbiter', () => {
  it('a. enrichment and details reproduce DetailBudget exactly across table-driven runs', () => {
    const gaps = [2000, 5000]
    const priorities: ('details' | 'enrichment')[] = ['details', 'enrichment']

    for (const gap of gaps) {
      for (const priority of priorities) {
        let currentTime = 0
        const budget = new DetailBudget(gap)
        const arbiter = new SourceArbiter({
          now: () => currentTime,
          minGapMs: gap
        })

        let currentArbiterClaim: ArbiterClaim | null = null

        interface TableStep {
          time: number
          action: 'claim' | 'release'
        }

        const steps: TableStep[] = [
          { time: 0, action: 'claim' },
          { time: 0, action: 'claim' },
          { time: Math.floor(gap / 2), action: 'claim' },
          { time: Math.floor(gap / 2), action: 'release' },
          { time: Math.floor(gap / 2) + 50, action: 'claim' },
          { time: gap - 1, action: 'claim' },
          { time: gap, action: 'claim' },
          { time: gap, action: 'claim' },
          { time: gap + 100, action: 'release' },
          { time: gap + 150, action: 'claim' },
          { time: 2 * gap, action: 'claim' },
          { time: 2 * gap + 500, action: 'release' },
          { time: 10 * gap, action: 'claim' },
          { time: 10 * gap + 100, action: 'release' }
        ]

        for (const step of steps) {
          currentTime = step.time
          if (step.action === 'claim') {
            const budgetGranted = budget.claim(currentTime)
            const claim = arbiter.claim(priority)
            const arbiterGranted = claim !== null
            expect(
              arbiterGranted,
              `step at time ${step.time} for gap ${gap} and priority ${priority} mismatch`
            ).toBe(budgetGranted)

            if (claim !== null) {
              currentArbiterClaim = claim
            }
          } else {
            budget.release()
            if (currentArbiterClaim) {
              currentArbiterClaim.release()
              currentArbiterClaim = null
            }
          }
        }
      }
    }
  })

  it('b. poll is always granted (except concurrent poll), ignores gap, and overlaps active detail claims', () => {
    let currentTime = 0
    const arbiter = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 2000
    })

    const poll1 = arbiter.claim('poll')
    expect(poll1).not.toBeNull()
    expect(arbiter.snapshot().pollActive).toBe(true)

    const pollConcurrent = arbiter.claim('poll')
    expect(pollConcurrent).toBeNull()

    poll1?.release()
    expect(arbiter.snapshot().pollActive).toBe(false)

    currentTime = 500
    const enrichClaim = arbiter.claim('enrichment')
    expect(enrichClaim).not.toBeNull()
    expect(arbiter.snapshot().detailHolder).toBe('enrichment')

    currentTime = 600
    const poll2 = arbiter.claim('poll')
    expect(poll2).not.toBeNull()
    expect(arbiter.snapshot().pollActive).toBe(true)
    expect(arbiter.snapshot().detailHolder).toBe('enrichment')

    const poll3 = arbiter.claim('poll')
    expect(poll3).toBeNull()

    poll2?.release()
    expect(arbiter.snapshot().pollActive).toBe(false)
    expect(arbiter.snapshot().detailHolder).toBe('enrichment')

    enrichClaim?.release()
    expect(arbiter.snapshot().detailHolder).toBeNull()

    currentTime = 3000
    const detailsClaim = arbiter.claim('details')
    expect(detailsClaim).not.toBeNull()

    currentTime = 3100
    const poll4 = arbiter.claim('poll')
    expect(poll4).not.toBeNull()
    expect(arbiter.snapshot().pollActive).toBe(true)
    expect(arbiter.snapshot().detailHolder).toBe('details')

    poll4?.release()
    detailsClaim?.release()
    expect(arbiter.snapshot().pollActive).toBe(false)
    expect(arbiter.snapshot().detailHolder).toBeNull()
  })

  it('c. watch is denied under blocking conditions and granted at the exact boundary', () => {
    let currentTime = 10_000
    const arbiter = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 2000
    })

    const poll = arbiter.claim('poll')
    expect(arbiter.claim('watch')).toBeNull()
    poll?.release()
    const w1 = arbiter.claim('watch')
    expect(w1).not.toBeNull()
    w1?.release()

    currentTime = 13_000
    const detail = arbiter.claim('details')
    expect(arbiter.claim('watch')).toBeNull()
    detail?.release()

    currentTime = 16_000
    arbiter.want('enrichment')
    expect(arbiter.claim('watch')).toBeNull()
    expect(arbiter.snapshot().waiting).toEqual(['enrichment'])
    arbiter.unwant('enrichment')
    expect(arbiter.snapshot().waiting).toEqual([])

    arbiter.want('details')
    expect(arbiter.claim('watch')).toBeNull()
    expect(arbiter.snapshot().waiting).toEqual(['details'])
    arbiter.unwant('details')
    expect(arbiter.snapshot().waiting).toEqual([])

    currentTime = 20_000
    const d2 = arbiter.claim('details')
    d2?.release()
    currentTime = 21_000
    expect(arbiter.claim('watch')).toBeNull()
    currentTime = 21_999
    expect(arbiter.claim('watch')).toBeNull()
    currentTime = 22_000
    const wGapOk = arbiter.claim('watch')
    expect(wGapOk).not.toBeNull()
    wGapOk?.release()

    currentTime = 30_000
    const expected = arbiter.expectedMs()
    expect(expected).toBe(ARBITER_EXPECTED_INITIAL_MS)
    const needed = expected + ARBITER_WATCH_MARGIN_MS

    arbiter.setNextPollDue(currentTime + needed - 1)
    expect(arbiter.claim('watch')).toBeNull()

    arbiter.setNextPollDue(currentTime - 1)
    expect(arbiter.claim('watch')).toBeNull()

    arbiter.setNextPollDue(currentTime)
    expect(arbiter.claim('watch')).toBeNull()

    arbiter.setNextPollDue(currentTime + needed)
    const wBoundary = arbiter.claim('watch')
    expect(wBoundary).not.toBeNull()
    wBoundary?.release()

    arbiter.setNextPollDue(null)
    currentTime = 40_000
    const wNoPoll = arbiter.claim('watch')
    expect(wNoPoll).not.toBeNull()
    wNoPoll?.release()
  })

  it('d. preemption: watch active is preempted by poll, details, and enrichment, and throwing onPreempt is safe', () => {
    let currentTime = 1000
    const arbiter = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 2000
    })

    let preemptCount = 0
    const watch1 = arbiter.claim('watch', () => {
      preemptCount++
    })
    expect(watch1).not.toBeNull()
    expect(arbiter.snapshot().detailHolder).toBe('watch')
    expect(arbiter.snapshot().preemptions).toBe(0)

    const pollClaim = arbiter.claim('poll')
    expect(pollClaim).not.toBeNull()
    expect(preemptCount).toBe(1)
    expect(arbiter.snapshot().detailHolder).toBeNull()
    expect(arbiter.snapshot().preemptions).toBe(1)

    currentTime = 3500
    const detailsClaim = arbiter.claim('details')
    expect(detailsClaim).not.toBeNull()
    expect(arbiter.snapshot().detailHolder).toBe('details')

    watch1?.release({ ok: true })
    expect(arbiter.snapshot().detailHolder).toBe('details')
    watch1?.release({ ok: true })
    expect(arbiter.snapshot().detailHolder).toBe('details')

    detailsClaim?.release()
    pollClaim?.release()
    expect(arbiter.snapshot().detailHolder).toBeNull()

    currentTime = 6000
    let preemptDetailsCount = 0
    const watch2 = arbiter.claim('watch', () => {
      preemptDetailsCount++
    })
    expect(watch2).not.toBeNull()

    currentTime = 8500
    const detailsClaim2 = arbiter.claim('details')
    expect(detailsClaim2).not.toBeNull()
    expect(preemptDetailsCount).toBe(1)
    expect(arbiter.snapshot().detailHolder).toBe('details')
    expect(arbiter.snapshot().preemptions).toBe(2)

    watch2?.release({ ok: true })
    expect(arbiter.snapshot().detailHolder).toBe('details')
    detailsClaim2?.release()

    currentTime = 11_000
    let preemptEnrichCount = 0
    const watch3 = arbiter.claim('watch', () => {
      preemptEnrichCount++
    })
    expect(watch3).not.toBeNull()

    currentTime = 13_500
    const enrichClaim = arbiter.claim('enrichment')
    expect(enrichClaim).not.toBeNull()
    expect(preemptEnrichCount).toBe(1)
    expect(arbiter.snapshot().detailHolder).toBe('enrichment')
    expect(arbiter.snapshot().preemptions).toBe(3)

    watch3?.release({ ok: true })
    expect(arbiter.snapshot().detailHolder).toBe('enrichment')
    enrichClaim?.release()

    currentTime = 16_000
    const throwingWatch = arbiter.claim('watch', () => {
      throw new Error('Explosion in onPreempt callback')
    })
    expect(throwingWatch).not.toBeNull()

    expect(() => {
      const p = arbiter.claim('poll')
      expect(p).not.toBeNull()
      p?.release()
    }).not.toThrow()

    expect(arbiter.snapshot().preemptions).toBe(4)
    expect(arbiter.snapshot().detailHolder).toBeNull()
  })

  it('e. expected duration: clamping, filters, and windowing', () => {
    let currentTime = 0
    const arbiter = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 2000
    })

    expect(arbiter.expectedMs()).toBe(ARBITER_EXPECTED_INITIAL_MS)

    const c1 = arbiter.claim('details')
    currentTime = 1000
    c1?.release({ ok: true })
    expect(arbiter.expectedMs()).toBe(1000)

    currentTime = 3000
    const c2 = arbiter.claim('details')
    currentTime = 5000
    c2?.release({ ok: true })
    expect(arbiter.expectedMs()).toBe(1500)

    currentTime = 7000
    const c3 = arbiter.claim('details')
    currentTime = 10_000
    c3?.release({ ok: true })
    expect(arbiter.expectedMs()).toBe(2000)

    currentTime = 12_000
    const cClamped = arbiter.claim('details')
    currentTime = 72_000
    cClamped?.release({ ok: true })
    expect(arbiter.expectedMs()).toBe((1000 + 2000 + 3000 + ARBITER_EXPECTED_MAX_MS) / 4)

    currentTime = 75_000
    const cFailed = arbiter.claim('details')
    currentTime = 85_000
    cFailed?.release({ ok: false })
    expect(arbiter.expectedMs()).toBe(4000)

    currentTime = 88_000
    const cCancelled = arbiter.claim('details')
    currentTime = 98_000
    cCancelled?.release({ ok: true, cancelled: true })
    expect(arbiter.expectedMs()).toBe(4000)

    currentTime = 101_000
    const cCancelled2 = arbiter.claim('details')
    currentTime = 111_000
    cCancelled2?.release({ cancelled: true })
    expect(arbiter.expectedMs()).toBe(4000)

    currentTime = 114_000
    const cNoOutcome = arbiter.claim('details')
    currentTime = 124_000
    cNoOutcome?.release()
    expect(arbiter.expectedMs()).toBe(4000)

    currentTime = 127_000
    const cPreempted = arbiter.claim('watch')
    currentTime = 128_000
    arbiter.claim('poll')?.release()
    cPreempted?.release({ ok: true })
    expect(arbiter.expectedMs()).toBe(4000)

    currentTime = 130_000
    const cPoll = arbiter.claim('poll')
    currentTime = 140_000
    cPoll?.release({ ok: true })
    expect(arbiter.expectedMs()).toBe(4000)

    for (let i = 0; i < ARBITER_EXPECTED_WINDOW; i++) {
      currentTime += 3000
      const c = arbiter.claim('details')
      currentTime += 5000
      c?.release({ ok: true })
    }
    expect(arbiter.expectedMs()).toBe(5000)
  })

  it('f. slow request: watch claimed with poll due at boundary, request exceeds expectedMs, poll preempts watch', () => {
    let currentTime = 1000
    const arbiter = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 2000
    })

    const initialExpected = arbiter.expectedMs()
    expect(initialExpected).toBe(ARBITER_EXPECTED_INITIAL_MS)
    const pollDue = currentTime + initialExpected + ARBITER_WATCH_MARGIN_MS
    arbiter.setNextPollDue(pollDue)

    let watchPreempted = false
    const watch = arbiter.claim('watch', () => {
      watchPreempted = true
    })
    expect(watch).not.toBeNull()
    expect(arbiter.snapshot().detailHolder).toBe('watch')

    currentTime = pollDue
    const poll = arbiter.claim('poll')
    expect(poll).not.toBeNull()
    expect(watchPreempted).toBe(true)
    expect(arbiter.snapshot().detailHolder).toBeNull()

    expect(arbiter.claim('watch')).toBeNull()

    watch?.release({ ok: true })
    expect(arbiter.claim('watch')).toBeNull()

    currentTime = pollDue + 200
    poll?.release()
    expect(arbiter.snapshot().pollActive).toBe(false)

    expect(arbiter.claim('watch')).toBeNull()

    arbiter.setNextPollDue(currentTime + 500)
    expect(arbiter.claim('watch')).toBeNull()

    const futureDue = currentTime + arbiter.expectedMs() + ARBITER_WATCH_MARGIN_MS + 1000
    arbiter.setNextPollDue(futureDue)
    const nextWatch = arbiter.claim('watch')
    expect(nextWatch).not.toBeNull()
    nextWatch?.release()
  })

  it('g. robustness: 2000 random operations under seeded PRNG prove exclusivity with independent tracking and re-entrant callbacks', () => {
    function mulberry32(seed: number) {
      let s = seed
      return function () {
        s += 0x6d2b79f5
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }

    const rand = mulberry32(1337)
    let currentTime = 0
    const arbiter = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 1000
    })

    const activeDetailClaims = new Set<ArbiterClaim>()
    const activePollClaims = new Set<ArbiterClaim>()
    const allGrantedClaims: ArbiterClaim[] = []

    function trackGrant(claim: ArbiterClaim | null) {
      if (claim === null) return
      allGrantedClaims.push(claim)
      if (claim.priority === 'poll') {
        activePollClaims.add(claim)
      } else {
        activeDetailClaims.add(claim)
      }
    }

    function releaseClaim(claim: ArbiterClaim, outcome?: { ok?: boolean; cancelled?: boolean }) {
      claim.release(outcome)
      activePollClaims.delete(claim)
      activeDetailClaims.delete(claim)
    }

    for (let opIdx = 0; opIdx < 2000; opIdx++) {
      currentTime += Math.floor(rand() * 500)
      const choice = Math.floor(rand() * 10)

      if (choice === 0) {
        const claim = arbiter.claim('poll')
        trackGrant(claim)
      } else if (choice === 1) {
        const claim = arbiter.claim('enrichment')
        trackGrant(claim)
      } else if (choice === 2) {
        const claim = arbiter.claim('details')
        trackGrant(claim)
      } else if (choice === 3) {
        let watchClaim: ArbiterClaim | null = null
        const reenterMode = Math.floor(rand() * 6)
        const onPreempt = () => {
          if (watchClaim) {
            activeDetailClaims.delete(watchClaim)
          }
          if (reenterMode === 0) {
            const inner = arbiter.claim('poll')
            trackGrant(inner)
          } else if (reenterMode === 1) {
            const inner = arbiter.claim('watch')
            trackGrant(inner)
          } else if (reenterMode === 2) {
            const inner = arbiter.claim('details')
            trackGrant(inner)
          } else if (reenterMode === 3) {
            arbiter.want('enrichment')
          } else if (reenterMode === 4) {
            arbiter.setNextPollDue(currentTime + 5000)
          } else {
            throw new Error('re-entrant failure')
          }
        }
        watchClaim = arbiter.claim('watch', onPreempt)
        trackGrant(watchClaim)
      } else if (choice === 4) {
        if (activeDetailClaims.size > 0) {
          const [claim] = activeDetailClaims
          if (claim) {
            const outcomeRand = rand()
            let outcome: { ok?: boolean; cancelled?: boolean } | undefined
            if (outcomeRand < 0.25) outcome = { ok: true }
            else if (outcomeRand < 0.5) outcome = { ok: false }
            else if (outcomeRand < 0.75) outcome = { cancelled: true }
            releaseClaim(claim, outcome)
          }
        }
      } else if (choice === 5) {
        if (activePollClaims.size > 0) {
          const [claim] = activePollClaims
          if (claim) {
            releaseClaim(claim)
          }
        }
      } else if (choice === 6) {
        if (allGrantedClaims.length > 0) {
          const idx = Math.floor(rand() * allGrantedClaims.length)
          const randomClaim = allGrantedClaims[idx]
          if (randomClaim) {
            releaseClaim(randomClaim, { ok: true })
          }
        }
      } else if (choice === 7) {
        const p: 'enrichment' | 'details' = rand() < 0.5 ? 'enrichment' : 'details'
        arbiter.want(p)
      } else if (choice === 8) {
        const p: 'enrichment' | 'details' = rand() < 0.5 ? 'enrichment' : 'details'
        arbiter.unwant(p)
      } else if (choice === 9) {
        const dueRand = rand()
        if (dueRand < 0.2) arbiter.setNextPollDue(null)
        else if (dueRand < 0.3) arbiter.setNextPollDue(NaN)
        else if (dueRand < 0.4) arbiter.setNextPollDue(Infinity)
        else if (dueRand < 0.7) arbiter.setNextPollDue(currentTime + Math.floor(rand() * 5000))
        else arbiter.setNextPollDue(currentTime - Math.floor(rand() * 2000))
      }

      expect(activeDetailClaims.size).toBeLessThanOrEqual(1)
      expect(activePollClaims.size).toBeLessThanOrEqual(1)

      const snap = arbiter.snapshot()
      if (activeDetailClaims.size === 1) {
        const [activeDetail] = activeDetailClaims
        expect(activeDetail).toBeDefined()
        if (activeDetail) {
          expect(snap.detailHolder).toBe(activeDetail.priority)
        }
      } else {
        expect(snap.detailHolder).toBeNull()
      }

      expect(snap.pollActive).toBe(activePollClaims.size === 1)
      expect(snap.preemptions).toBeGreaterThanOrEqual(0)
      expect(snap.expectedMs).toBeGreaterThanOrEqual(0)
      expect(snap.expectedMs).toBeLessThanOrEqual(ARBITER_EXPECTED_MAX_MS)

      let seenDetails = false
      for (const w of snap.waiting) {
        if (w === 'enrichment') {
          expect(seenDetails).toBe(false)
        } else if (w === 'details') {
          seenDetails = true
        }
      }
    }
  })

  it('focused 1: re-entrancy in onPreempt denies nested claim and preserves arbiter consistency', () => {
    let currentTime = 1000
    const arbiter = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 2000
    })

    // 1a. Watch onPreempt attempts to claim('poll')
    let innerPoll: ArbiterClaim | null = null
    const watch1 = arbiter.claim('watch', () => {
      innerPoll = arbiter.claim('poll')
    })
    expect(watch1).not.toBeNull()

    const outerPoll = arbiter.claim('poll')
    expect(outerPoll).not.toBeNull()
    expect(innerPoll).toBeNull()
    expect(arbiter.snapshot().pollActive).toBe(true)
    expect(arbiter.snapshot().detailHolder).toBeNull()
    outerPoll?.release()
    expect(arbiter.snapshot().pollActive).toBe(false)

    // 1b. At an elapsed gap, watch onPreempt attempts to claim('watch')
    currentTime = 5000
    let innerWatch: ArbiterClaim | null = null
    const watch2 = arbiter.claim('watch', () => {
      innerWatch = arbiter.claim('watch')
    })
    expect(watch2).not.toBeNull()
    currentTime = 7500 // gap elapsed
    const outerPoll2 = arbiter.claim('poll')
    expect(outerPoll2).not.toBeNull()
    expect(innerWatch).toBeNull()
    expect(arbiter.snapshot().pollActive).toBe(true)
    expect(arbiter.snapshot().detailHolder).toBeNull()
    outerPoll2?.release()

    // 1c. Watch onPreempt attempts to claim('details')
    currentTime = 10_000
    let innerDetails: ArbiterClaim | null = null
    const watch3 = arbiter.claim('watch', () => {
      innerDetails = arbiter.claim('details')
    })
    expect(watch3).not.toBeNull()
    currentTime = 12_500
    const outerDetails = arbiter.claim('details')
    expect(outerDetails).not.toBeNull()
    expect(innerDetails).toBeNull()
    expect(arbiter.snapshot().detailHolder).toBe('details')
    outerDetails?.release()

    // 1d. onPreempt modifies want/unwant and setNextPollDue
    currentTime = 15_000
    const watch4 = arbiter.claim('watch', () => {
      arbiter.want('enrichment')
      arbiter.setNextPollDue(50_000)
    })
    expect(watch4).not.toBeNull()
    const poll3 = arbiter.claim('poll')
    expect(poll3).not.toBeNull()
    expect(arbiter.snapshot().waiting).toEqual(['enrichment'])
    expect(arbiter.snapshot().nextPollDueAt).toBe(50_000)
    poll3?.release()
  })

  it('focused 2: enrichment/details do not preempt watch when gap denies, and grant with preemption when gap allows', () => {
    let currentTime = 0
    const arbiter = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 2000
    })

    let preemptCount = 0
    const watch = arbiter.claim('watch', () => {
      preemptCount++
    })
    expect(watch).not.toBeNull()
    expect(arbiter.snapshot().detailHolder).toBe('watch')
    expect(arbiter.snapshot().preemptions).toBe(0)

    // Details at 100 -> null, watch still active, preemptions 0
    currentTime = 100
    const d1 = arbiter.claim('details')
    expect(d1).toBeNull()
    expect(preemptCount).toBe(0)
    expect(arbiter.snapshot().detailHolder).toBe('watch')
    expect(arbiter.snapshot().preemptions).toBe(0)

    // Enrichment at 500 -> null, watch still active, preemptions 0
    currentTime = 500
    const e1 = arbiter.claim('enrichment')
    expect(e1).toBeNull()
    expect(preemptCount).toBe(0)
    expect(arbiter.snapshot().detailHolder).toBe('watch')
    expect(arbiter.snapshot().preemptions).toBe(0)

    // Details at 2000 -> granted, watch preempted, onPreempt called once
    currentTime = 2000
    const d2 = arbiter.claim('details')
    expect(d2).not.toBeNull()
    expect(preemptCount).toBe(1)
    expect(arbiter.snapshot().detailHolder).toBe('details')
    expect(arbiter.snapshot().preemptions).toBe(1)

    // Watch release is no-op
    watch?.release({ ok: true })
    expect(arbiter.snapshot().detailHolder).toBe('details')
    d2?.release()
    expect(arbiter.snapshot().detailHolder).toBeNull()
  })

  it('focused 3: repeated want/unwant counts, priority ordering, and underflow safety', () => {
    const arbiter = new SourceArbiter({
      now: () => 0,
      minGapMs: 1000
    })

    expect(arbiter.snapshot().waiting).toEqual([])

    // Underflow at 0 is a no-op and never throws or makes count negative
    arbiter.unwant('enrichment')
    arbiter.unwant('details')
    expect(arbiter.snapshot().waiting).toEqual([])

    arbiter.want('details')
    arbiter.want('enrichment')
    arbiter.want('enrichment')
    arbiter.want('details')
    arbiter.want('enrichment')

    // 3 enrichment, 2 details -> ordered enrichment then details
    expect(arbiter.snapshot().waiting).toEqual([
      'enrichment',
      'enrichment',
      'enrichment',
      'details',
      'details'
    ])

    arbiter.unwant('enrichment')
    arbiter.unwant('details')
    expect(arbiter.snapshot().waiting).toEqual([
      'enrichment',
      'enrichment',
      'details'
    ])

    arbiter.unwant('enrichment')
    arbiter.unwant('enrichment')
    arbiter.unwant('enrichment') // extra underflow
    expect(arbiter.snapshot().waiting).toEqual(['details'])

    arbiter.unwant('details')
    arbiter.unwant('details') // extra underflow
    expect(arbiter.snapshot().waiting).toEqual([])
  })

  it('focused 4: successful watch and enrichment claims are sampled into expectedMs', () => {
    let currentTime = 1000
    const arbiter = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 1000
    })

    // Successful watch claim of duration 2000 ms
    const watch = arbiter.claim('watch')
    expect(watch).not.toBeNull()
    currentTime = 3000
    watch?.release({ ok: true })
    expect(arbiter.expectedMs()).toBe(2000)

    // Successful enrichment claim of duration 4000 ms
    currentTime = 5000
    const enrich = arbiter.claim('enrichment')
    expect(enrich).not.toBeNull()
    currentTime = 9000
    enrich?.release({ ok: true })
    expect(arbiter.expectedMs()).toBe((2000 + 4000) / 2)
  })

  it('focused 5: negative duration (clock moved backwards) is clamped to 0', () => {
    let currentTime = 5000
    const arbiter = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 1000
    })

    const claim = arbiter.claim('details')
    expect(claim).not.toBeNull()

    // Clock moved backwards
    currentTime = 3000
    claim?.release({ ok: true })
    expect(arbiter.expectedMs()).toBe(0)
  })

  it('focused 6: window keeps exactly the last 10 samples with oldest-first eviction across varied durations', () => {
    let currentTime = 0
    const arbiter = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 500
    })

    // Push 11 samples: 1000, 2000, 3000, ..., 11000
    for (let i = 1; i <= 11; i++) {
      currentTime += 1000
      const claim = arbiter.claim('details')
      expect(claim).not.toBeNull()
      currentTime += i * 1000
      claim?.release({ ok: true })
    }

    // Oldest sample (1000) is evicted.
    // 11000 is clamped to ARBITER_EXPECTED_MAX_MS (10000) per Rule 6.
    // The last 10 samples are 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 10000.
    // Sum = 64000. Average = 64000 / 10 = 6400.
    expect(arbiter.expectedMs()).toBe(6400)
  })

  it('claim with atMs uses atMs for the gap and for startedAt, while non-finite atMs falls back to the clock', () => {
    let currentTime = 50_000
    const arbiter = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 2000
    })

    // Uses atMs for startedAt and sets lastDetailStart
    const claim1 = arbiter.claim('details', undefined, 1000)
    expect(claim1).not.toBeNull()
    expect(claim1?.startedAt).toBe(1000)
    claim1?.release()

    // atMs inside the gap (2500 - 1000 < 2000) is denied even though clock is 50000
    expect(arbiter.claim('details', undefined, 2500)).toBeNull()

    // atMs outside the gap (3000 - 1000 >= 2000) is granted
    const claim2 = arbiter.claim('details', undefined, 3000)
    expect(claim2).not.toBeNull()
    expect(claim2?.startedAt).toBe(3000)
    claim2?.release()

    // Non-finite atMs falls back to clock
    currentTime = 10_000
    const claimNaN = arbiter.claim('details', undefined, NaN)
    expect(claimNaN).not.toBeNull()
    expect(claimNaN?.startedAt).toBe(10_000)
    claimNaN?.release()

    currentTime = 15_000
    const claimInf = arbiter.claim('details', undefined, Infinity)
    expect(claimInf).not.toBeNull()
    expect(claimInf?.startedAt).toBe(15_000)
    claimInf?.release()

    currentTime = 20_000
    const claimNegInf = arbiter.claim('details', undefined, -Infinity)
    expect(claimNegInf).not.toBeNull()
    expect(claimNegInf?.startedAt).toBe(20_000)
    claimNegInf?.release()
  })

  it('samples duration using the arbiter clock instead of caller atMs for details and watch claims', () => {
    let currentTime = 5000
    const arbiterDetails = new SourceArbiter({
      now: () => currentTime,
      minGapMs: 1000
    })
    const detailClaim = arbiterDetails.claim('details', undefined, 100_000)
    expect(detailClaim).not.toBeNull()
    expect(detailClaim?.startedAt).toBe(100_000)
    currentTime = 6200
    detailClaim?.release({ ok: true })
    expect(arbiterDetails.expectedMs()).toBe(1200)

    let watchTime = 5000
    const arbiterWatch = new SourceArbiter({
      now: () => watchTime,
      minGapMs: 1000
    })
    const watchClaim = arbiterWatch.claim('watch', undefined, 100_000)
    expect(watchClaim).not.toBeNull()
    expect(watchClaim?.startedAt).toBe(100_000)
    watchTime = 6200
    watchClaim?.release({ ok: true })
    expect(arbiterWatch.expectedMs()).toBe(1200)
  })
})
