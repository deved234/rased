import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { LEGAL_DOCUMENTS } from '../src/shared/legal.ts'
mkdirSync('resources/legal', { recursive: true })
const parts = [], seen = new Set()
function gather(name, base = process.cwd()) {
  let dir = join(base, 'node_modules', name)
  if (!existsSync(join(dir, 'package.json'))) dir = join(process.cwd(), 'node_modules', name)
  const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')), id = name + '@' + p.version
  if (seen.has(id)) return
  seen.add(id)
  let text = ''
  for (const file of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license', 'license.txt', 'COPYING', 'OFL.txt']) if (existsSync(join(dir, file))) { text = readFileSync(join(dir, file), 'utf8'); break }
  if (!text && name === '@nodable/entities') text = readFileSync('docs/legal/entities-LICENSE.txt', 'utf8')
  if (!text) throw Error('Missing license: ' + id)
  parts.push(id + '\n' + (p.homepage ?? p.repository?.url ?? '') + '\n\n' + text)
  for (const dependency of Object.keys(p.dependencies ?? {})) gather(dependency, dir)
}
for (const name of ['react', 'react-dom', 'fast-xml-parser', '@fontsource/noto-sans-arabic']) gather(name)
writeFileSync('resources/legal/THIRD_PARTY_NOTICES.txt', parts.join('\n\n' + '='.repeat(72) + '\n\n'))
writeFileSync('resources/legal/LICENSE', readFileSync('LICENSE'))
for (const [key, file] of [['terms', 'TERMS.md'], ['privacy', 'PRIVACY.md']]) {
  const text = ['ar', 'en'].map(lang => '# ' + LEGAL_DOCUMENTS[lang][key].title + '\n\n2026-09-26 · RASED · david atef\n\n' + LEGAL_DOCUMENTS[lang][key].sections.map(([title, body]) => '## ' + title + '\n\n' + body).join('\n\n')).join('\n\n---\n\n')
  writeFileSync(file, text + '\n'); writeFileSync('resources/legal/' + file, text + '\n')
}
console.log('Terms, privacy, MIT and notices for ' + seen.size + ' components prepared')
