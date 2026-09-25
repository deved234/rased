// Reproducible icon build.
// 1. resources/icon-master.png is a 400x400 crop of the compass mark from
//    rased-logo-v2.png (crop rect 140,290,400,400). The v2 original is kept
//    untouched at the repo root; the crop keeps the circle + needle + target.
// 2. This script regenerates resources/icon.ico (multi-size) from the master.
// 3. resources/tray.png (32px) and src/renderer/assets/logo.png (96px) are
//    plain resizes of the same master (any resampler; they are committed).
import { writeFileSync } from 'node:fs'
import pngToIco from 'png-to-ico'
import { readFileSync } from 'node:fs'

const master = readFileSync(new URL('../resources/icon-master.png', import.meta.url))
const ico = await pngToIco(master)
writeFileSync(new URL('../resources/icon.ico', import.meta.url), ico)
console.log('icon.ico written', ico.length, 'bytes')
