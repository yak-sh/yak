// The former shared container keeps the durable census of clean workspace
// copies. A receipt precedes serving the copy, so retries never restore over
// files somebody has already changed. Processes and environments are absent
// from a filesystem snapshot.
import type { WorkspaceCopy } from '@yaks/machine/cloudflare'

type Copy = { done: boolean; processes: string[]; snapshot?: WorkspaceCopy }
type Storage = {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  list<T>(options: { prefix: string }): Promise<Map<string, T>>
  delete(key: string): Promise<unknown>
}

let PREFIX = 'workspace-copy:'
let CLOSED = 'workspace-closed'

/** Take completed output, after the commands already using the box finish. */
export let afterCompiles = async <T>(
  processes: {
    status: string
    waitForExit(timeout: number): Promise<unknown>
  }[],
  timeout: number,
  take: () => Promise<T>,
) => {
  await Promise.all(
    processes.filter((p) => p.status == 'running' || p.status == 'starting')
      .map((p) => p.waitForExit(timeout)),
  )
  return await take()
}

export let copies = (
  storage: Storage,
  take: () => Promise<{ snapshot?: WorkspaceCopy; processes: string[] }>,
  restore: (name: string, snapshot: WorkspaceCopy) => Promise<boolean>,
  discard: (snapshot: WorkspaceCopy) => Promise<void>,
) => {
  // A DO's requests interleave across I/O. Serialize copying without holding
  // blockConcurrencyWhile through a potentially large filesystem backup.
  let pending = Promise.resolve()
  let open = async () => {
    if (await storage.get(CLOSED)) {
      throw new Error('this sandbox has been erased')
    }
  }
  let fork = async (name: string, refreshed = false): Promise<string[]> => {
    await open()
    let key = PREFIX + name
    let row = await storage.get<Copy>(key)
    if (!row?.done) {
      if (!row) {
        row = { done: false, processes: [] }
        await storage.put(key, row)
      }
      if (!row.snapshot) {
        Object.assign(row, await take())
        await storage.put(key, row)
      }
      await open()
      if (row.snapshot && !await restore(name, row.snapshot)) {
        // No caller has used this destination. Replace an expired/missing
        // archive, preserving completed copies' later work.
        await discard(row.snapshot)
        delete row.snapshot
        await storage.put(key, row)
        if (refreshed) throw new Error('cannot restore the workspace snapshot')
        return await fork(name, true)
      }
      await open()
      row.done = true
      await storage.put(key, row)
    }
    if (row.snapshot) {
      await discard(row.snapshot)
      await storage.put(key, { done: true, processes: row.processes })
    }
    return row.processes
  }
  return {
    fork: (name: string) => {
      let run = pending.then(() => fork(name))
      pending = run.then(() => {}, () => {})
      return run
    },
    names: async () =>
      [...(await storage.list<Copy>({ prefix: PREFIX })).keys()]
        .map((key) => key.slice(PREFIX.length)),
    retire: async () => {
      await storage.put(CLOSED, true)
      await pending
      return [...(await storage.list<Copy>({ prefix: PREFIX })).keys()]
        .map((key) => key.slice(PREFIX.length))
    },
    discard: async () => {
      for (let row of (await storage.list<Copy>({ prefix: PREFIX })).values()) {
        if (row.snapshot) await discard(row.snapshot)
      }
    },
    clear: async () => {
      for (let key of (await storage.list<Copy>({ prefix: PREFIX })).keys()) {
        await storage.delete(key)
      }
    },
  }
}
