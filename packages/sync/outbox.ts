import { stringify } from '@yaks/vocab/wire'

// Intent is separate from the replica: eviction and subscription resets must
// never erase a write whose answer we have not heard.
export type Pending<T> = {
  key: string
  sent: T
  state: 'pending' | 'refused'
  /** Admission order, retained across pages independently of random keys. */
  at?: number
  refusal?: { name: string; message: string }
}

/** The disk seam. A completed put/remove means the transaction committed. */
export type OutboxStore<T> = {
  load: () => Promise<Pending<T>[]>
  put: (entry: Pending<T>) => Promise<void>
  remove: (key: string) => Promise<void>
  close?: () => void
}

/** One database per origin, with app/store and credentials in the scope. */
export let outboxIdb = <T>(scope: string): OutboxStore<T> => {
  let opening: Promise<IDBDatabase> | undefined
  let db = () =>
    opening ??= new Promise((resolve, reject) => {
      let req = indexedDB.open('yaks-write-outbox', 1)
      req.onupgradeneeded = () =>
        req.result.createObjectStore('writes', { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () =>
        reject(new Error('Write outbox database is blocked'))
    })
  let transaction = async <R>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<R>,
  ): Promise<R> => {
    let database = await db()
    return await new Promise((resolve, reject) => {
      let tx = database.transaction('writes', mode)
      let req = run(tx.objectStore('writes'))
      tx.oncomplete = () => resolve(req.result)
      tx.onabort = () => reject(tx.error ?? req.error)
      tx.onerror = () => reject(tx.error ?? req.error)
    })
  }
  let id = (key: string) => JSON.stringify([scope, key])
  return {
    load: async () =>
      (await transaction('readonly', (s) => s.getAll()))
        .filter((row) => row.scope === scope).map((row) => row.entry),
    put: async (entry) => {
      await transaction(
        'readwrite',
        (s) => s.put({ id: id(entry.key), scope, entry }),
      )
    },
    remove: async (key) => {
      await transaction('readwrite', (s) => s.delete(id(key)))
    },
    close: () => {
      opening?.then((database) => database.close(), () => {})
    },
  }
}

/** The observable delivery handle. Only an acceptance removes pending intent. */
export type Outbox<T, R> = {
  ready: Promise<void>
  submit: (sent: T, key?: string) => Promise<R>
  pending: () => Pending<T>[]
  onPending: (fn: () => void) => () => void
  retry: (key: string) => Promise<void>
  forget: (key: string) => Promise<void>
  close: () => void
}

/** A durable, ordered queue. An unknown answer rejects that caller (unsaved),
 * but retains and retries the exact intent/key. A refusal is retained for the
 * person to inspect, never silently discarded or automatically resubmitted.
 * Without IndexedDB (non-browser runtimes), the queue lasts for this instance.
 * In a browser a failed disk write fails closed: nothing is sent first. */
export let durableOutbox = <T, R>(opts: {
  scope: string
  send: (key: string, sent: T) => Promise<R>
  store?: OutboxStore<T>
  report?: (error: unknown) => void
  timer?: (fn: () => void, ms: number) => unknown
  cancelTimer?: (handle: unknown) => void
  wait?: number
}): Outbox<T, R> => {
  let disk = opts.store ??
    (globalThis.indexedDB ? outboxIdb<T>(opts.scope) : undefined)
  let entries = new Map<string, Pending<T>>()
  let listeners = new Set<() => void>()
  let waiting = new Map<
    string,
    { resolve: (result: R) => void; reject: (error: unknown) => void }
  >()
  let closed = false
  let running = false
  let rerun = false
  let last = 0
  let alarm: unknown
  let report = (error: unknown) => opts.report?.(error)
  let notify = () => {
    for (let fn of listeners) fn()
  }
  let arm = () => {
    if (closed || alarm !== undefined) return
    alarm = (opts.timer ?? setTimeout)(() => {
      alarm = undefined
      void drain()
    }, opts.wait ?? 1000)
  }
  let ready = (disk?.load() ?? Promise.resolve([])).then((rows) => {
    rows.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    for (let row of rows) {
      last = Math.max(last, row.at ?? 0)
      entries.set(row.key, row)
    }
    notify()
  })
  let drain = async () => {
    if (closed) return
    if (running) {
      rerun = true
      return
    }
    running = true
    try {
      await ready
      for (let [key, entry] of entries) {
        if (closed) break
        if (entry.state === 'refused') continue
        try {
          let result = await opts.send(key, entry.sent)
          await disk?.remove(key)
          entries.delete(key)
          waiting.get(key)?.resolve(result)
          waiting.delete(key)
          notify()
        } catch (error) {
          waiting.get(key)?.reject(error)
          waiting.delete(key)
          if ((error as { outcome?: string })?.outcome === 'refused') {
            entry.state = 'refused'
            entry.refusal = {
              name: (error as Error).name,
              message: (error as Error).message,
            }
            await disk?.put(entry)
            notify()
          } else {
            report(error)
            arm()
            break
          }
        }
      }
    } catch (error) {
      report(error)
      for (let waiter of waiting.values()) waiter.reject(error)
      waiting.clear()
      arm()
    } finally {
      running = false
      if (rerun) {
        rerun = false
        void drain()
      }
    }
  }
  // Queue disk admissions too: a slower first put must not let the second
  // write pass it, and startup replay must precede newly submitted intent.
  let admission = ready
  let submit = (
    sent: T,
    key: string = `outbox:${crypto.randomUUID()}`,
  ): Promise<R> => {
    // Freeze intent at the call boundary, before identity/disk startup yields.
    let copy: T
    try {
      copy = structuredClone(sent)
    } catch (error) {
      return Promise.reject(error)
    }
    let answer = new Promise<R>((resolve, reject) => {
      admission = admission.then(async () => {
        await ready
        if (closed) throw new Error('Write outbox is closed')
        let old = entries.get(key)
        if (old && stringify(old.sent) !== stringify(copy)) {
          throw new Error('Write key already names different intent')
        }
        if (old?.state === 'refused') {
          throw new Error(old.refusal?.message ?? 'Write refused')
        }
        last = Math.max(Date.now(), last + 0.001)
        let entry: Pending<T> = old ??
          { key, sent: copy, state: 'pending', at: last }
        await disk?.put(entry)
        entries.set(key, entry)
        let prior = waiting.get(key)
        waiting.set(key, {
          resolve: (value) => {
            prior?.resolve(value)
            resolve(value)
          },
          reject: (error) => {
            prior?.reject(error)
            reject(error)
          },
        })
        notify()
        void drain()
      }).catch(reject)
    })
    return answer
  }
  ready.then(() => {
    void drain()
  }, report)
  return {
    ready,
    submit,
    pending: () => [...entries.values()].map((entry) => structuredClone(entry)),
    onPending: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    retry: async (key: string) => {
      await ready
      let entry = entries.get(key)
      if (!entry) return
      entry.state = 'pending'
      delete entry.refusal
      await disk?.put(entry)
      notify()
      void drain()
    },
    forget: async (key: string) => {
      await ready
      await disk?.remove(key)
      entries.delete(key)
      waiting.get(key)?.reject(new Error('Write explicitly discarded'))
      waiting.delete(key)
      notify()
    },
    close: () => {
      closed = true
      if (alarm !== undefined) {
        ;(opts.cancelTimer ?? ((handle) => clearTimeout(handle as number)))(
          alarm,
        )
      }
      disk?.close?.()
      listeners.clear()
    },
  }
}
