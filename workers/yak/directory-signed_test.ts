// Signed serving uses the real Apps/MCP doors and directory Store. Only the
// transport's stall, independent copy RPC and remote worker are fixtures.
import { clock, equal, ok, test } from '@yaks/testing'
import { fetch as appFetch } from './apps.ts'
import * as dirPart from './directory.ts'
import {
  EPOCH,
  type ServingCopyDoor,
  signedDirectory,
} from './directory-copy.ts'
import { GRANT } from './dispatch.ts'
import { PLATFORM_STORE } from './door.ts'
import { Store } from './graph.ts'
import { fetch as mcpFetch } from './mcp.ts'
import { KERNEL } from './meta.ts'
import {
  ServingCopy,
  type ServingCopyState,
  ServingCopyUnavailable,
} from './serving-copy.ts'
import { ADA_OWNS, as, platform, seeded, visit } from './serving-probe.ts'

let flush = async () => {
  for (let n = 0; n < 128; n++) await Promise.resolve()
}
let observing = <T>(work: Promise<T>) => {
  let value: T | undefined, error: unknown, settled = false
  void work.then((v) => {
    value = v
    settled = true
  }, (e) => {
    error = e
    settled = true
  })
  return {
    pending: () => !settled,
    answer: () => {
      if (error) throw error
      ok(settled, 'directory deadline left the signed request pending')
      return value!
    },
  }
}
let independent = () => {
  let saved: ServingCopyState | undefined
  let persistence = {
    read: () => saved,
    write: (next: ServingCopyState) => saved = next,
  }
  let core = new ServingCopy({ persistence })
  let publications: [number, string, string][] = []
  let loseFinish = false
  let door: ServingCopyDoor = {
    begin: () => Promise.resolve(core.begin()),
    finish: (n) => {
      if (loseFinish) return Promise.reject(Error('finish RPC lost'))
      return Promise.resolve(core.finish(n))
    },
    get: (key) => Promise.resolve().then(() => core.get(key)),
    put: (n, key, body) => Promise.resolve(core.put(n, key, body)),
    read: (key) => {
      // Production's RPC translates an unavailable core into null.
      try {
        return Promise.resolve(core.read(key))
      } catch (e) {
        if (!(e instanceof ServingCopyUnavailable)) throw e
        return Promise.resolve(null)
      }
    },
    valid: (n) => Promise.resolve(core.valid(n)),
    publish: (n, key, body) => {
      publications.push([n, key, body])
      return Promise.resolve(core.publish(n, key, body))
    },
  }
  return {
    door,
    publications,
    core: () => core,
    saved: () => saved!,
    loseFinish: () => loseFinish = true,
    restart: () => core = new ServingCopy({ persistence }),
  }
}
let query = (key: string) =>
  new Request(`https://directory/query?q=${encodeURIComponent(key)}`)
let proof = async (name: string, run: () => Promise<() => void>) => {
  let verify = await run()
  test(`signed directory: ${name}`, verify)
}

await proof(
  'direct answers publish before returning and pin one revision',
  async () => {
    let f = independent(), time = clock()
    let release!: () => void
    let publishing = new Promise<void>((r) => release = r)
    let publish = f.door.publish!
    f.door.publish = async (...args) => {
      await publishing
      return publish(...args)
    }
    let transport = signedDirectory(
      {
        fetch: () =>
          Promise.resolve(
            new Response('current', {
              headers: { [EPOCH]: String(f.core().revision) },
            }),
          ),
      },
      f.door,
      time,
    )
    let first = observing(transport.fetch(query('first')))
    await flush()
    let waited = first.pending()
    release()
    await flush()
    let body = await first.answer().text()
    let stored = await f.door.read!('first')
    f.core().finish(f.core().begin())
    let mixed = await transport.fetch(query('second'))
    return () => {
      ok(waited, 'a directory answer conferred standing before publication')
      equal(body, 'current')
      equal(stored, { revision: 0, body: 'current' })
      equal(f.publications.length, 2)
      equal(mixed.status, 503)
    }
  },
)

await proof(
  'stalled reads share 25ms and check current independent authority',
  async () => {
    let f = independent(), time = clock()
    f.core().publish(0, 'first', 'one')
    f.core().publish(0, 'second', 'two')
    let transport = signedDirectory(
      { fetch: () => new Promise(() => {}) },
      f.door,
      time,
    )
    let first = observing(transport.fetch(query('first')))
    await time.advance(24)
    await flush()
    let waited = first.pending()
    await time.advance(1)
    await flush()
    let one = await first.answer().text()
    let next = observing(transport.fetch(query('second')))
    await time.advance(0)
    await flush()
    let two = await next.answer().text()
    // A request-local pin is not an authority lease: revocation fences it too.
    f.core().begin()
    let revoked = observing(transport.fetch(query('first')))
    await time.advance(0)
    await flush()
    return () => {
      ok(waited)
      equal([one, two], ['one', 'two'])
      ok(revoked.pending(), 'fenced authority must await the directory')
    }
  },
)

await proof(
  'a fence between copy read and validity check refuses the old body',
  async () => {
    let f = independent(), time = clock()
    f.core().publish(0, 'page', 'private')
    let read = f.door.read!
    f.door.read = async (key) => {
      let value = await read(key)
      f.core().begin()
      return value
    }
    let transport = signedDirectory(
      { fetch: () => new Promise(() => {}) },
      f.door,
      time,
    )
    let answer = observing(transport.fetch(query('page')))
    await time.advance(25)
    await flush()
    return () => ok(answer.pending(), 'a fenced copy must not answer')
  },
)

await proof(
  'a fence held by a directory write is waited out, never refused',
  async () => {
    let f = independent(), time = clock()
    f.core().begin()
    let epochs = [0, 0, 1]
    let transport = signedDirectory(
      {
        fetch: () =>
          Promise.resolve(
            new Response('page', {
              headers: { [EPOCH]: String(epochs.shift()) },
            }),
          ),
      },
      f.door,
      time,
    )
    let answer = observing(transport.fetch(query('page')))
    await time.advance(0)
    await flush()
    let fenced = answer.pending()
    await time.advance(10)
    await flush()
    let still = answer.pending()
    await time.advance(20)
    await flush()
    return () => {
      ok(fenced && still, 'the write had not committed yet')
      equal(answer.answer().status, 200)
    }
  },
)

await proof(
  'a fence that never clears is refused after the bounded wait',
  async () => {
    let f = independent(), time = clock()
    f.core().begin()
    let transport = signedDirectory(
      {
        fetch: () =>
          Promise.resolve(
            new Response('page', { headers: { [EPOCH]: '0' } }),
          ),
      },
      f.door,
      time,
    )
    let answer = observing(transport.fetch(query('page')))
    for (let n = 0; n < 80; n++) {
      await time.advance(250)
      await flush()
    }
    return () => equal(answer.answer().status, 503)
  },
)

// Apps and MCP must install signedDirectory themselves. Their production timer
// uses the runtime globals; replace that boundary only while a stalled call is
// in flight, leaving the directory binding raw (never double-wrapped).
let deadline = async (run: () => Promise<Response>, allowPending = false) => {
  let time = clock()
  let set = globalThis.setTimeout, clear = globalThis.clearTimeout
  let next = 0, cancellations = new Map<number, () => void>()
  globalThis.setTimeout = ((callback: () => void, ms = 0) => {
    let id = ++next
    cancellations.set(id, time.after(ms, callback))
    return id
  }) as typeof set
  globalThis.clearTimeout = ((id: number) => {
    cancellations.get(id)?.()
    cancellations.delete(id)
  }) as typeof clear
  try {
    let work = observing(run())
    await flush()
    let pending = work.pending()
    // Crypto and Store continuations can register sequential directory reads.
    // No sleep/polling: only explicitly scheduled virtual deadlines are run.
    for (let n = 0; n < 32 && work.pending(); n++) {
      await time.advance(25)
      await flush()
      // WebCrypto completes on the runtime's task queue, not a promise turn.
      await new Promise<void>((done) => set(done, 0))
    }
    let unavailable = work.pending()
    if (allowPending && unavailable) {
      return {
        pending,
        unavailable,
        response: new Response('pending observation'),
      }
    }
    return { pending, unavailable, response: work.answer() }
  } finally {
    globalThis.setTimeout = set
    globalThis.clearTimeout = clear
  }
}

let fixture = async (kind: 'grant' | 'member') => {
  let copy = independent()
  let names: string[] = []
  let p = platform({
    SERVING_COPY: {
      idFromName: (name) => {
        names.push(name)
        return name
      },
      get: () => copy.door,
    },
  })
  let { dir, space, app } = await seeded(p.env, 'private')
  let person = 'b0000000-0000-4000-8000-0000000000bb'
  await dir.stamp({
    entities: [
      { entity: { eid: person }, person: {} },
      {
        entity: { eid: 'b0000000-0000-4000-8000-000000000001' },
        ...(kind == 'grant'
          ? { grant: { app: app.eid, person, access: 'viewer' as const } }
          : { member: { space: space.eid, person, role: 'viewer' as const } }),
      },
    ],
  }, ADA_OWNS)
  let cookie = await as(person)
  let calls: string[] = []
  let bearers: string[] = []
  ;(p.env as { DISPATCH?: unknown }).DISPATCH = {
    get: () => ({
      fetch: (req: Request) => {
        let role = req.headers.get('x-yak-role') ?? 'none'
        calls.push(role)
        let bearer = req.headers.get(GRANT)
        if (bearer) bearers.push(bearer)
        return Promise.resolve(
          role == 'none'
            ? new Response('no', { status: 404 })
            : new Response(`private worker: ${role}`),
        )
      },
    }),
  }
  let stalled = false
  p.env.DIRECTORY = {
    fetch: (req) => stalled ? new Promise(() => {}) : dirPart.fetch(req, p.env),
  }
  let page = () => appFetch(visit('/cookbook/', { headers: { cookie } }), p.env)
  let mcp = () =>
    mcpFetch(
      new Request('https://yaks.app/mcp', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'graph_query',
            arguments: { q: '.doc', app: 'cookbook', space: 'ada' },
          },
        }),
      }),
      p.env,
    )
  // Seed actual private store data, using its ordinary trusted Store door.
  let appStore = p.env.STORE.get(p.env.STORE.idFromName(app.store!))
  let seededRow = await appStore.fetch(
    new Request('https://store/apply', {
      method: 'POST',
      headers: { 'x-store': app.store!, ...KERNEL },
      body: JSON.stringify([{
        entity: { eid: 'b0000000-0000-4000-8000-000000000002' },
        doc: { title: 'signed-only-secret' },
      }]),
    }),
  )
  ok(seededRow.ok, await seededRow.text())
  return {
    ...p,
    copy,
    names,
    page,
    mcp,
    calls,
    bearers,
    bearer: (token: string) =>
      appFetch(
        visit('/cookbook/api/query?q=.doc', { headers: { [GRANT]: token } }),
        p.env,
      ),
    dir,
    space,
    app,
    stall: (yes = true) => stalled = yes,
    revoke: () =>
      dir.stamp({
        entities: [{
          entity: { eid: 'b0000000-0000-4000-8000-000000000001' },
          $delete: true,
        }],
      }, ADA_OWNS),
    restart: async () => {
      await p.settled()
      copy.restart()
      // Real directory Store restarted against the same durable SQLite state.
      let store = new Store(p.states.get(PLATFORM_STORE)!, p.env)
      let original = p.env.STORE
      p.env.STORE = {
        idFromName: (name) => original.idFromName(name),
        get: (id) =>
          String(id) == PLATFORM_STORE
            ? { fetch: (req) => store.fetch(req) }
            : original.get(id),
      }
    },
  }
}

for (let kind of ['grant', 'member'] as const) {
  await proof(
    `${kind} private worker and MCP survive stalls, not revocation or restart`,
    async () => {
      let f = await fixture(kind)
      let first = await f.page(), firstBody = await first.text()
      await (await f.mcp()).body?.cancel()
      // scheduleUse may write a directory activity row; finish it before warming
      // the two serving paths at their final revision.
      await f.settled()
      await (await f.page()).body?.cancel()
      let rpc = await f.mcp(), rpcBody = await rpc.text()
      await f.settled()
      f.stall()
      let page = await deadline(f.page), pageBody = await page.response.text()
      let mcp = await deadline(f.mcp), mcpBody = await mcp.response.text()
      f.stall(false)
      await f.revoke()
      await f.restart()
      f.stall()
      let before = f.calls.length
      let revokedPage = await deadline(f.page, true)
      let revokedPageBody = await revokedPage.response.text()
      let revokedMcp = await deadline(f.mcp, true)
      let revokedMcpBody = await revokedMcp.response.text()
      let dispatched = f.calls.slice(before)
      // Recover current declarations after restart, then stall again. Removed
      // permissions must not return merely because the new revision is available.
      f.stall(false)
      let currentPage = await f.page(), currentBody = await currentPage.text()
      let currentMcp = await f.mcp(), currentRpc = await currentMcp.text()
      await f.settled()
      f.stall()
      let again = await deadline(f.page),
        againBody = await again.response.text()
      let againMcp = await deadline(f.mcp),
        againRpc = await againMcp.response.text()
      await f[Symbol.asyncDispose]()
      return () => {
        equal(first.status, 200)
        ok(firstBody.includes('private worker: '))
        ok(!firstBody.includes('none'))
        equal(rpcBody.includes('signed-only-secret'), kind == 'member', rpcBody)
        ok(page.pending)
        equal([page.response.status, pageBody], [200, firstBody])
        equal(mcpBody.includes('signed-only-secret'), kind == 'member', mcpBody)
        ok(revokedPage.unavailable, 'fenced private page must await authority')
        ok(revokedMcp.unavailable, 'fenced MCP must await authority')
        ok(!revokedPageBody.includes('private worker:'))
        ok(!revokedMcpBody.includes('signed-only-secret'))
        equal(dispatched, [])
        ok(!currentBody.includes('private worker: viewer'))
        ok(!currentBody.includes('private worker: member'))
        ok(!currentRpc.includes('signed-only-secret'))
        ok(!againBody.includes('private worker: viewer'))
        ok(!againBody.includes('private worker: member'))
        ok(!againRpc.includes('signed-only-secret'))
        ok(f.names.length > 0)
        ok(
          f.names.every((name) => name == 'public'),
          'signed/public authority diverged',
        )
      }
    },
  )
}

await proof(
  'a committed read recovers lost finish without resurrecting an old grant',
  async () => {
    let f = await fixture('grant')
    await (await f.page()).body?.cancel()
    let before = f.copy.publications.slice()
    f.copy.loseFinish()
    let lost = ''
    try {
      await f.revoke()
    } catch (e) {
      lost = String(e)
    }
    let blocked = f.copy.saved().blocked
    await f.restart()
    let answer = await f.page(), body = await answer.text()
    let recovered = !f.copy.saved().blocked
    let late = await Promise.all(
      before.map(([n, key, data]) => f.copy.door.publish!(n, key, data)),
    )
    f.stall()
    let stalled = await deadline(f.page),
      stalledBody = await stalled.response.text()
    await f[Symbol.asyncDispose]()
    return () => {
      ok(lost.includes('finish RPC lost'), lost)
      ok(blocked)
      ok(recovered)
      ok(before.length > 0)
      ok(late.every((accepted) => !accepted))
      ok(!body.includes('private worker: viewer'))
      ok(!stalledBody.includes('private worker: viewer'))
    }
  },
)

for (let kind of ['grant', 'member'] as const) {
  await proof(
    `${kind} old worker bearer cannot restore revoked standing`,
    async () => {
      let f = await fixture(kind)
      await (await f.page()).body?.cancel()
      await f.settled()
      // The first page records activity under a new directory revision.
      // Capture a grant issued after that write, not the already fenced one.
      await (await f.page()).body?.cancel()
      await f.settled()
      let bearer = f.bearers.at(-1)!
      ok(bearer, 'worker was not handed its real signed visitor grant')
      let warm = await f.bearer(bearer), warmBody = await warm.text()
      await f.revoke()
      await f.restart()
      f.stall()
      let blocked = await deadline(() => f.bearer(bearer), true)
      let blockedBody = await blocked.response.text()
      f.stall(false)
      let current = await f.bearer(bearer), currentBody = await current.text()
      await f.settled()
      f.stall()
      let again = await deadline(() => f.bearer(bearer)),
        againBody = await again.response.text()
      await f[Symbol.asyncDispose]()
      return () => {
        equal(warm.status, 200)
        ok(warmBody.includes('signed-only-secret'), warmBody)
        ok(!blockedBody.includes('signed-only-secret'))
        ok(!currentBody.includes('signed-only-secret'), currentBody)
        ok(!againBody.includes('signed-only-secret'), againBody)
      }
    },
  )
}
