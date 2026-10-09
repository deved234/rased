import { lstat, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** Remove only the two retired Electron profiles; never touch Chrome or app data. */
export async function retireQuickBrowser(userData: string): Promise<void> {
  const base = await realpath(userData)
  const partitions = join(base, 'Partitions')
  try {
    const parent = await lstat(partitions)
    if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error('unsafe-partition-directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const source of ['mostaql', 'nafezly']) {
    const target = join(partitions, `rased-quick-apply-${source}`)
    try {
      const entry = await lstat(target)
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('unsafe-profile-directory')
      await rm(target, { recursive: true, force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
