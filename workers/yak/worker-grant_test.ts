// A worker's grants outlive directory writes that do not concern them: the
// revision a grant was read at is the whole directory's, so one upload or one
// new person elsewhere must not lock an app's worker out of its own store,
// while a seat taken away since still is.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import * as apps from './apps.ts'
import { granting, owning } from './dispatch.ts'
import { storeName } from './directory.ts'
import type { ServingCopyDoor } from './directory-copy.ts'
import { ServingCopy, type ServingCopyState } from './serving-copy.ts'
import { ADA, ADA_OWNS, platform, seeded, visit } from './serving-probe.ts'

let ELI = 'e0000000-0000-4000-8000-0000000000e1'

// Production's serving copy, which is what gives the directory a revision.
let serving = (): ServingCopyDoor => {
  let saved: ServingCopyState | undefined
  let copy = new ServingCopy({
    persistence: { read: () => saved, write: (next) => void (saved = next) },
  })
  return {
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
}

let scene = async () => {
  let rpc = serving()
  let scenario = platform({
    SERVING_COPY: { idFromName: (name: string) => name, get: () => rpc },
  } as never)
  let { env } = scenario
  let { dir, space, app } = await seeded(env)
  let store = storeName(space, app)
  let secret = env.SESSION_SECRET!
  let write = (grant: string) =>
    apps.fetch(
      visit('/cookbook/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-yak-grant': grant },
        body: JSON.stringify({ entities: [{ doc: { title: 'Lemon cake' } }] }),
      }),
      env,
    )
  // A directory write that does not concern the app, which moves the revision.
  let moved = async () => {
    await dir.apply({
      entities: [{ entity: { eid: crypto.randomUUID() }, person: {} }],
    }, ADA_OWNS)
    let now = (await dir.app(space, 'cookbook'))!.policy
    assert(now > app.policy, `the revision stayed at ${now}`)
  }
  return { scenario, dir, space, app, store, secret, write, moved }
}

test('a worker grant still opens its store after an unrelated directory write', async () => {
  let { scenario, app, store, secret, write, moved } = await scene()
  await using _ = scenario
  let itself = await owning(secret, store, app)
  let visitor = await granting(
    secret,
    store,
    { person: ADA, role: 'owner' },
    app.policy,
  )
  await moved()
  for (let grant of [itself, visitor]) {
    let r = await write(grant)
    assertEquals(r.status, 200, await r.clone().text())
  }
})

test('a grant from an older revision stands only at the seat held now', async () => {
  let { scenario, app, store, secret, write, moved } = await scene()
  await using _ = scenario
  // Eli was an editor when the grant was read, and holds no seat now.
  let eli = await granting(
    secret,
    store,
    { person: ELI, role: 'editor' },
    app.policy,
  )
  await moved()
  let r = await write(eli)
  assertEquals(r.status >= 400, true, await r.clone().text())
})
