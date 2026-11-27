/** Convert a BGRA bitmap to a macOS tray template: black shape, original alpha. */
export function toTemplateBitmap(bgra: Buffer): Buffer {
  const out = Buffer.from(bgra)
  for (let i = 0; i + 3 < out.length; i += 4) {
    out[i] = 0
    out[i + 1] = 0
    out[i + 2] = 0
  }
  return out
}
