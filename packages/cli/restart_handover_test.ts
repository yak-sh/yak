// The restart interface drives isolated CLI processes, never the box's units.
// Tracker intake already admitted to the old worker finishes before its lease
// moves; its spool survives that graceful drain, and its web is handed over on
// a shared port without refusing a request.

import { assert, assertEquals } from '@std/assert'
import { test, until } from '@yaks/testing'
import { compose } from './host.ts'
import { read } from './config.ts'
import { restart } from './restart.ts'
import { files } from '../tracker/file.ts'
import { caught, spool } from '../tracker/report.ts'

let exists = (path: string) => Deno.stat(path).then(() => true, () => false)
let gone = (pid: number) => {
  try {
    Deno.kill(pid, 0)
    return false
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return true
    throw error
  }
}
let text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let root = new URL('../../deno.json', import.meta.url).pathname
let cli = new URL('./yak.ts', import.meta.url).pathname
let intake = new URL('../tracker/service.ts', import.meta.url).href
let file = new URL('../tracker/file.ts', import.meta.url).href
let wait = (fact: () => unknown | Promise<unknown>, label: string) =>
  until(fact, { timeout: 15_000, label })

test('restart drains tracker intake without losing its spool or a web request', async () => {
  let dir = await Deno.makeTempDir({ prefix: 't63998-handover-' })
  let children: {
    unit: string
    proc: Deno.ChildProcess
    output: Promise<Deno.CommandOutput>
    ended: boolean
  }[] = []
  let hosts: Awaited<ReturnType<typeof compose>>[] = []
  let ports: number[] = []
  let events: string[] = []
  let env = {
    PROCESS_DIR: `${dir}/processes`,
    HARNESS_HOME: `${dir}/home`,
    TASKS_HOME: `${dir}/home`,
    TASKS_SESSION: '',
    CLAUDE_CODE_SESSION_ID: '',
  }
  let plugin = `${dir}/intake`
  let work = `${dir}/work.json`
  let tracker = `${dir}/tracker.json`
  let start = (unit: string, config: string) => {
    let name = unit.slice(0, -'.service'.length).replace('@', '-')
    let ready = ['--ready', `${dir}/${name}.ready`]
    let args = unit.includes('-web@')
      ? ['serve', '--no-duties', '--share', ...ready]
      : ['work', ...ready]
    let proc = new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', '--config', root, cli, '--config', config, ...args],
      cwd: dir,
      env,
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
    let child = { unit, proc, ended: false, output: proc.output() }
    child.output = child.output.then((result) => {
      child.ended = true
      return result
    })
    children.push(child)
    return child
  }
  let stop = (unit: string) => {
    let child = children.findLast((c) => c.unit == unit && !c.ended)
    assert(child, `no owned process for ${unit}`)
    child.proc.kill('SIGTERM')
    return child
  }
  let exit = async (child: typeof children[number]) => {
    await wait(() => child.ended, `${child.unit} exits`)
    let result = await child.output
    assertEquals(result.code, 0, text(result.stderr))
  }
  let answering = async (port: number) => {
    try {
      let response = await fetch(`http://127.0.0.1:${port}/query?q=.exception`)
      await response.body?.cancel()
      return response.ok
    } catch {
      return false
    }
  }
  try {
    await Deno.mkdir(plugin)
    await Deno.writeTextFile(
      `${plugin}/service`,
      `
      import { service as intake } from '${intake}'
      import { files } from '${file}'
      import { until } from '@yaks/testing'
      export let service = (host, opts, signal) => intake(host, {
        source: async function* () {
          for await (let record of files(opts.spool).source()) {
            yield { rows: record.rows, ack: async () => {
              if (record.rows.some(r => r.entity.eid == 'held-occurrence')) {
                await Deno.writeTextFile(opts.dir + '/held', String(Deno.pid))
                await until(() => Deno.stat(opts.dir + '/release').then(
                  () => true, () => false), { timeout: 15000 })
              }
              await record.ack()
            } }
          }
        }, every: 10,
      }, signal)
    `,
    )
    let plugins = [
      '@yaks/kernel',
      '@yaks/doc',
      '@yaks/tools',
      '@yaks/process',
      '@yaks/effects',
      '@yaks/api',
    ]
    for (let config of [work, tracker]) {
      let listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
      ports.push(listener.addr.port)
      listener.close()
      await Deno.writeTextFile(
        config,
        JSON.stringify({
          db: config + '.db',
          hostname: '127.0.0.1',
          port: ports.at(-1),
          lease: 100,
          plugins: config == work ? plugins : [...plugins, '@yaks/tracker', {
            use: plugin,
            with: { dir, spool: `${dir}/spool` },
          }],
        }),
      )
      hosts.push(
        await compose(read(config), ['graph'], undefined, { install: true }),
      )
    }
    let old = start('probe-work@old.service', work)
    let oldTracker = start('probe-tracker@old.service', tracker)
    await wait(() => exists(`${dir}/probe-work-old.ready`), 'primary ready')
    await wait(() => exists(`${dir}/probe-tracker-old.ready`), 'tracker ready')
    let web = start('probe-tracker-web@old.service', tracker)
    await wait(() => answering(ports[1]), 'tracker HTTP ready')
    // A client asking all through the handover, on a connection per request.
    let asked = 0
    let refused = 0
    let asking = true
    let client = (async () => {
      while (asking) {
        asked++
        try {
          let response = await fetch(`http://127.0.0.1:${ports[1]}/vocab`, {
            headers: { connection: 'close' },
          })
          await response.body?.cancel()
          if (!response.ok) refused++
        } catch {
          refused++
        }
      }
    })()
    let sink = spool(files(`${dir}/spool`).append)
    await caught(new Error('held report'), { sink, eid: 'held-occurrence' })
    await wait(() => exists(`${dir}/held`), 'tracker intake in flight')
    assertEquals(
      await Deno.readTextFile(`${dir}/held`),
      String(oldTracker.proc.pid),
    )
    let run = (_command: string, args: string[]) => {
      let action = args.includes('list-units') ? 'list' : args[2]
      events.push(action)
      if (action == 'list') {
        return Promise.resolve({
          code: 0,
          stderr: '',
          stdout: [old.unit, oldTracker.unit, web.unit].map(
            (unit) => `${unit} loaded active running probe`,
          ).join('\n'),
        })
      }
      let units = args.slice(3)
      if (action == 'start') {
        start(units[0], units[0].startsWith('probe-work@') ? work : tracker)
      } else if (action == 'stop') {
        for (let unit of units) stop(unit)
      }
      return Promise.resolve({ code: 0, stdout: '', stderr: '' })
    }
    await restart({
      runtimeDir: dir,
      run,
      roles: [
        { unit: 'probe-work', old: [old.unit] },
        { unit: 'probe-tracker', old: [oldTracker.unit] },
        { unit: 'probe-tracker-web', old: [web.unit] },
      ],
      ready: async (path) => {
        let found = await exists(path)
        if (found) events.push('ready')
        return found
      },
    })
    assertEquals(events, [
      'list',
      'start',
      'ready',
      'start',
      'ready',
      'start',
      'ready',
      'stop',
    ])
    await exit(old)
    await exit(web)
    asking = false
    await client
    assert(asked > 0)
    assertEquals(refused, 0, `${refused} of ${asked} requests failed`)
    assert(!oldTracker.ended, 'tracker lost the intake waiting to acknowledge')
    assert((await Array.fromAsync(files(`${dir}/spool`).source())).length > 0)
    await caught(new Error('after handover'), { sink, eid: 'next-occurrence' })
    await Deno.writeTextFile(`${dir}/release`, '')
    await exit(oldTracker)
    await wait(async () => {
      let rows = await hosts[1].graph.get([
        'held-occurrence',
        'next-occurrence',
      ])
      return rows.length == 2 &&
        (await Array.fromAsync(files(`${dir}/spool`).source())).length == 0
    }, 'replacement admits both reports and acknowledges spool')
    assert(
      await answering(ports[1]),
      'tracker HTTP stopped with its old worker',
    )
  } finally {
    await Deno.writeTextFile(`${dir}/release`, '').catch(() => {})
    for (let child of children) if (!child.ended) child.proc.kill('SIGKILL')
    await Promise.all(children.map((child) => child.output))
    await Promise.all(hosts.map((host) => host.close()))
    for (let child of children) {
      assert(gone(child.proc.pid), `owned pid ${child.proc.pid} remains`)
    }
    for (let port of ports) {
      let listener = Deno.listen({ hostname: '127.0.0.1', port })
      listener.close()
    }
    await Deno.remove(dir, { recursive: true })
    assert(!await exists(dir))
  }
})
