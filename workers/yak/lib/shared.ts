// A read an isolate's requests share by key: started by the first request to
// ask, and handed to every request that asks while it runs or after.
//
// A read's I/O belongs to the request that began it, and the runtime cancels
// it when that request ends. A promise shared past that point never settles,
// so every later request awaiting it waits, with no I/O of its own, until the
// isolate goes: the page that hung 60 seconds on a release's copy.json (T-363).
// So the request that starts a shared read holds itself open until the read
// settles (defects.ts `background`, the runtime's `waitUntil`), even when it
// answers or its visitor leaves first.
//
// A failed read is not kept: the next request to ask reads again. Where
// `limit` is given, a Map keeps that many keys, dropping the oldest asked.
import { background } from '../defects.ts'

type Kept<K, T> = {
  get(key: K): Promise<T> | undefined
  set(key: K, value: Promise<T>): unknown
  delete(key: K): unknown
}

export let sharing = <K, T>(
  kept: Kept<K, T>,
  key: K,
  read: () => Promise<T>,
  limit?: number,
): Promise<T> => {
  let lru = limit && kept instanceof Map ? kept : null
  let had = kept.get(key)
  if (had) {
    lru?.delete(key)
    lru?.set(key, had)
    return had
  }
  let reading = read()
  kept.set(key, reading)
  reading.catch(() => kept.get(key) == reading && kept.delete(key))
  background(reading.then(() => {}, () => {}))
  for (let old of lru?.keys() ?? []) {
    if (lru!.size <= limit!) break
    lru!.delete(old)
  }
  return reading
}
