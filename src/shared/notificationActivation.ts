export type NotificationScheme = 'rased' | 'rased-dev'
export const NOTIFICATION_TICKET_TTL = 7 * 24 * 60 * 60 * 1000
export const NOTIFICATION_DEDUP_MS = 2000

export function notificationScheme(packaged: boolean): NotificationScheme {
  return packaged ? 'rased' : 'rased-dev'
}

/** Deliberately accept a single, canonical shape; never a caller-supplied URL. */
export function parseNotificationActivation(raw: string, scheme: NotificationScheme): string | null {
  const prefixes = [`${scheme}://open-project?ticket=`, 'type=action&action=0&intent=open-project&ticket=']
  const prefix = prefixes.find(prefix => raw.startsWith(prefix))
  if (!prefix) return null
  const token = raw.slice(prefix.length)
  return /^[a-f0-9]{32}$/.test(token) ? token : null
}

/** Electron dispatches structured action arguments to its persistent activator. */
export function notificationActivationArguments(token: string): string {
  if (!/^[a-f0-9]{32}$/.test(token)) throw Error('invalid-notification-ticket')
  return `type=action&action=0&intent=open-project&ticket=${token}`
}

export function notificationActivationUrl(token: string, scheme: NotificationScheme): string {
  if (!/^[a-f0-9]{32}$/.test(token)) throw Error('invalid-notification-ticket')
  return `${scheme}://open-project?ticket=${token}`
}
