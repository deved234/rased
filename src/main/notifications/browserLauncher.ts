import type { BrowserOpenResult } from './activation.js'
import { captureBrowserFocus, loadWindowsFocus, observeBrowserFocus, requestBrowserFocus, type WindowsFocusPort } from './windowsFocus.js'
import { isAllowedProjectUrl, isAllowedTestUrl } from '../links.js'

export class BrowserLauncher {
  private focus: WindowsFocusPort | null = null
  constructor(private open: (url: string) => Promise<void>) {}
  async prepare(): Promise<void> {
    if (process.platform !== 'win32') return
    try { this.focus = await loadWindowsFocus() } catch { /* URL delivery remains available. */ }
  }
  async launch(url: string): Promise<BrowserOpenResult> {
    const started = Date.now()
    if (!isAllowedProjectUrl(url) && !isAllowedTestUrl(url)) return { launch: 'failed', foreground: 'not-attempted', reason: 'invalid-url', durationMs: 0 }
    let before: ReturnType<typeof captureBrowserFocus> | null = null
    try {
      if (this.focus) { before = captureBrowserFocus(this.focus); requestBrowserFocus(this.focus, before) }
    } catch { before = null }
    try { await this.open(url) }
    catch { return { launch: 'failed', foreground: 'not-attempted', reason: 'open-failed', durationMs: Date.now() - started } }
    let foreground: BrowserOpenResult['foreground'] = 'not-attempted'
    if (before && this.focus) {
      try { foreground = await observeBrowserFocus(this.focus, before) } catch { foreground = 'target-unknown' }
    }
    return { launch: 'accepted', foreground, durationMs: Date.now() - started }
  }
}
