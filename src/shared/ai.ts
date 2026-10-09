export const AI_PROVIDERS = ['gemini', 'openai', 'anthropic'] as const
export type AiProviderId = typeof AI_PROVIDERS[number]
export const AI_NAMES: Record<AiProviderId, string> = { gemini: 'Gemini · Google', openai: 'OpenAI', anthropic: 'Claude · Anthropic' }
export const PROMPT_VERSION = 'proposal-v2'
export interface AiSelection { provider: AiProviderId; model: string }
export interface AiSettings { schemaVersion: 1; activeProvider: AiProviderId; modelByProvider: Record<AiProviderId, string> }
export interface AiModel { id: string; displayName: string; compatibility: 'supported' | 'unsupported' | 'unknown'; structured?: boolean }
export interface AiCatalog { models: AiModel[]; fetchedAt: string }
export interface AiVerification { model: string; testedAt: string; revision: string }
export interface AiSetup {
  settings: AiSettings
  providers: Record<AiProviderId, { hasKey: boolean; keyReadable: boolean; revision: string; catalog: AiCatalog | null; verification: AiVerification | null }>
}
export interface AiOperationResult { ok: boolean; error?: string; retryAfterSeconds?: number; catalog?: AiCatalog; testedAt?: string; elapsedMs?: number }
export class AiProviderError extends Error {
  constructor(code: string, readonly retryAfterSeconds?: number) { super(code) }
}
export function retryAfter(error: unknown): number | undefined { return error instanceof AiProviderError ? error.retryAfterSeconds : undefined }
export function isAiProvider(value: unknown): value is AiProviderId { return AI_PROVIDERS.includes(value as AiProviderId) }
export function normalizeModel(provider: AiProviderId, value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = provider === 'gemini' ? value.trim().replace(/^models\//, '') : value.trim()
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id) ? id : null
}
export function sanitizeSelection(value: unknown): AiSelection | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!isAiProvider(v.provider)) return null
  const model = normalizeModel(v.provider, v.model)
  return model ? { provider: v.provider, model } : null
}
export function defaultAiSettings(): AiSettings { return { schemaVersion: 1, activeProvider: 'gemini', modelByProvider: { gemini: 'gemini-2.5-flash', openai: '', anthropic: '' } } }
export function sanitizeAiSettings(value: unknown): AiSettings | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<AiSettings>
  if (v.schemaVersion !== 1 || !isAiProvider(v.activeProvider) || !v.modelByProvider || typeof v.modelByProvider !== 'object') return null
  const settings = defaultAiSettings()
  settings.activeProvider = v.activeProvider
  for (const provider of AI_PROVIDERS) {
    const model = v.modelByProvider[provider]
    if (model === '') settings.modelByProvider[provider] = ''
    else {
      const normalized = normalizeModel(provider, model)
      if (!normalized) return null
      settings.modelByProvider[provider] = normalized
    }
  }
  return settings
}
export const AI_ERROR_CODES = ['bad-request', 'key-missing', 'key-unreadable', 'key-save-failed', 'auth-rejected', 'access-denied', 'model-unavailable', 'unsupported-model', 'invalid-request', 'quota-exceeded', 'rate-limited', 'provider-unavailable', 'network-error', 'timeout', 'cancelled', 'response-blocked', 'output-truncated', 'invalid-response', 'response-too-large', 'preview-changed', 'busy'] as const
export function safeAiError(error: unknown): string {
  return error instanceof Error && (AI_ERROR_CODES as readonly string[]).includes(error.message) ? error.message : 'network-error'
}
export function aiErrorText(code: string | undefined, ar: boolean, retryAfterSeconds?: number): string {
  const messages: Record<string, [string, string]> = {
    'key-missing': ['احفظ مفتاح الموفر من الإعدادات أولًا.', 'Save this provider’s API key in Settings first.'],
    'key-unreadable': ['تعذر فك تشفير المفتاح. أعد حفظه على هذا الجهاز.', 'Cannot decrypt the key. Save it again on this device.'],
    'key-save-failed': ['تعذر حفظ المفتاح أو حذفه بأمان.', 'Could not safely save or delete the key.'],
    'auth-rejected': ['الموفر رفض مفتاح المصادقة.', 'The provider rejected authentication.'],
    'access-denied': ['حسابك لا يملك إذنًا لهذا الطلب. راجع صلاحياته والمنطقة.', 'Access denied. Check account permissions and region.'],
    'model-unavailable': ['الموديل غير متاح. راجع معرفه وإتاحته لحسابك.', 'Model unavailable. Check its ID and account access.'],
    'unsupported-model': ['هذا الموديل غير مناسب لتوليد العروض.', 'This model does not support proposal drafting.'],
    'invalid-request': ['الموفر رفض إعدادات الطلب لهذا الموديل.', 'The provider rejected this model’s request configuration.'],
    'quota-exceeded': ['الحصة أو الرصيد غير كافيين. راجع حسابك لدى الموفر.', 'Quota or credits exhausted. Check your provider account.'],
    'rate-limited': ['طلبات كثيرة مؤقتًا. حاول لاحقًا.', 'Rate limited. Try again later.'],
    'provider-unavailable': ['خدمة الموفر غير متاحة مؤقتًا.', 'The provider is temporarily unavailable.'],
    'network-error': ['تعذر الاتصال بالموفر.', 'Could not reach the provider.'],
    timeout: ['انتهت مهلة الطلب. حاول لاحقًا.', 'Request timed out. Try later.'],
    cancelled: ['أُلغي الطلب.', 'Request cancelled.'],
    'response-blocked': ['الموفر لم يكمل الرد أو رفضه. راجع البيانات.', 'Response blocked or refused. Review the input.'],
    'output-truncated': ['المسودة لم تكتمل ضمن حد المخرجات.', 'Draft exceeded the output limit.'],
    'invalid-response': ['استجابة الموفر غير صالحة كمسودة. أعد المحاولة يدويًا.', 'Invalid draft response. Retry manually.'],
    'response-too-large': ['استجابة الموفر تجاوزت حد الحجم الآمن.', 'Provider response exceeded the size limit.'],
    'preview-changed': ['تغيرت البيانات أو الموفر أو الموديل. حدّث المعاينة ووافق مجددًا.', 'Data or AI selection changed. Refresh and approve the preview again.'],
    busy: ['يوجد توليد أو اختبار جارٍ. انتظر أو ألغِه.', 'A generation or test is in progress. Wait or cancel it.'],
    'bad-request': ['اختيار الموفر أو معرف الموديل غير صالح.', 'Invalid provider or model ID.']
  }
  const message = messages[code ?? '']?.[ar ? 0 : 1] ?? (ar ? 'تعذر إكمال العملية.' : 'Could not complete the operation.')
  return retryAfterSeconds ? `${message} ${ar ? `حاول بعد ${retryAfterSeconds} ثانية على الأقل.` : `Retry after at least ${retryAfterSeconds} seconds.`}` : message
}
