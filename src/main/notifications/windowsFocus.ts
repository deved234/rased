import type { BrowserOpenResult } from './activation.js'

export interface FocusWindow { handle: bigint; pid: number }
export interface WindowsFocusPort {
  defaultBrowser: () => string
  windows: (executable: string) => FocusWindow[]
  foreground: () => bigint
  lastInput: () => number | null
  iconic: (handle: bigint) => boolean
  restore: (handle: bigint) => void
  focus: (handle: bigint) => void
  allow: (pid: number) => void
}
export interface FocusSnapshot { executable: string; windows: FocusWindow[]; foreground: bigint; input: number | null }

export function captureBrowserFocus(port: WindowsFocusPort): FocusSnapshot {
  const executable = port.defaultBrowser()
  return { executable, windows: executable ? port.windows(executable) : [], foreground: port.foreground(), input: port.lastInput() }
}

export function requestBrowserFocus(port: WindowsFocusPort, before: FocusSnapshot): void {
  // Only preselect an unambiguous window. Shell decides profiles/tabs itself.
  if (before.windows.length === 1) {
    const target = before.windows[0]!
    if (port.iconic(target.handle)) port.restore(target.handle)
    port.focus(target.handle)
  }
  const pids = new Set(before.windows.map(window => window.pid))
  if (pids.size === 1) port.allow([...pids][0]!)
}

export async function observeBrowserFocus(port: WindowsFocusPort, before: FocusSnapshot, options: {
  now?: () => number; wait?: (ms: number) => Promise<void>; timeoutMs?: number
} = {}): Promise<BrowserOpenResult['foreground']> {
  if (!before.executable) return 'target-unknown'
  const now = options.now ?? Date.now, wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const end = now() + (options.timeoutMs ?? 1500)
  for (let attempt = 0; attempt < 30; attempt++) {
    const foreground = port.foreground(), windows = port.windows(before.executable)
    if (windows.some(window => window.handle === foreground)) return 'confirmed'
    // Mouse movement alone is not an intentional switch to another program.
    if (foreground !== 0n && foreground !== before.foreground && before.input !== null && port.lastInput() !== before.input) return 'not-attempted'
    if (now() >= end) return windows.length === 1 ? 'denied' : 'target-unknown'
    await wait(60)
  }
  return 'target-unknown'
}

/** Lazy import: missing bindings never stop monitoring or prevent opening a URL. */
let focusPort: Promise<WindowsFocusPort> | null = null
export function loadWindowsFocus(): Promise<WindowsFocusPort> {
  return focusPort ??= createWindowsFocus()
}
async function createWindowsFocus(): Promise<WindowsFocusPort> {
  const { default: koffi } = await import('koffi')
  const user = koffi.load('user32.dll'), kernel = koffi.load('kernel32.dll'), associations = koffi.load('shlwapi.dll')
  const foreground = user.func('uintptr_t __stdcall GetForegroundWindow()')
  const visible = user.func('int __stdcall IsWindowVisible(uintptr_t hwnd)')
  const owner = user.func('uintptr_t __stdcall GetWindow(uintptr_t hwnd, uint command)')
  const processId = user.func('uint __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint *id)')
  const iconic = user.func('int __stdcall IsIconic(uintptr_t hwnd)')
  const restore = user.func('int __stdcall ShowWindowAsync(uintptr_t hwnd, int command)')
  const focus = user.func('int __stdcall SetForegroundWindow(uintptr_t hwnd)')
  const allow = user.func('int __stdcall AllowSetForegroundWindow(uint id)')
  koffi.proto('int __stdcall RasedBrowserWindowCallback(uintptr_t hwnd, intptr_t data)')
  const enumerate = user.func('int __stdcall EnumWindows(RasedBrowserWindowCallback *callback, intptr_t data)')
  const open = kernel.func('uintptr_t __stdcall OpenProcess(uint access, int inherit, uint id)')
  const close = kernel.func('int __stdcall CloseHandle(uintptr_t handle)')
  const query = kernel.func('int __stdcall QueryFullProcessImageNameW(uintptr_t handle,uint flags,_Out_ char16_t *path,_Inout_ uint *length)')
  const assoc = associations.func('int __stdcall AssocQueryStringW(uint flags,uint kind,str16 association,str16 extra,_Out_ char16_t *output,_Inout_ uint *length)')
  const lastInput = user.func('int __stdcall GetLastInputInfo(void *info)')
  return {
    defaultBrowser() {
      const buffer = Buffer.alloc(65536), size = [32768]
      return assoc(0x1000, 2, 'https', null, buffer, size) === 0 ? buffer.toString('utf16le').split('\0')[0]!.toLowerCase() : ''
    },
    windows(executable) {
      const windows: FocusWindow[] = [], paths = new Map<number, string>()
      enumerate((raw: bigint) => {
        try {
          if (!visible(raw) || owner(raw, 4)) return 1
          const id = [0]; processId(raw, id)
          if (!paths.has(id[0]!)) {
            const handle = open(0x1000, 0, id[0])
            if (!handle) { paths.set(id[0]!, ''); return 1 }
            try {
              const buffer = Buffer.alloc(65536), size = [32768]
              paths.set(id[0]!, query(handle, 0, buffer, size) ? buffer.subarray(0, size[0]! * 2).toString('utf16le').toLowerCase() : '')
            } finally { close(handle) }
          }
          if (paths.get(id[0]!) === executable) windows.push({ handle: BigInt(raw), pid: id[0]! })
        } catch { /* An inaccessible/exiting process is never selected. */ }
        return 1
      }, 0)
      return windows
    },
    foreground: () => BigInt(foreground()),
    lastInput() { const buffer = Buffer.alloc(8); buffer.writeUInt32LE(8); return lastInput(buffer) ? buffer.readUInt32LE(4) : null },
    iconic: handle => !!iconic(handle), restore: handle => { restore(handle, 9) },
    focus: handle => { focus(handle) }, allow: id => { allow(id) }
  }
}
