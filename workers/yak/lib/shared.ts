import { singleFlight } from '@yaks/fp'
import { background, invocationKey } from '../defects.ts'

export let inFlight = singleFlight(invocationKey, background)

type Cache<K, T> = {
  has(key: K): boolean
  get(key: K): T | undefined
  set(key: K, value: T): unknown
  delete(key: K): unknown
}

/** Keep completed values across invocations and pending reads within one. */
export let sharing = <K, T>(
  kept: Cache<K, T>,
  key: K,
  read: () => Promise<T>,
  limit?: number,
): Promise<T> => {
  let lru = limit && kept instanceof Map ? kept : null
  if (kept.has(key)) {
    let had = kept.get(key) as T
    lru?.delete(key)
    lru?.set(key, had)
    return Promise.resolve(had)
  }
  return inFlight(kept, key, async () => {
    let answer = await read()
    if (!kept.has(key)) kept.set(key, answer)
    for (let old of lru?.keys() ?? []) {
      if (lru!.size <= limit!) break
      lru!.delete(old)
    }
    return answer
  })
}
