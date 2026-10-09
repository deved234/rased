import { useSyncExternalStore } from 'react'
import type { ExtensionStatus, JobPhase } from '@shared/extension/protocol.js'
import { rased } from '../api.js'

let status: ExtensionStatus | null = null
let unsubscribe: (() => void) | null = null
let unsubscribeSettings: (() => void) | null = null
let enabled: boolean | null = null
let generation = 0
const listeners = new Set<() => void>()
function publish(next: ExtensionStatus): void { status = next; for (const listener of listeners) listener() }
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!unsubscribe) {
    const currentGeneration = ++generation
    let received = false
    unsubscribe = rased.onExtensionStatus(next => { received = true; publish(next) })
    void rased.getExtensionStatus().then(next => { if (currentGeneration === generation && !received && listeners.size) publish(next) }).catch(() => {})
    let settingsReceived = false
    const update = (value: boolean): void => { enabled = value; for (const notify of listeners) notify() }
    unsubscribeSettings = rased.onSettingsChanged(next => { settingsReceived = true; update(next.quickApply.enabled) })
    void rased.getSettings().then(next => { if (currentGeneration === generation && !settingsReceived && listeners.size) update(next.quickApply.enabled) }).catch(() => {})
  }
  return () => { listeners.delete(listener); if (!listeners.size) { generation++; unsubscribe?.(); unsubscribeSettings?.(); unsubscribe = null; unsubscribeSettings = null; status = null; enabled = null } }
}
export function useExtensionStatus(): ExtensionStatus | null { return useSyncExternalStore(subscribe, () => status) }
export function useQuickEnabled(): boolean | null { return useSyncExternalStore(subscribe, () => enabled) }
export function activePhase(phase: JobPhase): boolean { return ['waiting-client', 'opening', 'reading'].includes(phase) }
export function phaseText(phase: JobPhase, ar: boolean): string {
  const labels: Record<JobPhase, [string, string]> = {
    'waiting-client': ['في انتظار بروفايل Chrome المختار', 'Waiting for your selected Chrome profile'],
    opening: ['جارٍ فتح المشروع', 'Opening the project'], reading: ['جارٍ قراءة النموذج', 'Reading the form'],
    ready: ['المسودة جاهزة — راجعها وقدّم بنفسك', 'Draft ready — review and submit yourself'],
    'needs-input': ['أكمل السعر أو المدة في Chrome', 'Complete price or duration in Chrome'],
    'needs-login': ['سجّل دخولك في الموقع ثم أعد المحاولة', 'Sign in on the website, then retry'],
    'draft-exists': ['احتفظنا بالمسودة الموجودة', 'Existing draft preserved'],
    failed: ['تعذر التجهيز — أعد المحاولة', 'Preparation failed — retry'],
    cancelled: ['أُلغي التجهيز', 'Preparation cancelled'], expired: ['انتهت المهلة — افتح البروفايل المختار وأعد المحاولة', 'Timed out — open the selected profile and retry']
  }
  return labels[phase][ar ? 0 : 1]
}
