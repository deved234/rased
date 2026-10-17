import { pathToFileURL } from 'node:url'
import { isAllowedProjectUrl, isAllowedTestUrl } from './links.js'
import { parseQuickTicket } from '../shared/quickApply.js'
import { parseExtensionTicket } from '../shared/extension/protocol.js'
import { parseNotificationActivation } from '../shared/notificationActivation.js'

function xml(value: string): string {
  // XML 1.0 forbids these control characters, even inside escaped text.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Windows owns HTTPS activation, including notifications retained after app exit. */
export function supportsUrgentToasts(platform: string, release: string): boolean {
  if (platform !== 'win32') return false
  const parts = release.split('.').map(Number)
  return parts[0] === 10 && parts.length >= 3 && Number.isInteger(parts[2]) && parts[2]! >= 22546
}

export function browserToastXml(title: string, body: string, url: string, icon: string, urgent = false, quick?: { link: string; language: 'ar' | 'en' }, activation?: string): string {
  if (!isAllowedProjectUrl(url) && !isAllowedTestUrl(url)) throw new Error('Invalid notification destination')
  if (quick && !parseExtensionTicket(quick.link.replace(/^rased-dev:/, 'rased:')) && !parseQuickTicket(quick.link)) throw new Error('Invalid quick apply ticket')
  if (activation && (!activation.startsWith('type=action&action=0&intent=open-project&ticket=') || !parseNotificationActivation(activation, 'rased'))) throw Error('Invalid notification activation')
  const kind = activation ? 'foreground' : 'protocol', destination = activation ?? url
  const actions = quick ? `<actions><action activationType="protocol" content="${quick.language === 'ar' ? 'تقديم سريع' : 'Quick apply'}" arguments="${xml(quick.link)}"/><action activationType="${kind}" content="${quick.language === 'ar' ? 'عرض المشروع' : 'View project'}" arguments="${xml(destination)}"/></actions>` : ''
  return `<toast activationType="${kind}" launch="${xml(destination)}"${urgent ? ' scenario="urgent"' : ''}><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text><image placement="appLogoOverride" src="${xml(pathToFileURL(icon).href)}"/></binding></visual>${actions}<audio silent="true"/></toast>`
}
