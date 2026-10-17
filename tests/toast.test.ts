import { describe, expect, it } from 'vitest'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { browserToastXml, supportsUrgentToasts } from '../src/main/toast.js'
import { notificationActivationArguments } from '../src/shared/notificationActivation.js'

const icon = 'C:/RASED branding/icon.png'
const parser = new XMLParser({ ignoreAttributes: false })
describe('Windows browser notification activation', () => {
  it('uses persistent foreground activation for body and view while keeping quick apply a separate protocol action', () => {
    const activation = notificationActivationArguments('a'.repeat(32))
    const quick = { link: 'rased://quick-apply-v2?ticket=' + 'b'.repeat(32), language: 'en' as const }
    const toast = parser.parse(browserToastXml('Project', 'Text', 'https://mostaql.com/go/123', icon, false, quick, activation)).toast
    expect(toast['@_activationType']).toBe('foreground')
    expect(toast['@_launch']).toBe(activation)
    expect(toast.actions.action[0]['@_activationType']).toBe('protocol')
    expect(toast.actions.action[1]['@_activationType']).toBe('foreground')
    expect(toast.actions.action[1]['@_arguments']).toBe(activation)
    expect(() => browserToastXml('P', '', 'https://mostaql.com/go/123', icon, false, undefined, 'file:///C:/app.exe')).toThrow()
  })
  it('persists the HTTPS destination in native XML rather than an in-memory click handler', () => {
    const value = browserToastXml('مشروع جديد', 'React work', 'https://mostaql.com/go/123', icon)
    expect(XMLValidator.validate(value)).toBe(true)
    const toast = parser.parse(value).toast
    expect(toast['@_activationType']).toBe('protocol')
    expect(toast['@_launch']).toBe('https://mostaql.com/go/123')
    expect(toast.audio['@_silent']).toBe('true')
    expect(toast.visual.binding.image['@_src']).toContain('RASED%20branding/icon.png')
  })
  it('escapes project text and query strings without allowing injected actions', () => {
    const title = '"<actions>& مشروع'
    const url = 'https://mostaql.com/project/123-work?a=1&b=2'
    const value = browserToastXml(title, '<toast/>\u0000', url, icon)
    expect(XMLValidator.validate(value)).toBe(true)
    const toast = parser.parse(value).toast
    expect(toast['@_launch']).toBe(url)
    expect(toast.visual.binding.text).toEqual([title, '<toast/>'])
    expect(toast.actions).toBeUndefined()
  })
  it('allows the test listing but rejects foreign hosts and executable protocols', () => {
    expect(browserToastXml('Test', '', 'https://mostaql.com/projects', icon)).toContain('activationType="protocol"')
    for (const url of ['https://evil.test/go/123', 'https://mostaql.com.evil.test/go/123', 'file:///C:/app.exe', 'javascript:alert(1)', 'https://mostaql.com/p/terms']) {
      expect(() => browserToastXml('Test', '', url, icon)).toThrow('Invalid notification destination')
    }
  })
  it('requests urgent delivery only on supporting Windows builds', () => {
    expect(supportsUrgentToasts('win32', '10.0.19045')).toBe(false)
    expect(supportsUrgentToasts('win32', '10.0.22000')).toBe(false)
    expect(supportsUrgentToasts('win32', '10.0.22546')).toBe(true)
    expect(supportsUrgentToasts('win32', '10.0.26100')).toBe(true)
    expect(supportsUrgentToasts('linux', '10.0.26100')).toBe(false)
    expect(supportsUrgentToasts('win32', 'invalid')).toBe(false)
    const urgent = parser.parse(browserToastXml('Project', '', 'https://mostaql.com/go/123', icon, true)).toast
    const ordinary = parser.parse(browserToastXml('Project', '', 'https://mostaql.com/go/123', icon, false)).toast
    expect(urgent['@_scenario']).toBe('urgent')
    expect(ordinary['@_scenario']).toBeUndefined()
    expect(urgent['@_activationType']).toBe('protocol')
  })
})
