import { createHash } from 'node:crypto'
import { reviewedDestinations } from './destinations.mjs'

// Production stays empty until requested-person cloud deletion is verified.
// QA may be packaged for isolated preflight; ordinary builds still strip it.
export const approvedTokenHashes = { production: [], qa: [reviewedDestinations.qa.sha256] }
export function analyticsBuildDefines(env = process.env, approved = approvedTokenHashes) {
  const ready = env.RASED_ANALYTICS_BUILD_READY === 'true'
  const token = env.RASED_ANALYTICS_BUILD_TOKEN ?? ''
  const environment = env.RASED_ANALYTICS_BUILD_ENVIRONMENT ?? 'production'
  if (ready) {
    if (!['production', 'qa'].includes(environment) || !/^phc_[A-Za-z0-9_-]{10,200}$/.test(token) || !approved[environment]?.includes(createHash('sha256').update(token).digest('hex')) || (env.CI !== 'true' && env.RASED_ANALYTICS_LOCAL_RELEASE !== 'true')) throw Error('Analytics build refused: unapproved destination or release context. No credential values logged.')
  }
  return {
    'process.env.RASED_ANALYTICS_BUILD_TOKEN': JSON.stringify(ready ? token : ''),
    'process.env.RASED_ANALYTICS_BUILD_READY': JSON.stringify(ready ? 'true' : 'false'),
    'process.env.RASED_ANALYTICS_BUILD_ENVIRONMENT': JSON.stringify(environment)
  }
}
