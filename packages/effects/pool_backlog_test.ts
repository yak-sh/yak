/// <reference lib="deno.ns" />
// Backlog selection must bound SQLite's physical work, not just its answer.
// All fixtures enter through graph.apply; the native handle is used only to
// count VM instructions while the adapter executes ordinary graph reads.
import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { writing } from '@yaks/sql'
import { storage } from '@yaks/sqlite'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { driver } from '../sqlite/native.ts'
import { test, until } from '@yaks/testing'
import { effects, type Opts } from './registry.ts'
import { pooledBlog } from './testing.ts'

let fixture = (sqlite = false, opts: Partial<Opts> = {}, adopt = false) => {
  let db = sqlite ? new Database(':memory:') : undefined
  let native = db ? driver(db) : undefined
  let steps = 0
  let rows = 0
  let reads = 0
  let measuring = false
  let ffi = db
    ? Deno.dlopen(sqlitePath, {
      sqlite3_progress_handler: {
        parameters: ['pointer', 'i32', 'function', 'pointer'],
        result: 'void',
      },
    })
    : undefined
  let progress = db
    ? new Deno.UnsafeCallback(
      { parameters: ['pointer'], result: 'i32' },
      () => {
        if (measuring) steps += 100
        return 0
      },
    )
    : undefined
  if (db) {
    ffi!.symbols.sqlite3_progress_handler(
      db.unsafeHandle,
      100,
      progress!.pointer,
      null,
    )
  }
  let counted = native
    ? {
      ...native,
      query: ((s) => {
        let read = !writing(s)
        measuring = read
        try {
          let answer = native.query(s)
          if (read) {
            reads++
            rows += answer.length
          }
          return answer
        } finally {
          measuring = false
        }
      }) as typeof native.query,
    }
    : undefined
  let store = counted
    ? storage(counted, pooledBlog, { number: true, adopt })
    : ram(pooledBlog, { number: true, adopt })
  let errors: unknown[] = []
  let fx = effects(pooledBlog, {
    write: (b) => g.apply(b, { trusted: true }),
    report: (e) => void errors.push(e),
    now: () => 0,
    ...opts,
  })
  let g = graph({ storage: store, vocab: pooledBlog, plugins: [fx] })
  return {
    g,
    fx,
    errors,
    reset: () => {
      steps = rows = reads = 0
    },
    counts: () => ({ steps, rows, reads }),
    close: async () => {
      await fx.stop()
      if (db) {
        ffi!.symbols.sqlite3_progress_handler(db.unsafeHandle, 0, null, null)
        db.close()
        progress!.close()
        ffi!.close()
      }
    },
  }
}

let run = (
  eid: string,
  handler = 'post_note',
  patch: Record<string, unknown> = {},
): Bundle => ({
  entity: { eid },
  effect: {
    handler,
    target: 'target',
    comp: 'post',
    kind: 'created',
    state: 'pending',
    attempts: 0,
    at: new Date(0).toISOString(),
    generation: 0,
    ...patch,
  },
})

let seed = async (f: ReturnType<typeof fixture>, n: number) => {
  await f.g.apply([{ entity: { eid: 'target' }, post: { title: 'Target' } }])
  // Batch size bounds fixture memory as well. No handled effects yet, so the
  // target write owes none; only these explicitly imported runs are pending.
  for (let start = 0; start < n; start += 1000) {
    await f.g.apply(
      Array.from(
        { length: Math.min(1000, n - start) },
        (_, i) => run(`slow-${String(start + i).padStart(6, '0')}`),
      ),
      { trusted: true },
    )
  }
  await f.g.apply([run('fast', 'post_gone')], { trusted: true })
}

// One finite pass over `n` pending runs of a held handler and one of another,
// counting what SQLite read for it.
let backlogProbe = async (n: number, max = 2) => {
  let f = fixture(true, { max })
  let gate = Promise.withResolvers<void>()
  let started: string[] = []
  let work: Promise<void> | undefined
  try {
    await seed(f, n)
    f.fx.handle({
      post_note: () => {
        started.push('slow')
        return gate.promise
      },
      post_gone: () => {
        started.push('fast')
      },
    })
    f.reset()
    // A finite pass does not drain the fixture. The slow run remains held
    // while we observe that the other handler started in the very first pass.
    work = f.fx.work(f.g, undefined, 1)
    await until(() => started.includes('fast'), { timeout: 2000 })
    assert(started.filter((name) => name == 'slow').length <= 32)
    assert(started.includes('fast'))
    let counts = f.counts()
    assert(counts.rows < (max == Infinity ? 1024 : 256), JSON.stringify(counts))
    assert(counts.steps < 50_000, JSON.stringify(counts))
    assertEquals(f.errors, [])
    return counts
  } finally {
    gate.resolve()
    await work
    await f.close()
  }
}

test('a SQLite backlog cannot hide another handler or turn LIMIT into a full scan', async () => {
  let small = await backlogProbe(64)
  let large = await backlogProbe(512)
  await backlogProbe(64, Infinity)
  assert(
    large.steps <= small.steps * 2 + 5000,
    JSON.stringify({ small, large }),
  )
  assert(large.rows <= small.rows + 64, JSON.stringify({ small, large }))
})

for (let sqlite of [false, true]) {
  let backend = sqlite ? 'SQLite' : 'RAM'
  test(`${backend}: max=1 gives the other handler its next finite wake`, async () => {
    let f = fixture(sqlite, { max: 1 })
    try {
      await seed(f, 40)
      let started: string[] = []
      f.fx.handle({
        post_note: () => {
          started.push('slow')
        },
        post_gone: () => {
          started.push('fast')
        },
      })
      await f.fx.work(f.g, undefined, 1)
      await f.fx.work(f.g, undefined, 1)
      assertEquals(started, ['slow', 'fast'])
      assertEquals(f.errors, [])
    } finally {
      await f.close()
    }
  })

  test(`${backend}: finite wakes cross a blocked prefix without spending attempts or stealing a lease`, async () => {
    let f = fixture(sqlite, { max: 1 })
    try {
      await f.g.apply([
        { entity: { eid: 'target' }, post: { title: 'Target' } },
        { entity: { eid: 'peer' }, subscriber: {} },
      ])
      let future = new Date(60_000).toISOString()
      await f.g.apply([
        ...Array.from(
          { length: 40 },
          (_, i) =>
            run(
              `blocked-${i}`,
              'post_note',
              i % 2 ? { next: future, attempts: 1 } : {
                lease_owner: 'peer',
                lease_token: `peer-${i}`,
                lease_expiry: future,
              },
            ),
        ),
        run('ready'),
      ], { trusted: true })
      let started = 0
      f.fx.handle({
        post_note: () => {
          started++
        },
      })
      for (let wake = 0; wake < 48 && !started; wake++) {
        f.reset()
        await f.fx.work(f.g, undefined, 1)
        let counts = f.counts()
        assert(counts.rows < 256, JSON.stringify(counts))
        assert(counts.steps < 50_000, JSON.stringify(counts))
      }
      assertEquals(started, 1)
      assertEquals((await f.g.get(['ready']))[0]?.effect, undefined)
      let blocked = await f.g.get(['blocked-0', 'blocked-1'])
      let leased = blocked[0].effect as Comp
      let deferred = blocked[1].effect as Comp
      assertEquals(leased.attempts, 0)
      assertEquals(leased.lease_token, 'peer-0')
      assertEquals(deferred.attempts, 1)
      assertEquals(deferred.next, future)
      assertEquals(f.errors, [])
    } finally {
      await f.close()
    }
  })

  test(`${backend}: physical pages ignore imported entity numbers and equal timestamps`, async () => {
    let f = fixture(sqlite, {}, true)
    try {
      await f.g.apply([{
        entity: { eid: 'target' },
        post: { title: 'Target' },
      }])
      await f.g.apply([
        { ...run('z'), entity: { eid: 'z', num: 99 } },
        { ...run('a'), entity: { eid: 'a', num: 2 } },
        { ...run('m'), entity: { eid: 'm', num: 57 } },
      ], { trusted: true })
      assertEquals((await f.g.get(['z', 'a', 'm'])).map((b) => b.entity.num), [
        99,
        2,
        57,
      ])
      let found: string[] = []
      let after: string | undefined
      for (let page = 0; page < 4; page++) {
        let rows = await f.g.read(
          `.effect.state=pending .limit=1${after ? ` .after=${after}` : ''}`,
          { storageOrder: true },
        )
        if (!rows.length) break
        after = rows[0].entity.eid
        found.push(after)
      }
      assertEquals(found, ['z', 'a', 'm'])
    } finally {
      await f.close()
    }
  })
}
