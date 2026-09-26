import { describe, expect, it } from 'vitest'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { browserToastXml } from '../src/main/toast.js'

const icon = 'C:/RASED branding/icon.png'
const parser = new XMLParser({ ignoreAttributes: false })
describe('Windows browser notification activation', () => {
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
})
