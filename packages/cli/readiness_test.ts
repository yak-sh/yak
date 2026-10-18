// A readiness file grants no authority over an inherited pid. These probes
// own every process they signal, and open only scratch config/data/cache paths.
import { equal, ok, test, until } from '@yaks/testing'
import { alive } from './runtime.ts'

let root = new URL('../../', import.meta.url)
let config = new URL('deno.json', root).pathname
let cli = new URL('./yak.ts', import.meta.url).pathname
let local = new URL('./local.ts', import.meta.url).href
let runtime = new URL('./runtime.ts', import.meta.url).href
let text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let exists = (path: string) => Deno.stat(path).then(() => true, () => false)
let gone = (pid: number) => !alive(pid)

// Never turn the contents of a readiness file into a kill target, even on a
// failing assertion: the old bug wrote the box's inherited launcher there.
let child = (args: string[], cwd: string, env: Record<string, string>) => {
  let proc = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', '--config', config, ...args],
    cwd,
    env,
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let ended = false
  let output = proc.output().then((result) => {
    ended = true
    return result
  })
  return {
    proc,
    output,
    ended: () => ended,
    kill: (signal: 'SIGTERM' | 'SIGKILL') => {
      if (!ended) proc.kill(signal)
    },
  }
}

type Worker = {
  pid: number
  ppid: number
  launcher: number
  readiness: number
  pinned: boolean
  home: string
  db: string
  harness: string
  tasks: string
  processes: string
}

let probe = async (pinned: boolean, rejected = false) => {
  let mode = pinned
    ? 'pinned CLI'
    : rejected
    ? 'rejected handshake'
    : 'direct import'
  let dir = await Deno.makeTempDir({ prefix: 'yak-readiness-' })
  let children: ReturnType<typeof child>[] = []
  let worker: Worker | undefined
  let ready = `${dir}/ready`
  let data = `${dir}/yak.json`
  let plugin = `${dir}/probe`
  let port = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let number = port.addr.port
  port.close()
  let env = {
    YAK_CONFIG: data,
    DB_PATH: `${dir}/yak.db`,
    HARNESS_HOME: `${dir}/harness`,
    TASKS_HOME: `${dir}/tasks`,
    PROCESS_DIR: `${dir}/processes`,
    XDG_CACHE_HOME: `${dir}/cache`,
    YAK_RUNTIME_CACHE: `${dir}/runtime`,
    TASKS_SESSION: '',
    CLAUDE_CODE_SESSION_ID: '',
    YAK_RUNTIME_PINNED: '1',
    // Even a matching root/token must not confer launcher ownership on a
    // direct import. The real CLI starts outside its private tree instead.
    YAK_RUNTIME_ROOT: pinned
      ? new URL(`file://${dir}/foreign`).href
      : root.href.replace(/\/$/, ''),
    YAK_RUNTIME_FROM: root.href.replace(/\/$/, ''),
  }
  let start = (args: string[], more: Record<string, string> = {}) => {
    let run = child(args, dir, { ...env, ...more })
    children.push(run)
    return run
  }
  let wait = (fact: () => unknown | Promise<unknown>, label: string) =>
    until(fact, { timeout: 30_000, label })
  let read = (path: string) => Deno.readTextFile(path).catch(() => '')
  try {
    await Deno.mkdir(plugin)
    // A live, unrelated launcher owned by this test stands in for the main
    // service's inherited pid. SIGTERM leaves a receipt rather than killing it.
    await Deno.writeTextFile(
      `${dir}/foreign.ts`,
      `Deno.addSignalListener('SIGTERM', () => {
        Deno.writeTextFileSync(${
        JSON.stringify(`${dir}/foreign.signalled`)
      }, '')
      })
      Deno.writeTextFileSync(${
        JSON.stringify(`${dir}/foreign.ready`)
      }, String(Deno.pid))
      await Deno.stdin.read(new Uint8Array(1))
      `,
    )
    let foreign = start([`${dir}/foreign.ts`])
    await wait(() => exists(`${dir}/foreign.ready`), 'owned foreign pid ready')
    await Deno.writeTextFile(
      `${plugin}/service`,
      `import { readinessPid, runtimeRoot } from ${JSON.stringify(runtime)}
      export let service = async (host, opts, signal) => {
        await Deno.writeTextFile(opts.dir + '/worker.json', JSON.stringify({
          pid: Deno.pid, ppid: Deno.ppid,
          launcher: Number(Deno.env.get('YAK_LAUNCH_PID')),
          readiness: readinessPid(), pinned: runtimeRoot(),
          home: Deno.env.get('HOME'), db: host.config.db,
          harness: Deno.env.get('HARNESS_HOME'),
          tasks: Deno.env.get('TASKS_HOME'),
          processes: Deno.env.get('PROCESS_DIR'),
        }))
        if (!signal.aborted) await new Promise(resolve =>
          signal.addEventListener('abort', resolve, { once: true }))
        await Deno.writeTextFile(opts.dir + '/drained', String(Deno.pid))
      }
      `,
    )
    await Deno.writeTextFile(
      data,
      JSON.stringify({
        db: `${dir}/yak.db`,
        hostname: '127.0.0.1',
        port: number,
        lease: 100,
        plugins: [
          '@yaks/kernel',
          '@yaks/tools',
          '@yaks/process',
          { use: plugin, with: { dir } },
        ],
      }),
    )
    // Work serves an existing graph (T-128174); prepare the fixture before
    // either the direct or pinned invocation captures its file identity.
    let { compose, read: config } = await import('./host.ts')
    let fixture = await compose(config(data), ['graph'])
    await fixture.close()
    await Deno.writeTextFile(
      `${dir}/direct.ts`,
      `import { work, stop, close } from ${JSON.stringify(local)}
      import { runtime } from ${JSON.stringify(runtime)}
      ${rejected ? 'await runtime([])' : ''}
      let stopping = () => { stop() }
      Deno.addSignalListener('SIGTERM', stopping)
      try { await work(${JSON.stringify(data)}, ${JSON.stringify(ready)}) }
      finally {
        await close(0)
        Deno.removeSignalListener('SIGTERM', stopping)
      }
      `,
    )
    let run = start(
      pinned ? [cli, '--config', data, 'work', '--ready', ready] : [
        `${dir}/direct.ts`,
      ],
      { YAK_LAUNCH_PID: String(foreign.proc.pid) },
    )
    await wait(async () => {
      if (run.ended()) {
        throw new Error(`probe exited: ${text((await run.output).stderr)}`)
      }
      if (!await exists(ready)) return false
      // The service may create this file before writeTextFile has finished.
      // Readiness and a complete observation are both required by the probe.
      let observation = await read(`${dir}/worker.json`)
      if (!observation) return false
      try {
        worker = JSON.parse(observation) as Worker
        return true
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        return false
      }
    }, `${pinned ? 'pinned CLI' : 'direct work'} ready`)
    if (!worker) throw new Error('ready worker observation is missing')
    let advertised = Number((await read(ready)).trim())
    equal(
      advertised,
      run.proc.pid,
      `readiness must identify owned=${run.proc.pid}, never foreign=${foreign.proc.pid}`,
    )
    ok(advertised != foreign.proc.pid, 'never advertise the foreign launcher')
    equal(worker.readiness, advertised)
    equal(worker.home, Deno.env.get('HOME'), 'keep HOME and its Deno cache')
    equal(worker.db, `${dir}/yak.db`)
    equal(worker.harness, env.HARNESS_HOME)
    equal(worker.tasks, env.TASKS_HOME)
    equal(worker.processes, env.PROCESS_DIR)
    ok(await exists(`${dir}/yak.db`), 'only the scratch database is opened')
    if (pinned) {
      ok(worker.pid != run.proc.pid, 'real CLI has a separate pinned worker')
      equal(worker.ppid, run.proc.pid, 'launcher is the worker parent')
      equal(worker.launcher, run.proc.pid, 'CLI replaces the inherited pid')
      equal(worker.pinned, true)
      ok(await exists(`${dir}/runtime/0/.hash`), 'runtime cache is scratch')
    } else {
      equal(worker.pid, run.proc.pid, 'direct work is the probe itself')
      ok(worker.ppid != foreign.proc.pid, 'foreign launcher is not our parent')
      equal(
        worker.launcher,
        foreign.proc.pid,
        'foreign env really was inherited',
      )
      equal(worker.pinned, true, 'matching runtime root alone is not ownership')
      ok(!await exists(`${dir}/runtime`), 'direct import starts no launcher')
    }
    // Only the spawn handle can be signalled. The foreign pid stays alive
    // through readiness, worker drain, and invocation exit.
    run.kill('SIGTERM')
    await wait(run.ended, 'owned invocation exits after SIGTERM')
    let result = await run.output
    equal(result.code, pinned ? 143 : 0, text(result.stderr))
    equal(
      result.signal,
      null,
      'normal close, not termination by default handler',
    )
    equal(await read(`${dir}/drained`), String(worker.pid), 'service drained')
    ok(!await exists(ready), 'readiness removed during normal worker close')
    ok(!foreign.ended(), 'foreign process survived owned cleanup')
    ok(
      !await exists(`${dir}/foreign.signalled`),
      'foreign process never signalled',
    )
    await wait(() => gone(worker!.pid), 'owned worker gone')
    console.log(JSON.stringify({
      mode,
      scratch: dir,
      foreign: foreign.proc.pid,
      invocation: run.proc.pid,
      worker: worker.pid,
      readiness: advertised,
      exit: result.code,
      drained: true,
      foreignUntouched: true,
    }))
  } finally {
    // Not a readiness pid, inherited pid, process group, or service unit.
    // If an assertion failed, only our spawn handles are killed. A pinned
    // child is killed with its launcher.
    for (let run of children) run.kill('SIGKILL')
    await Promise.all(children.map((run) => run.output))
    if (worker && pinned) {
      await wait(() => gone(worker!.pid), 'pinned child reaped')
    }
    for (let run of children) ok(gone(run.proc.pid), 'owned child reaped')
    ok(
      !await exists(`${dir}/foreign.signalled`),
      'cleanup never signalled foreign pid',
    )
    await Deno.remove(dir, { recursive: true })
    ok(!await exists(dir), 'scratch config, database and runtime cache removed')
    let freed = Deno.listen({ hostname: '127.0.0.1', port: number })
    freed.close()
  }
}

// Each owned-process scenario executes once as this file loads, retaining all
// readiness, PID ownership, drain, exit and cleanup assertions inside probe.
// The timed checks read completed observations, not OS launcher scheduling.
let directReady = await probe(false).then(() => true)
let pinnedReady = await probe(true).then(() => true)
let rejectedReady = await probe(false, true).then(() => true)
test('direct work readiness ignores a foreign inherited launcher pid', () =>
  equal(directReady, true))
test('pinned CLI readiness owns its launcher and SIGTERM closes with 143', () =>
  equal(pinnedReady, true))
test('a matching runtime token rejects a live launcher that is not its parent', () =>
  equal(rejectedReady, true))
