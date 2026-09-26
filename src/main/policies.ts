import { sanitizeFilterDefinition, sanitizeSettings, type AppSettings } from '../shared/types.js'

export function notificationsAllowed(settings: AppSettings, now = Date.now(), quitting = false): boolean {
  return !quitting && settings.notificationsEnabled && (!settings.doNotDisturbUntil || Date.parse(settings.doNotDisturbUntil) <= now)
}

export function mergeSettings(settings: AppSettings, patch: Partial<AppSettings>): AppSettings {
  const merged = { ...patch }
  if (patch.ui) merged.ui = { ...settings.ui, ...patch.ui }
  if (patch.displayQuery) merged.displayFilter = sanitizeFilterDefinition(patch.displayQuery).categoryFilter
  const linked = patch.linkDisplayAndNotifyFilters ?? settings.linkDisplayAndNotifyFilters
  if (linked) {
    if (patch.notifyFilter && !patch.displayQuery && !patch.displayFilter) merged.displayFilter = patch.notifyFilter
    else if (merged.displayFilter) merged.notifyFilter = merged.displayFilter
    else if (patch.linkDisplayAndNotifyFilters === true) merged.notifyFilter = settings.displayQuery.categoryFilter
  }
  if (merged.displayFilter) merged.displayQuery = { ...(patch.displayQuery ?? settings.displayQuery), categoryFilter: merged.displayFilter }
  if (patch.displayQuery) merged.showUnreadOnly = patch.displayQuery.unreadOnly
  return sanitizeSettings({ ...settings, ...merged })
}

export function pickLatestProjectId(projects: { id: number; firstSeenAt: string }[]): number | null {
  return [...projects].sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt) || b.id - a.id)[0]?.id ?? null
}
