import { equal, ok, test } from '@yaks/testing'
import { appStore, directoryOf } from './directory.ts'
import { type ServingCopyDoor } from './directory-copy.ts'
import { collected } from './erase.ts'
import { declared } from './testing.ts'
import { ServingCopy } from './serving-copy.ts'
import { ADA, ADA_OWNS, platform, seeded } from './serving-probe.ts'

let copy = new ServingCopy({
  persistence: { read: () => undefined, write: () => {} },
})
let rpc: ServingCopyDoor = {
  begin: (floor) => Promise.resolve(copy.begin(floor)),
  finish: (revision) => Promise.resolve(copy.finish(revision)),
  revision: () => Promise.resolve(copy.revision),
  settle: (revision, committed) =>
    Promise.resolve(copy.settle(revision, committed)),
  put: (...args) => Promise.resolve(copy.put(...args)),
  get: (key) => Promise.resolve().then(() => copy.get(key)),
  valid: (revision) => Promise.resolve(copy.valid(revision)),
  publish: (...args) => Promise.resolve(copy.publish(...args)),
}
let p = platform({
  SERVING_COPY: { idFromName: (name) => name, get: () => rpc },
})
let { dir, space, app } = await seeded(p.env)
await dir.apply({
  entities: [{
    entity: { eid: '$home' },
    app: { space: space.eid, slug: 'home', version: 1, access: 'public' },
    trashed: {
      at: new Date(Date.now() - 31 * 86_400_000).toISOString(),
      by: ADA,
    },
  }],
}, ADA_OWNS)
let home = (await dir.app(space, 'home'))!
await declared(p.env, space, home, {
  vocab: { $defs: { entry: { properties: { text: { type: 'string' } } } } },
  tools: {},
})
let erased = await collected(p.env)
let found = (await directoryOf(p.env.STORE).appAt(app.eid))!
let uses = await appStore(p.env.STORE, found.space, found.app).consume(
  '/uses',
  async (r) => ({ status: r.status, body: await r.json() }),
)

test('the trash alarm carries directory policy when it checks a component home’s peers', () => {
  equal(erased, 1)
  ok(Number.isSafeInteger(found.app.policy))
  equal(uses, { status: 200, body: {} })
})
