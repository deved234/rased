/** Exact one/two-code-point lookup without reading large description bodies.
 * Hex boundaries prevent substring collisions and introduce no token semantics. */
export function shortSearchKey(text: string): string { return '|' + Array.from(text).map(c => c.codePointAt(0)!.toString(16)).join('.') + '|' }
export function shortSearchKeys(text: string): string {
  const chars = Array.from(text), keys = new Set<string>()
  for (let i = 0; i < chars.length; i++) {
    keys.add(chars[i]!)
    if (i + 1 < chars.length) keys.add(chars[i]! + chars[i + 1]!)
  }
  return [...keys].map(shortSearchKey).join('')
}
