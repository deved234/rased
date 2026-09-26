/** One host-wide HTML request slot shared by metadata and full descriptions. */
export class DetailBudget {
  private busy = false
  private lastStart = -Infinity
  constructor(private readonly gapMs = 2000) {}
  claim(now: number): boolean {
    if (this.busy || now - this.lastStart < this.gapMs) return false
    this.busy = true
    this.lastStart = now
    return true
  }
  release(): void { this.busy = false }
}
