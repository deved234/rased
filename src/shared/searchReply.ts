/** Expected cancellation crosses IPC as data, never as an Electron handler error. */
export type SearchReply<T> = { status: 'ready'; value: T } | { status: 'superseded' }

export function isSearchSuperseded(error: unknown): boolean {
  return error instanceof Error && error.message === 'search-superseded'
}

export async function searchReply<T>(request: Promise<T>): Promise<SearchReply<T>> {
  try { return { status: 'ready', value: await request } }
  catch (error) {
    if (isSearchSuperseded(error)) return { status: 'superseded' }
    throw error
  }
}

export function unwrapSearchReply<T>(reply: SearchReply<T>): T {
  if (reply.status === 'superseded') throw new Error('search-superseded')
  return reply.value
}
