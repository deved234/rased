import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { AiProviderId } from '../../shared/ai.js'

interface KeyEnvelope { version: 1; revision: string; encrypted: string }
function invalidKey(key: string): boolean { return /\s/.test(key) || [...key].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) }
export function aiKeyPath(userData: string, provider: AiProviderId): string { return join(userData, 'ai-keys', `${provider}.enc`) }
function envelope(userData: string, provider: AiProviderId): KeyEnvelope | null {
  try {
    const parsed = JSON.parse(readFileSync(aiKeyPath(userData, provider), 'utf8')) as KeyEnvelope
    return parsed.version === 1 && typeof parsed.revision === 'string' && /^[a-f0-9-]{36}$/.test(parsed.revision) && typeof parsed.encrypted === 'string' && parsed.encrypted.length < 16000 ? parsed : null
  } catch { return null }
}
export function saveAiKey(userData: string, provider: AiProviderId, value: unknown): boolean {
  if (typeof value !== 'string' || !safeStorage.isEncryptionAvailable()) return false
  const key = value.trim()
  if (key.length < 16 || key.length > 4096 || invalidKey(key)) return false
  const target = aiKeyPath(userData, provider)
  const temp = `${target}.tmp`
  try {
    mkdirSync(join(userData, 'ai-keys'), { recursive: true })
    const data: KeyEnvelope = { version: 1, revision: randomUUID(), encrypted: safeStorage.encryptString(key).toString('base64') }
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600 })
    const written = JSON.parse(readFileSync(temp, 'utf8')) as KeyEnvelope
    if (safeStorage.decryptString(Buffer.from(written.encrypted, 'base64')) !== key) throw new Error('verification failed')
    renameSync(temp, target)
    return true
  } catch {
    try { unlinkSync(temp) } catch { /* absent */ }
    return false
  }
}
// Never remove the only usable copy before a verified atomic replacement exists.
export function migrateGeminiKey(userData: string): void {
  const old = join(userData, 'gemini-key.enc')
  if (!existsSync(old) || !safeStorage.isEncryptionAvailable() || existsSync(aiKeyPath(userData, 'gemini'))) return
  try {
    const key = safeStorage.decryptString(readFileSync(old))
    if (!saveAiKey(userData, 'gemini', key)) return
    try {
      if (readAiKey(userData, 'gemini', false) !== key) throw new Error('verification failed')
    } catch { unlinkSync(aiKeyPath(userData, 'gemini')); return }
    unlinkSync(old)
  } catch { /* retain original; next launch can retry */ }
}
export function readAiKey(userData: string, provider: AiProviderId, migrate = true): string {
  if (migrate && provider === 'gemini') migrateGeminiKey(userData)
  const data = envelope(userData, provider)
  const legacy = provider === 'gemini' && !existsSync(aiKeyPath(userData, provider)) && existsSync(join(userData, 'gemini-key.enc'))
  if (!data && !legacy) throw new Error(existsSync(aiKeyPath(userData, provider)) ? 'key-unreadable' : 'key-missing')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('key-unreadable')
  try {
    const key = safeStorage.decryptString(data ? Buffer.from(data.encrypted, 'base64') : readFileSync(join(userData, 'gemini-key.enc')))
    if (!key || invalidKey(key)) throw new Error()
    return key
  } catch { throw new Error('key-unreadable') }
}
export function keyStatus(userData: string, provider: AiProviderId): { hasKey: boolean; keyReadable: boolean; revision: string } {
  if (provider === 'gemini') migrateGeminiKey(userData)
  const hasKey = existsSync(aiKeyPath(userData, provider)) || (provider === 'gemini' && existsSync(join(userData, 'gemini-key.enc')))
  let keyReadable = false
  try { readAiKey(userData, provider, false); keyReadable = true } catch { /* status only */ }
  return { hasKey, keyReadable, revision: envelope(userData, provider)?.revision ?? (hasKey ? 'legacy' : 'missing') }
}
export function deleteAiKey(userData: string, provider: AiProviderId): boolean {
  const files = [aiKeyPath(userData, provider)]
  if (provider === 'gemini') files.push(join(userData, 'gemini-key.enc'))
  let ok = true
  for (const file of files) { try { if (existsSync(file)) unlinkSync(file) } catch { ok = false } }
  return ok
}
