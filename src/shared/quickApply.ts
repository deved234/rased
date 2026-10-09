export type QuickSource = 'mostaql' | 'nafezly'
export interface QuickApplySettings { enabled: boolean; template: string; budgetPositionPercent: number; extraDays: number }
export const defaultQuickApply = (): QuickApplySettings => ({ enabled: false, template: '', budgetPositionPercent: 0, extraDays: 0 })
export function validQuickApply(v: unknown): v is QuickApplySettings {
  if (!v || typeof v !== 'object') return false
  const x = v as QuickApplySettings
  return typeof x.enabled === 'boolean' && typeof x.template === 'string' && x.template.length <= 10000 && (!x.enabled || !!x.template.trim()) && Number.isInteger(x.budgetPositionPercent) && x.budgetPositionPercent >= 0 && x.budgetPositionPercent <= 100 && Number.isInteger(x.extraDays) && x.extraDays >= 0 && x.extraDays <= 365
}
export function quickPrice(min: number, max: number, percent: number, step = 0.01, base=0): number | null {
  if (![min,max,percent,step,base].every(Number.isFinite) || min <= 0 || max < min || percent < 0 || percent > 100 || step <= 0) return null
  const low = Math.ceil((min - base - 1e-8) / step), high = Math.floor((max - base + 1e-8) / step)
  if (low > high) return null
  return Number((base+Math.min(high, Math.max(low, Math.round((min + (max - min) * percent / 100-base) / step))) * step).toFixed(2))
}
export function parseQuickTicket(raw: string): string | null {
  if (raw.length > 200) return null
  try { const u = new URL(raw); const t = u.searchParams.get('ticket'); return u.protocol === 'rased:' && u.hostname === 'quick-apply' && (u.pathname === '' || u.pathname === '/') && !u.username && !u.password && !u.port && !u.hash && [...u.searchParams.keys()].length === 1 && !!t && /^[a-f0-9]{32}$/.test(t) ? t : null } catch { return null }
}
