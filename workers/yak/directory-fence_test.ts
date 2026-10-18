// Real directory Store mutations, with a separate durable serving-copy core
// behind an asynchronous RPC-shaped door. No Store state is shared with it.
import { select, table } from '@yaks/sql'
import { equal, ok, test } from '@yaks/testing'
import { doorOf, PLATFORM_STORE } from './door.ts'
import { EPOCH, type ServingCopyDoor } from './directory-copy.ts'
import type { Env } from './env.ts'
import { Store } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'
import type { Rehearsal, Rule } from './mover.ts'
import {
  ServingCopy,
  type ServingCopyState,
  ServingCopyUnavailable,
} from './serving-copy.ts'
import { db, slot, state } from './testing.ts'

let fixture = async (rules: Rule[] = []) => {
  let saved: ServingCopyState | undefined
  let persistence = {
    read: () => saved,
    write: (next: ServingCopyState) => {
      saved = next
    },
  }
  let core = new ServingCopy({ persistence })
  let begins: number[] = [], finishes: number[] = []
  let beforeBegin = () => Promise.resolve()
  let offered = (revision: number) => revision
  let beforeFinish = (_revision: number) => Promise.resolve()
  let rpc: ServingCopyDoor = {
    begin: async () => {
      let revision = core.begin()
      begins.push(revision)
      await beforeBegin()
      return offered(revision)
    },
    revision: () => Promise.resolve(core.revision),
    finish: async (revision) => {
      await beforeFinish(revision)
      finishes.push(revision)
      return core.finish(revision)
    },
    settle: (revision, committed) =>
      Promise.resolve(core.settle(revision, committed)),
    put: (...args) => Promise.resolve().then(() => core.put(...args)),
    get: (key) => Promise.resolve().then(() => core.get(key)),
  }
  let ctx = state(PLATFORM_STORE)
  let store: Store
  let env = {
    STORE_TRACING: 'off',
    SERVING_COPY: { idFromName: (name: string) => name, get: () => rpc },
    STORE: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: (req: Request) => store.fetch(req) }),
    },
  } as Partial<Env>
  store = new Store(ctx, env, rules)
  let at = metaOf(doorOf((req) => store.fetch(req), PLATFORM_STORE))
  let read = (mend = false) =>
    store.fetch(
      new Request(`http://store/query?q=.app${mend ? '&mend=1' : ''}`, {
        headers: { 'x-store': PLATFORM_STORE, [EPOCH]: '1', ...KERNEL },
      }),
    )
  await at.apply([
    { entity: { eid: 'space' }, space: { slug: 'fence' } },
    {
      entity: { eid: 'app' },
      app: {
        space: 'space',
        slug: 'page',
        access: 'public',
        store: 'fence/page',
        version: 1,
      },
      doc: { title: 'Before' },
    },
  ], KERNEL)
  let answer = await read()
  let initial = Number(answer.headers.get(EPOCH))
  let body = await answer.text()
  ok(core.put(initial, '.app', body))
  begins.length = finishes.length = 0
  return {
    at,
    committed: () => ({
      access: db(ctx).query(select({ from: table('app') }))[0].access,
      epoch: slot(ctx, 'directory-revision'),
    }),
    read,
    initial,
    body,
    begins,
    finishes,
    ask: (path: string, body?: unknown) =>
      store.fetch(
        new Request(`http://store${path}`, {
          method: 'POST',
          headers: { 'x-store': PLATFORM_STORE, ...KERNEL },
          body: body == null ? undefined : JSON.stringify(body),
        }),
      ),
    move: () => store.alarm(),
    offer: (fn: typeof offered) => {
      offered = fn
    },
    core: () => core,
    saved: () => saved!,
    onBegin: (fn: typeof beforeBegin) => {
      beforeBegin = fn
    },
    onFinish: (fn: typeof beforeFinish) => {
      beforeFinish = fn
    },
    restart: () => {
      core = new ServingCopy({ persistence })
      store = new Store(ctx, env, rules)
    },
  }
}

// Store/SQLite integration costs several milliseconds even after warm-up.
// Collect observable results outside individual assertion budgets, as other
// Store proof fixtures do. No alternative implementation of g.apply is used.
let proof = async (name: string, run: () => Promise<() => void>) => {
  let verify = await run()
  test(`directory fence: ${name}`, verify)
}
let unavailable = (f: Awaited<ReturnType<typeof fixture>>) => {
  try {
    f.core().get('.app')
    return false
  } catch (error) {
    if (!(error instanceof ServingCopyUnavailable)) throw error
    return true
  }
}
let refusal = async (run: () => Promise<unknown>) => {
  try {
    await run()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
let patch = [{ entity: { eid: 'app' }, app: { access: 'private' } }]

await proof(
  'begin precedes mutation and finish sees its committed epoch',
  async () => {
    let f = await fixture()
    let seen: unknown[] = []
    f.onBegin(() => {
      // Inspect persisted rows, not a recursive Store request: the writer holds
      // the Store's request gate while it waits for this independent RPC.
      seen.push(['begin', unavailable(f), f.committed()])
      return Promise.resolve()
    })
    f.onFinish((revision) => {
      seen.push(['finish', unavailable(f), f.committed(), revision])
      return Promise.resolve()
    })
    await f.at.apply(patch, KERNEL)
    let answer = await f.read()
    let epoch = answer.headers.get(EPOCH)
    await answer.body?.cancel()
    return () => {
      equal(seen, [
        ['begin', true, { access: 'public', epoch: String(f.initial) }],
        [
          'finish',
          true,
          { access: 'private', epoch: String(f.initial + 1) },
          f.initial + 1,
        ],
      ])
      equal(epoch, String(f.initial + 1))
      equal(f.begins, [f.initial + 1])
      equal(f.finishes, f.begins)
      equal(f.saved().blocked, false)
    }
  },
)

await proof(
  'switching private clears an already served public copy',
  async () => {
    let f = await fixture()
    let before = f.core().get('.app')
    await f.at.apply(patch, KERNEL)
    let blocked = unavailable(f)
    let rows = await f.at.query('.entity.eid=app&.app')
    return () => {
      equal(before, f.body)
      equal(blocked, true)
      equal(f.saved().answers, [])
      equal((rows[0].app as { access: string }).access, 'private')
    }
  },
)

await proof('deployment selection also clears the copy', async () => {
  let f = await fixture()
  await f.at.apply([
    {
      entity: { eid: 'release' },
      deploy: { app: 'app', version: 2, files: '{}' },
    },
    { entity: { eid: 'app' }, app: { version: 2 } },
  ], KERNEL)
  let cleared = unavailable(f)
  let rows = await f.at.query('.entity.eid=app&.app')
  // Deploy effects may write again after this scenario. Keep the mutation's
  // observed finish, not a live array those later fenced writes can extend.
  let finished = [...f.finishes]
  return () => {
    equal(cleared, true)
    equal(finished[0], f.initial + 1)
    ok(finished.every((revision, i) => revision === f.initial + 1 + i))
    equal((rows[0].app as { version: number }).version, 2)
  }
})

await proof(
  'a refused batch settles its fence and serving resumes at the committed revision',
  async () => {
    let f = await fixture()
    let error = await refusal(() =>
      f.at.apply([
        ...patch,
        { entity: { eid: 'bad' }, undeclared_fence_proof: {} },
      ], KERNEL)
    )
    let finished = [...f.finishes], persisted = f.saved().blocked
    let blocked = !f.core().valid(f.initial)
    f.restart()
    let restarted = !f.core().valid(f.initial)
    let rows = await f.at.query('.entity.eid=app&.app')
    let answer = await f.read()
    let epoch = Number(answer.headers.get(EPOCH))
    let filled = f.core().put(epoch, '.app', await answer.text())
    await f.at.apply(
      [{ entity: { eid: 'app' }, doc: { title: 'Recovered' } }],
      KERNEL,
    )
    return () => {
      ok(error.includes('unknown component'), error)
      equal(finished, [])
      equal([persisted, blocked, restarted], [false, false, false])
      equal(epoch, f.initial)
      equal(filled, true)
      equal((rows[0].app as { access: string }).access, 'public')
      equal(f.committed().epoch, String(f.initial + 1))
    }
  },
)

await proof(
  'commit refuses an RPC epoch older than the last committed epoch',
  async () => {
    let f = await fixture()
    f.offer(() => f.initial - 1)
    let error = await refusal(() => f.at.apply(patch, KERNEL))
    let rows = await f.at.query('.entity.eid=app&.app')
    let blocked = unavailable(f)
    return () => {
      ok(error.includes('Directory write lost its serving fence'), error)
      equal((rows[0].app as { access: string }).access, 'public')
      equal(f.finishes, [])
      equal(blocked, true)
    }
  },
)

await proof(
  'a write whose fence resumes after a newer commit lands under a fresh one',
  async () => {
    let f = await fixture()
    let release!: () => void
    let held = new Promise<void>((r) => release = r)
    f.onBegin(() => {
      f.onBegin(() => Promise.resolve())
      return held
    })
    f.onFinish(() => Promise.resolve(release()))
    let used = (eid: string) => f.ask('/used', { eid })
    let first = used('app'), second = used('space')
    let statuses = [(await first).status, (await second).status]
    let rows = await f.at.query('.used')
    return () => {
      equal(statuses, [200, 200])
      equal(rows.map((r) => r.entity.eid).sort(), ['app', 'space'])
      ok(f.begins.length > f.finishes.length, 'a fence was lost and retaken')
      equal(f.committed().epoch, String(f.saved().revision))
      equal(f.saved().blocked, false)
    }
  },
)

await proof(
  'a late pre-write query cannot fill the newly opened copy',
  async () => {
    let f = await fixture()
    // Delay consumption of a real Store read until after mutation. Its body and
    // epoch must travel together, even when the edge fill is late.
    let answer = await f.read()
    await f.at.apply(patch, KERNEL)
    let oldEpoch = answer.headers.get(EPOCH)
    let oldFill = f.core().put(Number(oldEpoch), '.app', await answer.text())
    let blocked = unavailable(f)
    let current = await f.read()
    let epoch = current.headers.get(EPOCH)
    let filled = f.core().put(Number(epoch), '.app', await current.text())
    return () => {
      equal(oldEpoch, String(f.initial))
      equal(oldFill, false)
      equal(blocked, true)
      equal(epoch, String(f.initial + 1))
      equal(filled, true)
    }
  },
)

await proof(
  'a write whose begin is lost lowers its fence as it fails',
  async () => {
    let f = await fixture()
    f.onBegin(() => Promise.reject(new Error('begin answer lost')))
    let error = await refusal(() => f.at.apply(patch, KERNEL))
    let blocked = unavailable(f), valid = f.core().valid(f.initial)
    return () => {
      ok(error.includes('begin answer lost'), error)
      equal([blocked, valid, f.saved().blocked], [true, true, false])
    }
  },
)

await proof(
  'a fence whose write is gone is lowered by a read that finds it',
  async () => {
    let f = await fixture()
    f.core().begin()
    let held = f.core().valid(f.initial)
    await (await f.read()).body?.cancel()
    let still = f.saved().blocked
    let mended = await f.read(true)
    let epoch = Number(mended.headers.get(EPOCH))
    await mended.body?.cancel()
    return () => {
      equal([held, still], [false, true])
      equal(f.saved().blocked, false)
      ok(f.core().valid(epoch))
      equal(epoch, f.initial)
    }
  },
)

let rule: Rule = {
  mark: 'yak/store/directory-fence-proof/1',
  stores: [PLATFORM_STORE],
  find: '.doc.title=Before&*',
  move: (row) => [{ entity: row.entity, doc: { title: 'Moved' } }],
}
await proof(
  'mover rehearsal is synchronous, rollback-only and never opens a fence',
  async () => {
    let f = await fixture([rule])
    let answer = await f.ask('/move?rehearse=1')
    let result = await answer.json() as { rules: Rehearsal[] }
    let rows = await f.at.query('.entity.eid=app&.doc')
    return () => {
      equal(answer.status, 200)
      equal(result.rules, [{ mark: rule.mark, rows: 1, moved: 1, batches: 1 }])
      equal(f.begins, [])
      equal(f.finishes, [])
      equal(f.core().get('.app'), f.body)
      equal((rows[0].doc as { title: string }).title, 'Before')
      equal(f.committed().epoch, String(f.initial))
    }
  },
)

await proof(
  'a live synchronous move commits under one matching fence',
  async () => {
    let f = await fixture([{ ...rule, live: 'all' }])
    await f.move()
    let rows = await f.at.query('.entity.eid=app&.doc')
    let cleared = unavailable(f)
    let epoch = f.committed().epoch
    return () => {
      equal((rows[0].doc as { title: string }).title, 'Moved')
      equal(f.begins, [f.initial + 1])
      equal(f.finishes, f.begins)
      equal(epoch, String(f.initial + 1))
      equal(cleared, true)
      equal(f.saved().blocked, false)
    }
  },
)

await proof('a failed begin RPC prevents the directory mutation', async () => {
  let f = await fixture()
  f.onBegin(() => Promise.reject(new Error('begin RPC lost')))
  let error = await refusal(() => f.at.apply(patch, KERNEL))
  let rows = await f.at.query('.entity.eid=app&.app')
  let blocked = unavailable(f)
  return () => {
    ok(error.includes('begin RPC lost'), error)
    equal((rows[0].app as { access: string }).access, 'public')
    equal(f.committed().epoch, String(f.initial))
    equal(f.finishes, [])
    equal(blocked, true)
  }
})

await proof(
  'a lost finish leaves the committed mutation closed across restart',
  async () => {
    let f = await fixture()
    f.onFinish(() => Promise.reject(new Error('finish RPC lost')))
    let error = await refusal(() => f.at.apply(patch, KERNEL))
    let committed = f.committed()
    f.restart()
    let rows = await f.at.query('.entity.eid=app&.app')
    let blocked = unavailable(f)
    return () => {
      ok(error.includes('finish RPC lost'), error)
      equal(committed, { access: 'private', epoch: String(f.initial + 1) })
      equal((rows[0].app as { access: string }).access, 'private')
      equal(f.finishes, [])
      equal(blocked, true)
      equal(f.core().put(f.initial + 1, '.app', f.body), false)
    }
  },
)
