import { equal, test, throws } from '@yaks/testing'
import {
  evaluator,
  type Loader,
  type Outbound,
  type Repls,
} from './code-runtime.ts'
import { Repl, type ReplState } from './repl-object.ts'
import { source } from '@yaks/code-mode/source'
import { described } from '@yaks/code-mode/repl'
import { strip } from '@yaks/esbuild/strip'
import type { Evaluate } from '@yaks/code-mode'

type Bridge = Parameters<Evaluate>[1]
let bridge: Bridge = {
  call: () => Promise.resolve({ content: [] }),
  read: (id) => Promise.resolve({ id }),
}
let fixture = (run: (bridge: Bridge) => Promise<string>) => {
  let disposed = 0
  let loader: Loader = {
    load: () => ({
      getDurableObjectClass: () => undefined,
      getEntrypoint: () => ({
        run: (bridge) =>
          Object.assign(run(bridge as Bridge), {
            [Symbol.dispose]: () => disposed++,
          }),
      }),
    }),
  }
  return {
    evaluate: evaluator(loader, (bridge) => bridge),
    disposed: () => disposed,
  }
}

test('evaluator runs through non-disposable loader handles and disposes the RPC call', async () => {
  let f = fixture(async (bridge) =>
    JSON.stringify(await bridge.call('a', 'b', '{}'))
  )
  let abort = new AbortController()
  equal(await f.evaluate({}, bridge, abort.signal), '{"content":[]}')
  equal(f.disposed(), 1)
  abort.abort()
  equal(f.disposed(), 1)
})

test('evaluator forwards kept result reads through its scoped bridge', async () => {
  let f = fixture(async (bridge) => JSON.stringify(await bridge.read('result')))
  equal(
    await f.evaluate({}, bridge, new AbortController().signal),
    '{"id":"result"}',
  )
})

test('evaluator disposes the pending RPC on abort and removes its listener', async () => {
  let reject!: (reason: Error) => void
  let f = fixture(() => new Promise((_, no) => reject = no))
  let abort = new AbortController()
  let result = f.evaluate({}, bridge, abort.signal)
  abort.abort()
  equal(f.disposed(), 1)
  reject(new Error('RPC canceled'))
  await throws(() => result, 'execution has ended')
  equal(f.disposed(), 2)
})

test('evaluator refuses an expired invocation before loading code', async () => {
  let f = fixture(() => {
    throw new Error('must not run')
  })
  await throws(
    () => f.evaluate({}, bridge, AbortSignal.abort()),
    'execution has ended',
  )
  equal(f.disposed(), 0)
})

test('evaluator lends the scoped egress binding and hosted resource limits to each script', async () => {
  let outbound: Outbound = {
    fetch: () => Promise.resolve(new Response('egress')),
  }
  let scope = { app: 'an app', person: 'a person', level: 'viewer' as const }
  let loader: Loader = {
    load: (code) => {
      equal(code.globalOutbound, outbound)
      equal(code.env, {})
      equal(code.limits, { cpuMs: 30_000, subRequests: 128 })
      return {
        getDurableObjectClass: () => undefined,
        getEntrypoint: () => ({
          run: () =>
            Object.assign(Promise.resolve('done'), {
              [Symbol.dispose]: () => {},
            }),
        }),
      }
    },
  }
  let run = evaluator(loader, (b) => b, {
    lend: {
      outbound: (caller) => {
        equal(caller, scope)
        return outbound
      },
    },
  })
  equal(
    await run({}, bridge, new AbortController().signal, { caller: scope }),
    'done',
  )
})

test('evaluator lends the browser only to a script that brings puppeteer, holding its run on the budget', async () => {
  let session: Outbound = { fetch: () => Promise.resolve(new Response()) }
  let envs: unknown[] = []
  let held: unknown[] = []
  let loader: Loader = {
    load: (code) => {
      envs.push(code.env)
      return {
        getDurableObjectClass: () => undefined,
        getEntrypoint: () => ({
          run: () =>
            Object.assign(Promise.resolve('done'), {
              [Symbol.dispose]: () => {},
            }),
        }),
      }
    },
  }
  let bill = { space: {} as never, person: 'a person', call: 'a call' }
  let run = evaluator(loader, (b) => b, {
    lend: { browser: session },
    permit: () => Promise.resolve(() => Promise.resolve(true)),
    browse: (bill, work) => (held.push(bill.call), work()),
  })
  let signal = new AbortController().signal
  equal(await run({ 'puppeteer.js': '' }, bridge, signal, { bill }), 'done')
  equal(await run({}, bridge, signal, { bill }), 'done')
  equal(envs, [{ BROWSER: session }, {}])
  equal(held, ['a call'])
  await throws(
    () => evaluator(loader, (b) => b)({ 'puppeteer.js': '' }, bridge, signal),
    'no browser is bound here',
  )
})

test("evaluator runs a REPL's cell in its object, and refuses one where none is bound", async () => {
  let asked: unknown[] = []
  let repls: Repls = (repl) => ({
    run: (modules, _bridge, running) => {
      asked.push([repl, Object.keys(modules), running])
      return Object.assign(Promise.resolve('cell'), {
        [Symbol.dispose]: () => {},
      })
    },
  })
  let f = fixture(() => Promise.resolve('script'))
  let signal = new AbortController().signal
  let run = evaluator(
    { load: () => ({}) as never },
    (b) => b,
    { repls },
  )
  equal(await run({ 'user.js': '' }, bridge, signal, { repl: 'r' }), 'cell')
  equal(asked, [['r', ['user.js'], {}]])
  await throws(
    () => f.evaluate({}, bridge, signal, { repl: 'r' }),
    'no REPL is bound here',
  )
})

test("a REPL's object runs each cell as its one facet, carries what it kept, and ends at its alarm", async () => {
  let kv = new Map<string, unknown>()
  let alarm = 0
  let log: string[] = []
  // The facet's storage, kept apart from the object's, as Cloudflare keeps it.
  let facetKv = new Map<string, unknown>()
  let state: ReplState = {
    storage: {
      kv: { get: (k) => kv.get(k), put: (k, v) => void kv.set(k, v) },
      setAlarm: (at) => Promise.resolve(void (alarm = at)),
      deleteAll: () => Promise.resolve(kv.clear()),
    },
    facets: {
      abort: (name) => void log.push(`abort ${name}`),
      delete: (name) => void (log.push(`delete ${name}`), facetKv.clear()),
      get: (name, start) => {
        let { class: Cell } = start() as {
          class: new () => { run(bridge: unknown): Promise<string> }
        }
        log.push(`start ${name}`)
        return new Cell()
      },
    },
  }
  let loader: Loader = {
    load: (code) => ({
      getEntrypoint: () => {
        throw new Error('a cell is a facet')
      },
      getDurableObjectClass: (name) => {
        equal(name, 'Cell')
        let user = code.modules['user.js']
        let script = code.modules['script.js']
          .replace(
            "'./user.js'",
            JSON.stringify(
              `data:text/javascript,${encodeURIComponent(user)}`,
            ),
          )
          .replace(
            "import { DurableObject } from 'cloudflare:workers';",
            `class DurableObject { ctx = { storage: { kv: globalThis.facetKv, sql: null } } }
             const scheduler = { wait: (ms, { signal }) => new Promise((resolve) => { let id = setTimeout(resolve, ms); signal.addEventListener('abort', () => clearTimeout(id)) }) };`,
          )
        return class {
          run = async (bridge: unknown) => {
            let m = await import(
              `data:text/javascript,${encodeURIComponent(script)}`
            )
            return await new m.Cell().run(bridge)
          }
        }
      },
    }),
  }
  let g = globalThis as { facetKv?: unknown }
  g.facetKv = {
    get: (k: string) => structuredClone(facetKv.get(k)),
    put: (k: string, v: unknown) => void facetKv.set(k, structuredClone(v)),
  }
  let repl = new Repl(state, loader, {}, () => 1000)
  let cell = async (script: string) =>
    JSON.parse(
      await repl.run(
        described(await source(script, [], 1 << 20, strip, { cell: true })),
        bridge,
        {},
      ),
    )
  equal(await cell('let n: number = 41'), { value: null })
  equal(await cell('n++; return n'), { value: 42 })
  equal(alarm, 1000 + 60 * 60_000)
  equal(log, ['abort cell', 'start cell', 'abort cell', 'start cell'])
  await repl.alarm()
  equal([kv.size, facetKv.size, log.at(-1)], [0, 0, 'delete cell'])
  delete g.facetKv
})
