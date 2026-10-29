import { equal, test, throws, until } from '@yaks/testing'
import { traceControl } from './trace_control.ts'

// A control that polls its sidecar every millisecond, and a wait that looks
// as often, so noticing another instance's arming costs a test a millisecond
// rather than a quarter second.
let watching = (db: string, pid: number) => traceControl(db, pid, 1)
let noticed = (fact: () => Promise<boolean>, label: string) =>
  until(fact, { poll: 1, label })

let scratch = async <T>(run: (db: string) => T | Promise<T>): Promise<T> => {
  let dir = await Deno.makeTempDir({ prefix: 'T-64930-control-' })
  try {
    return await run(`${dir}/watched.db`)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

test('trace control targets one PID and preserves independent rates and captures', () =>
  scratch(async (db) => {
    let server = watching(db, 101)
    let worker = watching(db, 102)
    let arm = traceControl(db, 103)
    try {
      equal(await worker.take(), { requested: false, rate: 0 })
      await arm.set({ process: 101, next: 2, rate: 0.25 })
      await noticed(
        async () => (await server.take()).requested,
        'server receives targeted capture',
      )
      equal(await worker.take(), { requested: false, rate: 0 })
      equal(await server.take(), { requested: true, rate: 0.25 })
      equal(await server.take(), { requested: false, rate: 0.25 })
      await arm.set({ rate: 0.5 })
      await noticed(
        async () => (await worker.take()).rate == 0.5,
        'worker receives global rate',
      )
      equal(await server.take(), { requested: false, rate: 0.25 })
      equal(await arm.set({ next: 1 }), { next: 1, rate: 0.5 })
      await noticed(
        async () => (await worker.take()).requested,
        'worker receives shared capture',
      )
      equal(await server.take(), { requested: false, rate: 0.25 })
    } finally {
      server.close()
      worker.close()
      arm.close()
    }
  }))

test('independent control instances atomically consume a shared budget', () =>
  scratch(async (db) => {
    let arm = traceControl(db)
    try {
      await arm.set({ next: 3 })
      // Each instance reads the same three captures before concurrent take calls.
      let consumers = Array.from(
        { length: 12 },
        (_, i) => traceControl(db, 100 + i),
      )
      try {
        let selected = await Promise.all(consumers.map((c) => c.take()))
        equal(selected.filter((s) => s.requested).length, 3)
        let after = traceControl(db)
        try {
          equal(await after.take(), { requested: false, rate: 0 })
        } finally {
          after.close()
        }
      } finally {
        consumers.forEach((c) => c.close())
      }
    } finally {
      arm.close()
    }
  }))

test('idle trace controls make no files and notice arming in a newly created parent', () =>
  scratch(async (db) => {
    let nested = db.replace('/watched.db', '/nested/watched.db')
    let idle = watching(nested, 101)
    let arm = traceControl(nested)
    try {
      for (let i = 0; i < 20; i++) {
        equal(await idle.take(), { requested: false, rate: 0 })
      }
      throws(() => Deno.statSync(`${nested}.trace.json`))
      await arm.set({ process: 101, next: 1 })
      await noticed(
        async () => (await idle.take()).requested,
        'new directory capture arrives',
      )
      equal(await idle.take(), { requested: false, rate: 0 })
    } finally {
      idle.close()
      arm.close()
    }
  }))

test('trace controls reject invalid probability and capture counts without writing', () =>
  scratch((db) => {
    let control = traceControl(db)
    try {
      for (let next of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
        throws(() => control.set({ next }))
      }
      for (let rate of [-1, 1.1, Infinity, NaN]) {
        throws(() => control.set({ rate }))
      }
      for (let process of [-1, 0, 0.5, Infinity]) {
        throws(() => control.set({ process }))
      }
      throws(() => Deno.statSync(`${db}.trace.json`))
    } finally {
      control.close()
    }
  }))

let commandResult = await scratch(async (db) => {
  let { traceCommand } = await import('./trace_control.ts')
  let said: string[] = []
  let code = await traceCommand({ db }).run!({
    process: 101,
    next: 2,
    rate: 0.1,
  }, { out: (line) => said.push(line) } as import('./run.ts').Ctx)
  let absent = false
  try {
    Deno.statSync(db)
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
    absent = true
  }
  let control = traceControl(db, 101)
  try {
    return {
      code,
      said: JSON.parse(said[0]),
      absent,
      selection: await control.take(),
    }
  } finally {
    control.close()
  }
})
test('trace command arms a missing database without opening or creating it', () => {
  equal(commandResult, {
    code: 0,
    said: { next: 2, rate: 0.1, process: 101 },
    absent: true,
    selection: { requested: true, rate: 0.1 },
  })
})
