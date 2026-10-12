// A storage exception that leaves the incarnation running must still answer
// its waiting writer. The retained input then recovers through owner review.
import { type State, Store } from './graph.ts'

export let writeStorageFailure = async (db: State['storage']) => {
  let context = {
    storage: db,
    getWebSockets: () => [],
    acceptWebSocket: () => {},
  }
  let store = new Store(context)
  let headers = {
    'x-store': 'probe/write-storage-failure',
    'x-yak-access': 'private',
    'x-yak-role': 'owner',
    'x-yak-kernel': '1',
  }
  let request = (path: string, body?: unknown) =>
    new Request(`http://store${path}`, {
      headers,
      ...body === undefined ? {} : {
        method: 'POST',
        body: JSON.stringify(body),
      },
    })
  let ready = await store.fetch(request('/vocab', {}))
  if (!ready.ok) throw new Error(await ready.text())
  await ready.body?.cancel()
  let exec = db.sql.exec.bind(db.sql), failed = false
  db.sql.exec = (sql, ...bindings) => {
    if (bindings.includes('poisoned-storage')) failed = true
    if (failed) throw new Error('SQLITE_IOERR: storage unavailable')
    return exec(sql, ...bindings)
  }
  let eid = crypto.randomUUID()
  let body = [{ entity: { eid }, doc: { title: 'poisoned-storage' } }]
  let timer: ReturnType<typeof setTimeout> | undefined
  let response: { status: number; body: unknown } | undefined
  try {
    response = await Promise.race([
      store.fetch(request('/apply', body)).then(async (r) => ({
        status: r.status,
        body: await r.json(),
      })),
      new Promise<undefined>((yes) =>
        timer = setTimeout(() => yes(undefined), 300)
      ),
    ])
  } finally {
    clearTimeout(timer)
    db.sql.exec = exec
  }
  if (!response) return { settled: false }
  store = new Store(context)
  let read = async (path: string) => {
    let r = await store.fetch(request(path))
    if (!r.ok) throw new Error(await r.text())
    return await r.json()
  }
  let before = await read(`/query?q=.entity.eid=${eid}&?doc`)
  let [kept] = await read('/writes?seq=1')
  let retried = await store.fetch(request('/writes?seq=1', {}))
  if (!retried.ok) throw new Error(await retried.text())
  await retried.body?.cancel()
  let [landed] = await read('/writes?seq=1')
  let after = await read(`/query?q=.entity.eid=${eid}&?doc`)
  store = new Store(context)
  let replayed = await read(`/query?q=.entity.eid=${eid}&?doc`)
  return {
    settled: true,
    response,
    before,
    kept,
    landed,
    after,
    replayed,
    body,
  }
}
