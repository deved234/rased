import type { AnalyticsConsent } from './consent.js'
import type { TelemetryConfig } from './config.js'
import type { TelemetryEnvelope, TelemetryName } from '../../shared/telemetry.js'

export interface TelemetryWorkerData {
  directory: string
  consent: AnalyticsConsent
  config: TelemetryConfig | null
  fixture?: boolean
  purgeOnly?: boolean
  context: Pick<TelemetryEnvelope, 'appVersion' | 'language' | 'windowsFamily' | 'environment'>
}
export type TelemetryMessage =
  | { type: 'consent'; consent: AnalyticsConsent; request: number }
  | { type: 'purge'; request: number }
  | { type: 'record'; generation: number; name: TelemetryName; properties: Record<string, string | number>; once?: string }
  | { type: 'counter'; generation: number; name: 'monitoring_hourly' | 'notification_summary'; field: string }
  | { type: 'context'; language: 'ar' | 'en' }
  | { type: 'suspend' | 'resume' | 'reset' | 'close' | 'flush'; request?: number }
