// Effects keep the temporary app view after the browser request has ended.
import { equal, test } from '@yaks/testing'
import { toolEid } from '@yaks/tools'
import { parseTools } from '@yaks/tools/declared'
import { type App, appStore, storeName } from './directory.ts'
import { ADA_OWNS, platform, seeded } from './serving-probe.ts'
import { effects } from './facets/app-effects.ts'
import type { Stored } from './graph.ts'
import { lending } from './inference.ts'
import { blobPrefix } from './blob-key.ts'
import { appVocab } from './vocab.ts'

let p = platform()
let { dir, space, app } = await seeded(p.env)
await p.settled()
let before = (await dir.appAt(app.eid))!.app.meter
let candidate: App = {
  ...app,
  store: `preview/${crypto.randomUUID()}`,
  script: 'draft-worker',
  worker: 'draft-worker',
  mount: '/cookbook/_preview/private-ticket/',
  files: 'temporary/private-files',
  scope: 'store',
}
let store = appStore(p.env.STORE, space, candidate)
let post = (path: string, body: unknown) =>
  store(path, {
    method: 'POST',
    body: JSON.stringify(body),
  }, { ...ADA_OWNS, 'x-yak-kernel': '1' })
await post('/expires', {
  at: Date.now() + 60_000,
  context: { space, app: candidate },
})
let dispatched: { script: string; mount: string | null }[] = []
p.env.DISPATCH = {
  get: (script: string) => ({
    fetch: (req: Request) => {
      dispatched.push({ script, mount: req.headers.get('x-yak-mount') })
      return Promise.resolve(new Response('draft reply'))
    },
  }),
}
await post(
  '/tools',
  parseTools({
    $defs: {
      draft_ping: {
        tool: true,
        description: 'Ping the draft',
        worker: '/ping',
      },
    },
  }, ['doc']),
)
await post('/apply', [{
  entity: { eid: crypto.randomUUID() },
  call: { to: toolEid('draft_ping'), args: {} },
}])
await p.object(storeName(space, candidate)).alarm()
await p.settled()
let after = (await dir.appAt(app.eid))!.app.meter

test('a recorded preview command calls the draft worker at its private mount', () => {
  equal(dispatched, [{
    script: 'draft-worker',
    mount: candidate.mount ?? null,
  }])
})

test('temporary store effects leave the live app storage meter alone', () => {
  equal(after, before)
})

let deleted: string[] = []
let sha = 'a'.repeat(64)
let at = {
  env: p.env,
  app: app.eid,
  graph: { vocab: appVocab(), read: () => Promise.resolve([]) },
  context: { space, app: candidate },
} as unknown as Stored
let remove = p.env.BLOBS.delete.bind(p.env.BLOBS)
p.env.BLOBS.delete = (keys) => {
  deleted.push(...[keys].flat())
  return Promise.resolve()
}
await effects({}, { store: at }).delete_upload!(
  { entity: { eid: sha } } as never,
  {} as never,
  {} as never,
)
p.env.BLOBS.delete = remove
let executor = await lending(at, 'openrouter')

test('deleting an upload from a preview touches only its private blob prefix', () => {
  equal(deleted, [blobPrefix(space, candidate) + sha])
})

test('preview model calls use inline execution instead of callbacks to the live store', () => {
  equal(executor, undefined)
})
