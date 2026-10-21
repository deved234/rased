export interface TelemetryConfig {
  token: string
  host: 'https://us.i.posthog.com'
  environment: 'production' | 'qa'
}
export function telemetryConfig(packaged: boolean, isolated: boolean): TelemetryConfig | null {
  // These literals are replaced only at build time; renderer/runtime env cannot
  // enable production capture in development, CI, an isolated test or a fork.
  const token = process.env['RASED_ANALYTICS_BUILD_TOKEN'] ?? ''
  const ready = process.env['RASED_ANALYTICS_BUILD_READY'] === 'true'
  const environment = process.env['RASED_ANALYTICS_BUILD_ENVIRONMENT'] ?? 'production'
  if (!packaged || isolated || !ready || !['production', 'qa'].includes(environment) || !/^phc_[A-Za-z0-9_-]{10,200}$/.test(token)) return null
  return { token, host: 'https://us.i.posthog.com', environment: environment as 'production' | 'qa' }
}
