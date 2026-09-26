import { pathToFileURL } from 'node:url'
import { isAllowedProjectUrl, isAllowedTestUrl } from './links.js'

function xml(value: string): string {
  // XML 1.0 forbids these control characters, even inside escaped text.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Windows owns HTTPS activation, including notifications retained after app exit. */
export function browserToastXml(title: string, body: string, url: string, icon: string): string {
  if (!isAllowedProjectUrl(url) && !isAllowedTestUrl(url)) throw new Error('Invalid notification destination')
  return `<toast activationType="protocol" launch="${xml(url)}"><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text><image placement="appLogoOverride" src="${xml(pathToFileURL(icon).href)}"/></binding></visual><audio silent="true"/></toast>`
}
