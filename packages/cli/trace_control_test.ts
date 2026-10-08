import { equal, ok, test, throws, until } from '@yaks/testing'
import { traceControl } from './trace_control.ts'

// A control that polls its sidecar every millisecond, and a wait that looks
// as often, so noticing another instance's arming costs a test a millisecond
// rather than a quarter second.
let watching = (db: string, pid: number) => traceControl(db, pid, 1)
let noticed = (fact: () => Promise<boolean>, label: string) =>
  until(fact, { poll: 1, label })

let scratch = async (run: (db: string) => void | Promise<void>) => {
  let dir = await Deno.makeTempDir({ prefix: 'T-64930-control-' })
  try {
    await run(`${dir}/watched.db`)
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

test('yak trace arms a missing database without opening or creating it and exits', () =>
  scratch(async (db) => {
    let config = db.replace('/watched.db', '/yak.json')
    await Deno.writeTextFile(config, JSON.stringify({ db, plugins: [] }))
    let line = new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        '--config',
        new URL('../../deno.json', import.meta.url).pathname,
        new URL('./yak.ts', import.meta.url).pathname,
        'trace',
        '--config',
        config,
        '--process',
        '101',
        '--next',
        '2',
        '--rate',
        '0.1',
      ],
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
    let result = await line.output()
    equal(result.code, 0, new TextDecoder().decode(result.stderr))
    equal(JSON.parse(new TextDecoder().decode(result.stdout)), {
      next: 2,
      rate: 0.1,
      process: 101,
    })
    throws(() => Deno.statSync(db))
    ok(Deno.statSync(`${db}.trace.json`).isFile)
    let control = traceControl(db, 101)
    try {
      equal(await control.take(), { requested: true, rate: 0.1 })
    } finally {
      control.close()
    }
  }))
test('separate processes share one capture budget without duplicate consumption', () =>
  scratch(async (db) => {
    let arm = traceControl(db)
    try {
      await arm.set({ next: 3 })
      let source =
        `import {traceControl} from ${
          JSON.stringify(new URL('./trace_control.ts', import.meta.url).href)
        };\n` +
        `let control=traceControl(${JSON.stringify(db)});\n` +
        `try {let all=await Promise.all(Array.from({length:6},()=>control.take())); console.log(all.filter(s=>s.requested).length)} finally {control.close()}`
      let children = Array.from(
        { length: 4 },
        () =>
          new Deno.Command(Deno.execPath(), {
            args: [
              'eval',
              '--config',
              new URL('../../deno.json', import.meta.url).pathname,
              source,
            ],
            stdout: 'piped',
            stderr: 'piped',
          }).spawn(),
      )
      let counts = await Promise.all(children.map(async (child) => {
        let output = await child.output()
        equal(output.code, 0, new TextDecoder().decode(output.stderr))
        return Number(new TextDecoder().decode(output.stdout).trim())
      }))
      equal(counts.reduce((a, b) => a + b), 3)
    } finally {
      arm.close()
    }
  }))

test('capture controls leave HTTP servers free to drain and release their ports', () =>
  scratch(async (db) => {
    let control = traceControl(db)
    let server = Deno.serve({
      hostname: '127.0.0.1',
      port: 0,
      onListen: () => {},
    }, () => Response.json({ ready: true }))
    try {
      let response = await fetch(`http://127.0.0.1:${server.addr.port}`)
      equal(await response.json(), { ready: true })
      control.close()
      let stopped = false
      let closing = server.shutdown().then(() => {
        stopped = true
      })
      await until(() => stopped, { timeout: 2000, label: 'HTTP server drains' })
      await closing
      let listener = Deno.listen({
        hostname: '127.0.0.1',
        port: server.addr.port,
      })
      listener.close()
    } finally {
      control.close()
    }
  }))
