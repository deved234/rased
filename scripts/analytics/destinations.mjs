import { createHash } from 'node:crypto'

// Owner-reviewed public ingest-token fingerprints. These grant no read/admin
// access and do not enable application collection or scheduled operations.
export const reviewedDestinations = {
  production: { project: '670811', sha256: 'cb0bf63bf8cd9933b8eb522f791d511976a63e8ef228a7a70475a24f475c481e' },
  qa: { project: '672766', sha256: '370ba8fdadbb5cbc300d68fa2a63310e1a5864bf90c901c185082178503ef890' }
}
export function assertReviewedIngest(project, environment, token, destinations = reviewedDestinations) {
  const target = destinations[environment]
  if (!['production','qa'].includes(environment) || !target || project !== target.project || typeof token !== 'string' || !/^phc_[A-Za-z0-9_-]{10,200}$/.test(token) || createHash('sha256').update(token).digest('hex') !== target.sha256) throw Error('Unreviewed ingest destination; refusing operation')
}
