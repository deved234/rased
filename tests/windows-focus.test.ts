import { describe, expect, it, vi } from 'vitest'
import { captureBrowserFocus, observeBrowserFocus, requestBrowserFocus, type WindowsFocusPort } from '../src/main/notifications/windowsFocus.js'
import { BrowserLauncher } from '../src/main/notifications/browserLauncher.js'

function fixture() {
  const state = { windows: [{ handle: 1n, pid: 10 }], foreground: 99n, input: 1, iconic: false, clock: 0 }
  const port: WindowsFocusPort = {
    defaultBrowser: () => 'C:/browser.exe', windows: () => state.windows, foreground: () => state.foreground,
    lastInput: () => state.input, iconic: () => state.iconic,
    restore: vi.fn(), focus: vi.fn(), allow: vi.fn()
  }
  const timing = { now: () => state.clock, wait: async (ms: number) => { state.clock += ms }, timeoutMs: 120 }
  return { state, port, timing }
}

describe('Browser foreground selection and observation', () => {
  it('requests focus before delivery only for one unambiguous browser window and grants only the known browser process', () => {
    const f = fixture(), before = captureBrowserFocus(f.port)
    requestBrowserFocus(f.port, before)
    expect(f.port.focus).toHaveBeenCalledWith(1n)
    expect(f.port.allow).toHaveBeenCalledWith(10)
    expect(f.port.restore).not.toHaveBeenCalled()
    f.state.iconic = true
    requestBrowserFocus(f.port, captureBrowserFocus(f.port))
    expect(f.port.restore).toHaveBeenCalledWith(1n)
  })
  it('never guesses between multiple profiles or browser windows', () => {
    const f = fixture()
    f.state.windows.push({ handle: 2n, pid: 20 })
    requestBrowserFocus(f.port, captureBrowserFocus(f.port))
    expect(f.port.focus).not.toHaveBeenCalled()
    expect(f.port.allow).not.toHaveBeenCalled()
    f.state.windows[1]!.pid = 10
    requestBrowserFocus(f.port, captureBrowserFocus(f.port))
    expect(f.port.focus).not.toHaveBeenCalled()
    expect(f.port.allow).toHaveBeenCalledWith(10)
  })
  it('waits for Windows to finish activation instead of reporting an immediate false negative', async () => {
    const f = fixture(), before = captureBrowserFocus(f.port)
    const wait = async (ms: number): Promise<void> => { f.state.clock += ms; f.state.foreground = 1n }
    expect(await observeBrowserFocus(f.port, before, { ...f.timing, wait })).toBe('confirmed')
    expect(f.port.focus).not.toHaveBeenCalled()
  })
  it('mouse movement does not abort observation while the original app is still active', async () => {
    const f = fixture(), before = captureBrowserFocus(f.port)
    f.state.input++
    expect(await observeBrowserFocus(f.port, before, f.timing)).toBe('denied')
    expect(f.port.focus).not.toHaveBeenCalled()
  })
  it('stops when the user has switched to a different program and never requests focus in its observation loop', async () => {
    const f = fixture(), before = captureBrowserFocus(f.port)
    f.state.foreground = 3n; f.state.input++
    expect(await observeBrowserFocus(f.port, before, f.timing)).toBe('not-attempted')
    expect(f.port.focus).not.toHaveBeenCalled()
  })
  it('does not select an unrelated window when no default browser window is known', async () => {
    const f = fixture(), before = captureBrowserFocus(f.port)
    f.state.windows = []
    expect(await observeBrowserFocus(f.port, before, f.timing)).toBe('target-unknown')
    expect(f.port.focus).not.toHaveBeenCalled()
  })
})

describe('Safe browser delivery fallback', () => {
  it('opens a validated URL once even when no native focus binding is loaded', async () => {
    const open = vi.fn(async () => undefined), launcher = new BrowserLauncher(open)
    expect(await launcher.launch('https://mostaql.com/go/123')).toMatchObject({ launch: 'accepted', foreground: 'not-attempted' })
    expect(open).toHaveBeenCalledTimes(1)
    expect(await launcher.launch('file:///C:/app.exe')).toMatchObject({ launch: 'failed', reason: 'invalid-url' })
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('does not retry a rejected external operation', async () => {
    const open = vi.fn(async () => { throw Error('OS failure') })
    expect(await new BrowserLauncher(open).launch('https://nafezly.com/project/2')).toMatchObject({ launch: 'failed', reason: 'open-failed' })
    expect(open).toHaveBeenCalledTimes(1)
  })
})
