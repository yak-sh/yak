// Checkpoint decisions against a typed Directory seam. Its metadata still
// crosses the real signed transport and independent ServingCopy; SQL and Store
// integration live in directory-signed and graph tests, not this decision test.
import { clock, equal, ok, test, throws } from '@yaks/testing'
import { answered, renewing, running } from './agent.ts'
import {
  type App,
  appStore,
  type Directory,
  META,
  type Role,
  type Space,
} from './directory.ts'
import {
  EPOCH,
  type ServingCopyDoor,
  signedDirectory,
} from './directory-copy.ts'
import type { Env } from './env.ts'
import { ServingCopy, ServingCopyUnavailable } from './serving-copy.ts'
import { vouched } from './session.ts'
import { type Ctx, inApp, reacquire, renew, type Tool } from './tool.ts'

let PERSON = 'b0000000-0000-4000-8000-0000000000bb'
let SPACE = 'b0000000-0000-4000-8000-000000000001'
let APP = 'b0000000-0000-4000-8000-000000000002'
let SECRET = 'private unseen details must stay private'

let fixture = () => {
  let core = new ServingCopy({
    persistence: { read: () => undefined, write: () => {} },
  })
  let copy: ServingCopyDoor = {
    begin: () => Promise.resolve(core.begin()),
    finish: (n) => Promise.resolve(core.finish(n)),
    get: (key) => Promise.resolve(core.get(key)),
    put: (n, key, body) => Promise.resolve(core.put(n, key, body)),
    read: (key) => {
      try {
        return Promise.resolve(core.read(key))
      } catch (error) {
        if (!(error instanceof ServingCopyUnavailable)) throw error
        return Promise.resolve(null)
      }
    },
    valid: (n) => Promise.resolve(core.valid(n)),
    publish: (n, key, body) => Promise.resolve(core.publish(n, key, body)),
  }
  // Only fields this checkpoint reads are supplied by the seam.
  let space = { eid: SPACE, slug: 'ada', trashed: null } as Space
  let app = {
    eid: APP,
    space: SPACE,
    slug: 'cookbook',
    access: 'private',
    store: 'ada/cookbook.aaa111',
    trashed: null,
  } as App
  let state = {
    space,
    app: app as App | null,
    role: 'editor' as Role | null,
    admin: false,
  }
  let reads: string[] = [], forwarded: Request[] = []
  let reopen = (): Directory => {
    let transport = signedDirectory(
      {
        fetch: (request) => {
          let key = new URL(request.url).searchParams.get('q')!
          let value = key == 'space'
            ? state.space
            : key == 'app'
            ? state.app
            : key == 'admin'
            ? state.admin
            : state.role
          return Promise.resolve(
            Response.json(value, {
              headers: { [EPOCH]: String(core.revision) },
            }),
          )
        },
      },
      copy,
      clock(),
    )
    let read = async <T>(key: string): Promise<T> => {
      reads.push(key)
      let response = await transport.fetch(
        new Request(`https://directory/query?q=${key}`),
      )
      if (!response.ok) {
        throw Object.assign(Error('directory unavailable'), {
          status: response.status,
        })
      }
      return await response.json() as T
    }
    let dir = {
      at: async (eid: string) =>
        eid == SPACE ? await read<Space>('space') : null,
      appAt: async (eid: string) => {
        let now = await read<App | null>('app')
        return now?.eid == eid
          ? {
            space: await read<Space>('space'),
            app: { ...now, policy: core.revision },
          }
          : null
      },
      space: async (slug: string) =>
        slug == META.space
          ? await read<boolean>('admin')
            ? { ...space, eid: 'meta', slug: META.space }
            : null
          : (await read<Space>('space')).slug == slug
          ? state.space
          : null,
      app: async (_space: Space, slug: string) => {
        let now = await read<App | null>('app')
        return now?.slug == slug ? { ...now, policy: core.revision } : null
      },
      role: async (where: Space) =>
        where.eid == 'meta' ? 'owner' : await read<Role | null>('role'),
    }
    let checked: Pick<Directory, 'at' | 'appAt' | 'space' | 'app' | 'role'> =
      dir
    return checked as unknown as Directory
  }
  let env = {
    STORE: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (request: Request) => {
          forwarded.push(request)
          return Promise.resolve(
            Response.json([], {
              status:
                request.headers.get('x-yak-policy') == String(core.revision)
                  ? 200
                  : 503,
            }),
          )
        },
      }),
    },
  } as unknown as Env
  let ctx: Ctx = {
    env,
    dir: reopen(),
    reopen,
    person: PERSON,
    who: { person: PERSON, via: 'session', instrument: 'test-instrument' },
  }
  let change = (patch: Partial<typeof state>) => {
    let n = core.begin()
    Object.assign(state, patch)
    core.finish(n)
  }
  return {
    ctx,
    env,
    core,
    space,
    app,
    state,
    change,
    reads,
    forwarded,
  }
}

let changed = fixture()
await changed.ctx.dir.role(changed.space, PERSON)
changed.change({
  role: 'viewer',
  space: { ...changed.space, slug: 'renamed' },
  app: { ...changed.app, slug: 'recipes', access: 'public' },
})

test('tool scope: reacquire returns current app and standing together', async () => {
  let current = await reacquire(changed.ctx, changed.space, changed.app, false)
  equal(current.space.eid, SPACE)
  equal(current.space.slug, 'renamed')
  equal(current.app?.eid, APP)
  equal(current.app?.slug, 'recipes')
  equal(current.app?.access, 'public')
  equal(current.app?.policy, changed.core.revision)
  equal(current.who, { person: PERSON, role: 'viewer', via: 'test-instrument' })
})

let wire = fixture()
await wire.ctx.dir.role(wire.space, PERSON)
wire.change({ role: 'viewer', app: { ...wire.app, access: 'public' } })
test('tool scope: reacquired door forwards current policy and standing together', async () => {
  let current = await reacquire(wire.ctx, wire.space, wire.app, false)
  let response = await current.store!('/query?q=.doc', {}, vouched(current.who))
  equal(response.status, 200)
  await response.body?.cancel()
  equal(wire.forwarded.length, 1)
  let headers = wire.forwarded[0].headers
  equal(headers.get('x-yak-policy'), String(wire.core.revision))
  equal(headers.get('x-yak-role'), 'viewer')
  equal(headers.get('x-yak-access'), 'public')
  equal(headers.get('x-yak-app'), APP)
  equal(headers.get('x-yak-space'), SPACE)
})

let revoked = fixture()
await revoked.ctx.dir.role(revoked.space, PERSON)
revoked.change({ role: null })
test('tool scope: removed membership cannot reacquire a held private app', async () => {
  await throws(
    () => reacquire(revoked.ctx, revoked.space, revoked.app, false),
    'not a member',
  )
  equal(revoked.forwarded.length, 0)
})

let downgraded = fixture()
await downgraded.ctx.dir.role(downgraded.space, PERSON)
downgraded.change({ role: 'viewer' })
test('tool scope: renew discards old editor standing before a named write', async () => {
  renew(downgraded.ctx)
  await throws(
    () => inApp(downgraded.ctx, { space: 'ada', app: 'cookbook' }, true),
    'not a writer',
  )
  equal(downgraded.forwarded.length, 0)
})

let reused = fixture()
await reused.ctx.dir.role(reused.space, PERSON)
reused.change({ app: { ...reused.app, eid: 'replacement' } })
test('tool scope: a reused app slug cannot retarget a held identity', async () => {
  await throws(
    () => reacquire(reused.ctx, reused.space, reused.app),
    'no longer exists',
  )
  equal(reused.forwarded.length, 0)
})

let renamed = fixture()
await renamed.ctx.dir.role(renamed.space, PERSON)
renamed.change({ space: { ...renamed.space, slug: 'original-renamed' } })
renamed.ctx.who = {
  person: PERSON,
  via: 'session',
  space: 'ada',
  spaceEid: SPACE,
}
test('tool scope: narrowed session follows its space identity across slug reuse', async () => {
  let current = await reacquire(renamed.ctx, renamed.space, renamed.app, false)
  equal(current.space.eid, SPACE)
  equal(current.space.slug, 'original-renamed')
  equal(current.app?.space, SPACE)
})

let administrative = fixture()
await administrative.ctx.dir.role(administrative.space, PERSON)
administrative.change({ role: null, admin: true })
test('tool scope: administrative standing and instrument survive reacquire', async () => {
  let current = await reacquire(
    administrative.ctx,
    administrative.space,
    administrative.app,
    true,
    true,
  )
  equal(current.who, {
    person: PERSON,
    role: 'owner',
    administrative: true,
    via: 'test-instrument',
  })
})

let selfRevoked = fixture()
let trackerReads = 0, effects = 0
selfRevoked.env.TRACKER = {
  fetch: () => {
    trackerReads++
    return Promise.resolve(Response.json([{ error: { message: SECRET } }]))
  },
}
let revoke: Tool = {
  name: 'test_self_revoke',
  title: 'Self revoke',
  description: 'Remove the caller from the space.',
  input: { type: 'object', properties: {} },
  run: () => {
    effects++
    selfRevoked.change({ role: null })
    return Promise.resolve({
      text: 'removed',
      space: selfRevoked.space,
      value: { removed: true },
    })
  },
}
test('tool scope: self revoke executes once and returns no old unseen details', async () => {
  let result = await running(selfRevoked.ctx, revoke)({})
  equal(effects, 1)
  equal(trackerReads, 0)
  equal(result[0].content, { body: 'removed' })
  equal(result[0].output, { value: { removed: true } })
  ok(!JSON.stringify(result).includes(SECRET))
})

let readOnly = fixture()
readOnly.env.TRACKER = {
  fetch: () => {
    throw Error('a read must not serve unseen details')
  },
}
test('tool scope: read only answers do not consume unseen details', async () => {
  let result = await answered(
    readOnly.ctx,
    { text: 'read', space: readOnly.space },
    undefined,
    true,
  )
  equal(result[0].content, { body: 'read' })
  equal(readOnly.reads, [])
})

let heldDoor = fixture()
let oldDoor = appStore(heldDoor.env.STORE, heldDoor.space, {
  ...heldDoor.app,
  policy: 0,
}, heldDoor.env)
heldDoor.change({ role: null })
test('tool scope: an old held door is still invalid after revocation', async () => {
  let response = await oldDoor(
    '/query?q=.doc',
    {},
    vouched({ person: PERSON, role: 'editor' }),
  )
  equal(response.status, 503)
  await response.body?.cancel()
  equal(heldDoor.forwarded[0].headers.get('x-yak-policy'), '0')
})

let confined = fixture()
confined.ctx.who = {
  person: PERSON,
  via: 'session',
  space: 'other',
  spaceEid: 'another-space',
}
test('tool scope: narrowed session cannot reacquire a foreign held identity', async () => {
  await throws(() =>
    reacquire(confined.ctx, confined.space, confined.app, false)
  )
  equal(confined.forwarded.length, 0)
})

test('tool scope: a call a directory write superseded is asked again from a fresh reach', async () => {
  let f = fixture(), views = 0
  let reach = [{ n: 0 }] as never[]
  let again = () => Promise.resolve([{ n: ++views }] as never[])
  let fresh = renewing(f.ctx, reach, again)
  let seen: unknown[] = []
  let out = await fresh(() => {
    seen.push(structuredClone(reach))
    if (seen.length == 1) {
      throw Object.assign(Error('stale'), { status: 503 })
    }
    return Promise.resolve('done')
  })
  equal(out, 'done')
  equal(seen, [[{ n: 0 }], [{ n: 1 }]])
  let partial = () =>
    fresh(() =>
      Promise.reject(
        Object.assign(Error('half'), { status: 503, partial: true }),
      )
    )
  await throws(partial)
  let refused = () =>
    fresh(() => Promise.reject(Object.assign(Error('no'), { status: 403 })))
  await throws(refused)
  equal(views, 1)
})
