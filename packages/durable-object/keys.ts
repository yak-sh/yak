/**
 * A Durable Object's async key-value storage (`ctx.storage.get`, `put`,
 * `delete`, `list`), counted against its row ceiling (./ceiling.ts) as a
 * statement through the driver is. On a SQLite-backed object every key is a
 * row of a table the runtime keeps, and Cloudflare bills it so: a key read is
 * a row read, and a key put or deleted a row written
 * (https://developers.cloudflare.com/durable-objects/platform/pricing/). A
 * stopped object refuses a call as `Stopped`, a read past its read rows and
 * a write past either.
 *
 * ```ts
 * import { keys } from '@yaks/durable-object/keys'
 * import { bounded } from '@yaks/durable-object/ceiling'
 * import { assertEquals } from '@std/assert'
 *
 * let held = new Map<string, unknown>()
 * let storage = {
 *   get: <T>(key: string) => Promise.resolve(held.get(key) as T | undefined),
 *   put: (key: string, value: unknown) => Promise.resolve(void held.set(key, value)),
 *   delete: (key: string) => Promise.resolve(held.delete(key)),
 *   list: <T>() => Promise.resolve(held as Map<string, T>),
 * }
 * let kept = keys(storage)
 * await kept.put('a', 1)
 * assertEquals(await kept.get('a'), 1)
 * let [minute] = bounded(storage).spent()
 * assertEquals([minute.read, minute.written], [1, 1])
 * ```
 *
 * @module
 */

import { bounded } from './ceiling.ts'

/** The async key-value methods of a Durable Object's storage, single keys
 * at a time. */
export type Keys = {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  list<T>(
    options?: { prefix?: string; limit?: number },
  ): Promise<Map<string, T>>
}

/** `storage`'s async key-value methods, each counted against the ceiling of
 * the object whose storage it is: the one its host named first, as a
 * driver's statements are. */
export let keys = (storage: Keys): Keys => {
  let bound = bounded(storage)
  // One call: admitted first, and counted once it ends, a failed one too.
  let call = async <T>(
    name: string,
    writing: boolean,
    run: () => Promise<T>,
    rows: (answer?: T) => number,
  ): Promise<T> => {
    bound.admit(writing)
    let answer: T | undefined
    try {
      return answer = await run()
    } finally {
      let n = rows(answer)
      bound.count({
        shape: () => `kv ${name}`,
        rowsRead: writing ? 0 : n,
        rowsWritten: writing ? n : 0,
        returned: n,
      })
    }
  }
  return {
    get: (key) => call('get', false, () => storage.get(key), () => 1),
    put: (key, value) =>
      call('put', true, () => storage.put(key, value), () => 1),
    delete: (key) => call('delete', true, () => storage.delete(key), () => 1),
    list: <T>(options?: { prefix?: string; limit?: number }) =>
      call(
        'list',
        false,
        () => storage.list<T>(options),
        (listed) => Math.max(1, listed?.size ?? 0),
      ),
  }
}
