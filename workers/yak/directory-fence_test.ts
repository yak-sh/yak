// Real directory Store mutations, with a separate durable serving-copy core
// behind an asynchronous RPC-shaped door. No Store state is shared with it.
import { backoff } from '@yaks/durable-object'
import { enqueue } from '@yaks/effects'
import { type Bundle, graph } from '@yaks/graph'
import { storage as sqliteStorage } from '@yaks/sqlite'
import { select, table } from '@yaks/sql'
import { type Clock, clock, equal, ok, test } from '@yaks/testing'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { doorOf, IDEMPOTENCY } from './door.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Rehearsal } from '@yaks/platform/mover'
import { EPOCH, type ServingCopyDoor } from './directory-copy.ts'
import type { Env } from './env.ts'
import { shapeOf, Store } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'
import type { Rule } from './mover.ts'
import {
  ServingCopy,
  type ServingCopyState,
  ServingCopyUnavailable,
} from './serving-copy.ts'
import { db, slot, state } from './testing.ts'
import { mint, spend } from './signin.ts'
import { metaKeywords } from './vocab.ts'

let fixture = async (rules: Rule[] = [], time?: Clock) => {
  let saved: ServingCopyState | undefined
  let persistence = {
    read: () => saved,
    write: (next: ServingCopyState) => {
      saved = next
    },
  }
  let core = new ServingCopy({ persistence })
  let begins: number[] = [], finishes: number[] = []
  // Each fence raised and each transaction opened, in order.
  let trail: string[] = []
  let beforeBegin = () => Promise.resolve()
  let offered = (revision: number) => revision
  let beforeFinish = (_revision: number) => Promise.resolve()
  let beforeRevision = () => Promise.resolve()
  let rpc: ServingCopyDoor = {
    begin: async (floor) => {
      let revision = core.begin(floor)
      begins.push(revision)
      trail.push('begin')
      await beforeBegin()
      return offered(revision)
    },
    revision: async () => {
      await beforeRevision()
      return core.revision
    },
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
  let open = ctx.storage.transactionSync.bind(ctx.storage), depth = 0
  ctx.storage.transactionSync = <T>(body: () => T) => {
    if (!depth) trail.push('tx')
    depth++
    try {
      return open(body)
    } finally {
      depth--
    }
  }
  let store: Store
  let env = {
    CLOCK: time,
    STORE_TRACING: 'off',
    SERVING_COPY: { idFromName: (name: string) => name, get: () => rpc },
    STORE: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: (req: Request) => store.fetch(req) }),
    },
  } as Partial<Env>
  store = new Store(ctx, env, [])
  let at = metaOf(doorOf((req) => store.fetch(req), PLATFORM_STORE))
  let read = (mend = false) =>
    store.fetch(
      new Request(`http://store/query?q=.app${mend ? '&mend=1' : ''}`, {
        headers: { 'x-store': PLATFORM_STORE, [EPOCH]: '1', ...KERNEL },
      }),
    )
  await at.apply([
    { entity: { eid: 'space' }, space: { slug: 'fence', store: 'fence' } },
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
  // The app made owes its effects (reward.ts `reward_referral`), and each
  // settles with a directory write that fences: wait them out, so a proof's
  // fences are its own however long they take. On a clock of its own, the
  // pool's pauses between passes are kept on it, so it is moved meanwhile.
  let settle = async () => {
    for (;;) {
      let alarm = await ctx.storage.getAlarm()
      if (alarm != null && alarm <= (time?.now() ?? Date.now())) {
        await ctx.storage.deleteAlarm()
        await store.alarm()
      } else if (!ctx.pending.size) return
      await (time?.advance(0) ?? Promise.allSettled([...ctx.pending]))
    }
  }
  await ctx.storage.deleteAlarm()
  await store.alarm()
  await settle()
  if (rules.length) store = new Store(ctx, env, rules)
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
    trail,
    settle,
    ask: (path: string, body?: unknown) =>
      store.fetch(
        new Request(`http://store${path}`, {
          method: 'POST',
          headers: { 'x-store': PLATFORM_STORE, ...KERNEL },
          body: body == null ? undefined : JSON.stringify(body),
        }),
      ),
    // A write as the kernel's door sends one: keyed, so it commits live
    // rather than through the write log (door.ts `storeOf`).
    live: (bundles: unknown) =>
      store.fetch(
        new Request('http://store/apply', {
          method: 'POST',
          headers: {
            'x-store': PLATFORM_STORE,
            [IDEMPOTENCY]: crypto.randomUUID(),
            ...KERNEL,
          },
          body: JSON.stringify(bundles),
        }),
      ),
    move: () => store.alarm(),
    source: (source: VocabDoc, rows: Bundle[]) => {
      let vocab = loadVocab([
        ...shapeOf(PLATFORM_STORE, null).vocab.docs,
        source,
      ], metaKeywords)
      return graph({ vocab, storage: sqliteStorage(db(ctx), vocab) })
        .apply(rows, { trusted: true, stamp: false })
    },
    // The fenced graph itself, for writes no door serializes.
    graph: async () => (await store.door).graph,
    offer: (fn: typeof offered) => {
      offered = fn
    },
    core: () => core,
    // The copy's fence as it holds it, in memory.
    fence: () => ({
      revision: core.revision,
      blocked: !core.valid(core.revision),
    }),
    onBegin: (fn: typeof beforeBegin) => {
      beforeBegin = fn
    },
    onFinish: (fn: typeof beforeFinish) => {
      beforeFinish = fn
    },
    onRevision: (fn: typeof beforeRevision) => {
      beforeRevision = fn
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

// Each hour's first use of every app writes a receipt (used.ts); a fence for
// each would hold back every serving check on the platform (T-131212).
await proof(
  'a receipt leaves serving checks standing, and a seat still fences them',
  async () => {
    let f = await fixture()
    let answers = [
      (await f.ask('/used', { eid: 'app' })).status,
      (await f.ask('/translated', { eid: 'app', spelling: '.drill!' })).status,
    ]
    let receipts = {
      fences: f.begins.length,
      current: f.core().valid(f.initial),
    }
    await f.at.apply([{ entity: { eid: 'ada' }, person: {} }, {
      entity: { eid: 'seat' },
      member: { space: 'space', person: 'ada', role: 'viewer' },
    }], KERNEL)
    let seat = { fences: f.begins.length, current: f.core().valid(f.initial) }
    return () =>
      equal({ answers, receipts, seat }, {
        answers: [200, 200],
        receipts: { fences: 0, current: true },
        seat: { fences: 1, current: false },
      })
  },
)

// An effect's run deletes itself once it finishes; no serving check reads it
// (T-147454). Deleting what one does read still fences.
await proof(
  "an effect's cleanup leaves serving checks standing, and deleting a seat still fences them",
  async () => {
    let f = await fixture()
    let g = await f.graph()
    await enqueue(g, 'reward_referral', 'app')
    let owed = f.begins.length
    await f.settle()
    let run = {
      fences: f.begins.length - owed,
      left: (await g.read('.effect')).length,
    }
    await f.at.apply([{ entity: { eid: 'ada' }, person: {} }, {
      entity: { eid: 'seat' },
      member: { space: 'space', person: 'ada', role: 'viewer' },
    }], KERNEL)
    let seated = f.begins.length
    await f.at.apply([{ entity: { eid: 'seat' }, $delete: true }], KERNEL)
    let seat = { fences: f.begins.length - seated }
    return () =>
      equal({ run, seat }, {
        run: { fences: 0, left: 0 },
        seat: { fences: 1 },
      })
  },
)

// A sign-in code's rows are read only by spending and asking, from the
// directory itself, never from the copy (T-148651): asking, guessing and the
// burial a right guess writes hold back no serving check. The person a right
// guess signs in is decided in the same write (T-148969), and fences only
// when it is minted or named, beside the space minted them then (T-151251):
// someone the directory already holds, named, signs in under none, and the
// space they land on is said as it stands, which writes nothing
// (facets/signin-graph.ts `landing`). A guess that fences
// raises its fence before it opens any transaction: one rolled back would
// hold the fence's ask until storage confirmed it (graph.ts `foreseeing`).
await proof(
  "a sign-in code's whole life leaves serving checks standing",
  async () => {
    let f = await fixture()
    let at = 'fence@example.com'
    let signIn = async () => {
      let code = (await mint(f.at, 'secret', at))!
      let wrong = code == '000000' ? '000001' : '000000'
      let before = f.begins.length
      let missed = await spend(f.at, 'secret', at, wrong)
      let opened = await spend(f.at, 'secret', at, code)
      let spent = [missed, opened?.person]
      return { spent, own: opened?.own?.slug, fences: f.begins.length - before }
    }
    let first = await signIn()
    let again = await signIn()
    let trail = async (code: string) => {
      let from = f.trail.length
      await spend(f.at, 'secret', 'trail@example.com', code)
      return f.trail.slice(from)
    }
    let code = (await mint(f.at, 'secret', 'trail@example.com'))!
    let trails = [
      await trail(code == '000000' ? '000001' : '000000'),
      await trail(code),
    ]
    let [person] = await f.at.query(`.person&.email.address=${at}&?doc`)
    let left = (await f.at.query(`.signin.email=${at}`)).length
    let [seat] = await f.at.query(`.member.person=${person?.entity.eid}`)
    let [home] = await f.at.query(
      `.entity.eid=${(seat?.member as { space?: string })?.space}`,
    )
    let slug = (home?.space as { slug?: string })?.slug
    return () =>
      equal({
        first,
        again,
        left,
        title: (person?.doc as { title?: string })?.title,
        trails,
      }, {
        first: { spent: [null, person?.entity.eid], own: slug, fences: 1 },
        again: { spent: [null, person?.entity.eid], own: slug, fences: 0 },
        left: 0,
        title: 'fence',
        trails: [['tx'], ['begin', 'tx']],
      })
  },
)

// A person's own space is decided inside the write that mints it
// (facets/directory-graph.ts), so the batch carries none of the space and seat
// a copied line names, and it fences as they would.
await proof("minting a person's own space fences serving checks", async () => {
  let f = await fixture()
  await f.at.apply([{
    entity: { eid: 'dana' },
    person: {},
    email: { address: 'dana@example.com' },
  }], KERNEL)
  let before = f.begins.length
  await f.at.apply(
    [{ entity: { eid: '$own' }, $own: { person: 'dana' } }],
    KERNEL,
  )
  let seats = (await f.at.query('.member.person=dana')).length
  return () =>
    equal({ fences: f.begins.length - before, seats }, { fences: 1, seats: 1 })
})

// A model call's hold on its space's budget is refused past the budget in the
// directory's own transaction, so it holds back no serving check; a plain
// spend still fences (T-141144).
await proof(
  'a budget hold leaves serving checks standing, and a plain spend still fences them',
  async () => {
    let f = await fixture()
    let month = new Date().toISOString().slice(0, 7)
    await f.at.apply([{
      entity: { eid: 'hold' },
      model_reservation: {
        space: 'space',
        month,
        dollars: 0.01,
        what: 'models',
      },
    }, {
      entity: { eid: 'space' },
      spend: { month, models: 0.01, held: true },
    }], KERNEL)
    let [space] = await f.at.query('.entity.eid=space')
    let held = {
      fences: f.begins.length,
      current: f.core().valid(f.initial),
      models: (space.meter as { models?: number }).models,
      // Read for the budget, never given to a space that has none.
      kept: ['plan', 'comped', 'budget', 'starter'].filter((c) => c in space),
    }
    await f.at.apply([{
      entity: { eid: 'space' },
      spend: { month, emails: 1 },
    }], KERNEL)
    let plain = { fences: f.begins.length, current: f.core().valid(f.initial) }
    return () =>
      equal({ held, plain }, {
        held: { fences: 0, current: true, models: 0.01, kept: [] },
        plain: { fences: 1, current: false },
      })
  },
)

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
      equal(f.fence().blocked, false)
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
    let finished = [...f.finishes], fenced = f.fence().blocked
    let blocked = !f.core().valid(f.initial)
    // A restarted copy has lost which fences it granted: it serves again
    // once a read asks the directory to mend it.
    f.restart()
    let restarted = !f.core().valid(f.initial)
    let rows = await f.at.query('.entity.eid=app&.app')
    let answer = await f.read(true)
    let epoch = Number(answer.headers.get(EPOCH))
    let filled = f.core().put(epoch, '.app', await answer.text())
    await f.at.apply(
      [{ entity: { eid: 'app' }, doc: { title: 'Recovered' } }],
      KERNEL,
    )
    return () => {
      ok(error.includes('unknown component'), error)
      equal(finished, [])
      equal([fenced, blocked, restarted], [false, false, true])
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

// An instance the runtime has replaced can still reach the copy, and mends it
// from what that instance last knew (T-134025): the copy drops behind what the
// directory has committed, and its next fences would all be older.
await proof(
  'a copy behind the directory costs a write no race',
  async () => {
    let f = await fixture()
    for (let title of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
      await f.at.apply([{ entity: { eid: 'app' }, doc: { title } }], KERNEL)
    }
    let ahead = Number(f.committed().epoch)
    f.core().settle(f.core().revision, f.initial)
    f.begins.length = f.finishes.length = 0
    let error = await refusal(() => f.at.apply(patch, KERNEL))
    let rows = await f.at.query('.entity.eid=app&.app')
    return () => {
      equal(error, '')
      equal(f.begins, [ahead + 1])
      equal(f.finishes, [ahead + 1])
      equal(f.committed().epoch, String(ahead + 1))
      equal((rows[0].app as { access: string }).access, 'private')
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
    let g = await f.graph()
    let titled = (eid: string, title: string) =>
      g.apply([{ entity: { eid }, doc: { title } }])
    await Promise.all([titled('app', 'One'), titled('space', 'Two')])
    let rows = await f.at.query('.doc')
    return () => {
      equal(
        rows.map((r) => [r.entity.eid, (r.doc as { title: string }).title])
          .sort(),
        [['app', 'One'], ['space', 'Two']],
      )
      ok(f.begins.length > f.finishes.length, 'a fence was lost and retaken')
      equal(f.committed().epoch, String(f.fence().revision))
      equal(f.fence().blocked, false)
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
      equal([blocked, valid, f.fence().blocked], [true, true, false])
    }
  },
)

// A commit hook after the fence's refuses the write, and a read lands while
// the write's mend is away: it is answered the committed revision, never the
// one the rollback took back, and a later read is served (T-88868992).
await proof(
  'a read during a refused write is answered the committed revision',
  async () => {
    let f = await fixture()
    let refuse = true
    ;(await f.graph()).use({
      name: 'test/refuse-at-commit',
      hooks: {
        commit: (b) => {
          if (refuse) throw new Error('refused at commit')
          return b
        },
      },
    })
    let during: number | undefined
    f.onRevision(async () => {
      f.onRevision(() => Promise.resolve())
      let answer = await f.read()
      during = Number(answer.headers.get(EPOCH))
      f.core().publish(during, '.app', await answer.text())
    })
    let answer = await f.live(patch)
    let error = (await answer.json()).message
    refuse = false
    let mended = await f.read(true)
    let epoch = Number(mended.headers.get(EPOCH))
    await mended.body?.cancel()
    return () => {
      ok(error.startsWith('refused at commit'), error)
      equal([during, epoch], [f.initial, f.initial])
      ok(f.core().valid(epoch))
    }
  },
)

// A copy left open at a revision the directory does not hold is moved to the
// committed one by the next read that asks for a mend.
await proof('an open copy at another revision is mended', async () => {
  let f = await fixture()
  f.core().finish(f.core().begin())
  let stuck = f.core().valid(f.initial)
  let mended = await f.read(true)
  let epoch = Number(mended.headers.get(EPOCH))
  await mended.body?.cancel()
  return () => {
    equal(stuck, false)
    equal(epoch, f.initial)
    ok(f.core().valid(epoch))
  }
})

await proof(
  'a fence whose write is gone is lowered by a read that finds it',
  async () => {
    let f = await fixture()
    f.core().begin()
    let held = f.core().valid(f.initial)
    await (await f.read()).body?.cancel()
    let still = f.fence().blocked
    let mended = await f.read(true)
    let epoch = Number(mended.headers.get(EPOCH))
    await mended.body?.cancel()
    return () => {
      equal([held, still], [false, true])
      equal(f.fence().blocked, false)
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
let retired: Rule = {
  ...rule,
  source: {
    $defs: {
      doc: {
        component: true,
        extends: true,
        properties: { former: { type: 'string' } },
      },
    },
  },
  find: '.doc.former&*',
  move: (row) => [{
    entity: row.entity,
    doc: { title: (row.doc as { former: string }).former, former: null },
  }],
  drop: ['doc.former'],
}
let sourced = async (live = false) => {
  let f = await fixture([{
    ...retired,
    ...live ? { live: 'all' as const } : {},
  }])
  await f.source(retired.source!, [{
    entity: { eid: 'app' },
    doc: { former: 'Moved' },
  }])
  return f
}
await proof(
  'a retired-vocabulary rehearsal rolls back without a fence',
  async () => {
    let f = await sourced()
    let answer = await f.ask('/move?rehearse=1')
    let result = await answer.json() as { rules: Rehearsal[] }
    let rows = await f.at.query('.entity.eid=app&.doc')
    return () => {
      equal(result.rules, [{
        mark: retired.mark,
        rows: 1,
        moved: 1,
        batches: 1,
      }])
      equal((rows[0].doc as { title: string }).title, 'Before')
      equal(f.begins, [])
      equal(f.core().get('.app'), f.body)
      equal(f.committed().epoch, String(f.initial))
    }
  },
)
await proof(
  'a retired-vocabulary move commits under its batch fence',
  async () => {
    let f = await sourced(true)
    await f.move()
    let rows = await f.at.query('.entity.eid=app&.doc')
    let answer = await f.ask('/move')
    let result = await answer.json() as { rules: { done?: string }[] }
    return () => {
      equal((rows[0].doc as { title: string }).title, 'Moved')
      ok(result.rules[0].done)
      equal(f.begins, [f.initial + 1])
      equal(f.finishes, f.begins)
      equal(f.committed().epoch, String(f.initial + 1))
      equal(f.fence().blocked, false)
    }
  },
)
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
      equal(f.fence().blocked, false)
    }
  },
)

// A deploy moves the copy, and the runtime fails a call into it for a moment,
// the answer to a begin it carried out included (T-131234).
let moving =
  (times: number, error = 'internal error; reference = moving') => () =>
    times-- > 0 ? Promise.reject(new Error(error)) : Promise.resolve()
// A Store on a clock of its own, and its write run with that clock moved on,
// each of the copy's pauses at a time, until the write settles.
let paused = async () => {
  let time = clock()
  let f = await fixture([], time)
  let settled = async <T>(write: Promise<T>) => {
    let done = false
    write.then(() => done = true, () => done = true)
    while (!done) await time.advance(backoff.pauses[0])
    return write
  }
  return { f, settled }
}

await proof('a write waits out a copy that moves under it', async () => {
  let { f, settled } = await paused()
  f.onBegin(moving(1))
  f.onFinish(moving(1, 'Network connection lost.'))
  let error = await settled(refusal(() => f.at.apply(patch, KERNEL)))
  return () => {
    equal(error, '')
    equal(f.committed(), { access: 'private', epoch: String(f.initial + 2) })
    equal([f.begins, f.finishes], [[f.initial + 1, f.initial + 2], [
      f.initial + 2,
    ]])
    equal(f.fence().blocked, false)
  }
})

await proof(
  'a copy still moving after the pauses fails the write, which commits nothing',
  async () => {
    let { f, settled } = await paused()
    f.onBegin(moving(Infinity))
    let error = await settled(refusal(() => f.at.apply(patch, KERNEL)))
    return () => {
      ok(error.includes('internal error'), error)
      equal(f.committed(), { access: 'public', epoch: String(f.initial) })
      equal(f.begins.length, backoff.pauses.length + 1)
      equal(f.fence().blocked, false)
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

// A write is answered once it commits under its fence, and the fence is
// lowered after: a finish still on its way holds the answer back no longer.
await proof(
  'a committed write is answered before its fence is lowered',
  async () => {
    let f = await fixture()
    let release!: () => void
    f.onFinish(() => new Promise<void>((r) => release = r))
    await f.at.apply(patch, KERNEL)
    let fenced = unavailable(f)
    release()
    await f.settle()
    return () => {
      equal(fenced, true)
      equal(f.finishes, [f.initial + 1])
      ok(f.core().valid(f.initial + 1))
    }
  },
)

await proof(
  'a lost finish still answers the write, and the fence is mended',
  async () => {
    let f = await fixture()
    f.onFinish(() => Promise.reject(new Error('finish RPC lost')))
    let error = await refusal(() => f.at.apply(patch, KERNEL))
    await f.settle()
    let committed = f.committed()
    return () => {
      equal(error, '')
      equal(committed, { access: 'private', epoch: String(f.initial + 1) })
      equal(f.finishes, [])
      ok(f.core().valid(f.initial + 1))
    }
  },
)

// A write is still running after its commit (a wake's job runs in the effects
// of the write that fired it), and a fence is orphaned meanwhile.
await proof(
  'a fence orphaned while a committed write runs on is lowered by a read',
  async () => {
    let f = await fixture()
    let release!: () => void
    f.onFinish(() => new Promise<void>((r) => release = r))
    let running = f.live(patch)
    while (!release) await new Promise((r) => setTimeout(r, 0))
    f.core().begin()
    let mended = await f.read(true)
    let epoch = Number(mended.headers.get(EPOCH))
    await mended.body?.cancel()
    let current = f.core().valid(epoch)
    release()
    let written = (await running).status
    return () => {
      equal([epoch, current, written], [f.initial + 1, true, 200])
      ok(f.core().valid(epoch))
    }
  },
)

await proof(
  'a fence whose begin is still on its way is never lowered',
  async () => {
    let f = await fixture()
    let release!: () => void
    f.onBegin(() => new Promise<void>((r) => release = r))
    let writing = f.live(patch)
    while (!release) await new Promise((r) => setTimeout(r, 0))
    await (await f.read(true)).body?.cancel()
    let blocked = f.fence().blocked
    release()
    let written = (await writing).status
    return () => {
      equal([blocked, written], [true, 200])
      equal(f.committed(), { access: 'private', epoch: String(f.initial + 1) })
      ok(f.core().valid(f.initial + 1))
    }
  },
)

await proof('a read is answered when the copy fails its mend', async () => {
  let f = await fixture()
  f.core().begin()
  f.onRevision(moving(1))
  let read = await f.read(true)
  await read.body?.cancel()
  return () => {
    equal(read.status, 200)
    equal(f.fence().blocked, true)
  }
})
