// A stopped store's wait reaches the page: the kernel's doors pass on the
// `retry-after` a store past its rows answers with (apps.ts `waited`), for a
// read it refuses and a write it keeps, and so does the kernel's own catch
// for a door that throws the refusal it met (kernel.ts).
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { connector, kernel, meta, seed, signIn, unique } from './probe.ts'

let k = await kernel()
let { eids, cookie } = await seed(k, [{
  slug: 'stoppedprobe',
  apps: ['notes'],
}])
// Its rows list who may join it (join.ts), so a stranger's `/api/me` asks
// the store, and meets the stop where that door does not catch it.
let agent = connector(k, cookie)
let at = { space: 'stoppedprobe', app: 'notes' }
await agent.tool('app_files', {
  ...at,
  files: [{
    path: 'vocab.json',
    content: JSON.stringify({
      join: { emails: ['neighbor.email'] },
      $defs: { neighbor: { properties: { email: { type: 'string' } } } },
    }),
  }],
})
await agent.tool('app_deploy', at)
let stranger = await signIn(k, `${unique('stranger')}@bot.yak.sh`)
let [row] = await meta(k).query(`.entity.eid=${eids['stoppedprobe/notes']}`)
// Past the rows it may read in a minute (ceiling.ts `WINDOWS`), it takes
// nothing for 60 s.
k.ceiling((row as unknown as { app: { store: string } }).app.store).count({
  shape: () => 'spent',
  rowsRead: 60e6,
  rowsWritten: 0,
  returned: 0,
})

let wrote = {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify([{ entity: { eid: 'n1' }, doc: { title: 'kept' } }]),
}

for (
  let [door, path, init, status] of [
    ['a read', 'query?q=.doc', {}, 429],
    ['the graph', 'graph', {}, 429],
    ['the vocabulary', 'vocab', {}, 429],
    ['a blob', `blob/${'a'.repeat(64)}`, {}, 429],
    ['a write it keeps', 'apply', wrote, 202],
    ['who is asking', 'me', { headers: { cookie: stranger.cookie } }, 429],
  ] as [string, string, RequestInit, number][]
) {
  test(`a stopped store's wait reaches the page at ${door}`, async () => {
    let r = await k.at('stoppedprobe.yaks.app', `/notes/api/${path}`, {
      ...init,
      headers: { cookie, ...init.headers },
    })
    await r.body?.cancel()
    let wait = Number(r.headers.get('retry-after'))
    assertEquals(r.status, status)
    assert(wait > 0 && wait <= 60, `retry-after: ${wait}`)
  })
}
