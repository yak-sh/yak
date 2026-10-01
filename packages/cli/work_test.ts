// Work and HTTP are independent processes over one isolated graph. A replacement
// pool ready before the old runner drains continues its native transcript.

import { assert, assertEquals } from '@std/assert'
import { test, until } from '@yaks/testing'
import { type Comp, identityEid } from '@yaks/graph'
import { transcript } from '@yaks/session'
import { compose, read } from './host.ts'

let text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let exists = (path: string) => Deno.stat(path).then(() => true, () => false)
let reap = (pid: number) => {
  try {
    Deno.kill(-pid, 'SIGKILL')
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
}
let root = new URL('../../deno.json', import.meta.url).pathname
let cli = new URL('./yak.ts', import.meta.url).pathname
let box = new URL('../harness/box.ts', import.meta.url).href
let machine = new URL('../harness/machine.ts', import.meta.url).href

// Every child is owned here, including the detached shell's process group.
let child = (args: string[], cwd: string, env: Record<string, string>) => {
  let proc = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', '--config', root, cli, ...args],
    cwd,
    env,
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let ended = false
  let output = proc.output().then((result) => {
    ended = true
    return result
  })
  let kill = (signal: 'SIGTERM' | 'SIGKILL') => {
    if (!ended) proc.kill(signal)
  }
  let exit = async (timeout = 15000) => {
    await until(() => ended, { timeout, label: `pid ${proc.pid} exits` })
    let result = await output
    assertEquals(result.code, 0, text(result.stderr))
    return result
  }
  return { proc, output, kill, exit, ended: () => ended }
}

test('web exits during native work; a ready replacement continues after drain', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-work-test-' })
  let children: ReturnType<typeof child>[] = []
  let pids: number[] = []
  let host: Awaited<ReturnType<typeof compose>> | undefined
  let open!: () => void
  let gate = new Promise<void>((go) => open = go)
  let requests: unknown[] = []
  let server = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    onListen: () => {},
  }, async (req) => {
    requests.push(await req.json())
    if (requests.length == 1) await gate
    return Response.json(
      requests.length == 1
        ? {
          items: [{
            kind: 'call',
            id: 'shell-1',
            name: 'shell',
            args: JSON.stringify({
              command: `echo $$ > '${dir}/shell.pid'; echo started > ` +
                `'${dir}/shell.started'; read line < '${dir}/shell.gate'; ` +
                `echo finished > '${dir}/shell.finished'`,
              timeout: 30000,
            }),
          }],
        }
        : { items: [{ kind: 'assistant', text: 'continued without a nudge' }] },
    )
  })
  let port = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let webPort = port.addr.port
  port.close()
  let at = `http://127.0.0.1:${webPort}`
  let config = `${dir}/yak.json`
  let plugin = `${dir}/native`
  let env = {
    HARNESS_HOME: `${dir}/home`,
    TASKS_HOME: `${dir}/home`,
    PROCESS_DIR: `${dir}/processes`,
    YAK_CONFIG: config,
    TASKS_SESSION: '',
    CLAUDE_CODE_SESSION_ID: '',
    PATH: `${dir}/bin:${Deno.env.get('PATH')}`,
  }
  let spawn = (...args: string[]) => {
    let run = child(['--config', config, ...args], dir, env)
    children.push(run)
    return run
  }
  let wait = (fact: () => unknown | Promise<unknown>, label: string) =>
    until(fact, { timeout: 15000, label })
  let answering = async () => {
    try {
      let res = await fetch(`${at}/query?q=.session`)
      await res.body?.cancel()
      return res.ok
    } catch {
      return false
    }
  }
  try {
    await Deno.mkdir(`${dir}/bin`)
    await Deno.mkdir(plugin)
    // The process launcher still uses setsid and its durable receipts, but
    // never reaches the machine's service manager from this isolated probe.
    await Deno.writeTextFile(
      `${dir}/bin/systemd-run`,
      `#!/usr/bin/env python3
import os, sys
args = sys.argv[sys.argv.index('setsid'):]
with open('${dir}/launcher.pid', 'w') as file: file.write(str(os.getpid()))
os.execvp(args[0], [arg.replace('$$', '$') for arg in args])
`,
    )
    await Deno.chmod(`${dir}/bin/systemd-run`, 0o755)
    let fifo = await new Deno.Command('mkfifo', {
      args: [`${dir}/shell.gate`],
    }).output()
    assertEquals(fifo.code, 0, text(fifo.stderr))
    await Deno.writeTextFile(
      `${plugin}/effects`,
      `
      import { running } from '@yaks/session'
      import { toolEid } from '@yaks/tools'
      import { machineTools } from '${machine}'
      import { boxMachine } from '${box}'
      export let effects = (host, opts) => {
        let model = async req => {
          let res = await fetch(opts.url, {
            method: 'POST', body: JSON.stringify({ model: req.model,
              items: req.items }), signal: req.signal,
          })
          let reply = await res.json()
          return { ...reply, model: req.model, id: crypto.randomUUID() }
        }
        host.stopping.addEventListener('abort', () => {
          Deno.writeTextFileSync(opts.dir + '/stopped-' + Deno.pid, 'stopping')
        }, { once: true })
        return running(host.graph, {
          holder: host.me, model, stopping: host.stopping,
          tools: machineTools(boxMachine(host.graph), { cwd: () => opts.dir }),
          toolSnapshot: async () => {
            let tools = machineTools(boxMachine(host.graph), {
              cwd: () => opts.dir,
            })
            await host.graph.apply(tools.map(t => ({
              entity: { eid: toolEid(t.name) }, tool: { name: t.name },
            })), { trusted: true })
            return tools
          },
        })
      }
    `,
    )
    await Deno.writeTextFile(
      config,
      JSON.stringify({
        db: 'yak.db',
        hostname: '127.0.0.1',
        port: webPort,
        plugins: [
          '@yaks/kernel',
          '@yaks/model',
          '@yaks/session',
          '@yaks/tools',
          '@yaks/process',
          '@yaks/effects',
          '@yaks/api',
          {
            use: plugin,
            with: {
              dir,
              url: `http://127.0.0.1:${server.addr.port}`,
            },
          },
        ],
      }),
    )
    host = await compose(read(config), ['graph'])
    let old = spawn('work', '--roles', 'effects', '--ready', `${dir}/old.ready`)
    await wait(async () =>
      (await Deno.readTextFile(`${dir}/old.ready`)
        .catch(() => '')).trim() == String(old.proc.pid), 'old work ready')
    let web = spawn('serve', '--no-duties')
    await wait(answering, 'HTTP ready')
    let provider = identityEid('provider', ['fake'])
    let model = identityEid('model', ['fake'])
    let session = crypto.randomUUID()
    await host.graph.apply([
      { entity: { eid: provider }, provider: { name: 'fake' } },
      { entity: { eid: model }, model: { name: 'fake' } },
      { entity: { eid: session }, session: { id: session } },
      {
        entity: { eid: crypto.randomUUID() },
        entry: { session },
        content: { body: 'run shell then reply' },
        using: { provider, model },
      },
    ], { trusted: true })
    await wait(() => requests.length == 1, 'native model request in flight')
    web.kill('SIGTERM')
    await web.exit(5000)
    assert(!old.ended(), 'HTTP shutdown stopped native work')
    assertEquals(requests.length, 1)
    open()
    await wait(() => exists(`${dir}/shell.started`), 'native shell in flight')
    pids.push(Number(await Deno.readTextFile(`${dir}/shell.pid`)))
    let next = spawn(
      'work',
      '--roles',
      'effects',
      '--ready',
      `${dir}/next.ready`,
    )
    await wait(
      async () =>
        (await Deno.readTextFile(`${dir}/next.ready`)
          .catch(() => '')).trim() == String(next.proc.pid),
      'replacement ready first',
    )
    let replacementWeb = spawn('serve', '--no-duties')
    await wait(answering, 'replacement HTTP ready during shell')
    replacementWeb.kill('SIGTERM')
    await replacementWeb.exit(5000)
    assert(!old.ended(), 'HTTP shutdown reaped the in-flight shell worker')
    Deno.kill(pids[0], 0)
    old.kill('SIGTERM')
    await wait(
      () => exists(`${dir}/stopped-${old.proc.pid}`),
      'old drain began',
    )
    assert(!old.ended(), 'old work exited before its admitted shell completed')
    assert(!await exists(`${dir}/shell.finished`))
    // No input, nudge, or manual effect is written after the original prompt.
    await Deno.writeTextFile(`${dir}/shell.gate`, 'finish\n')
    await old.exit()
    await wait(
      async () =>
        (await transcript(host!.graph, session)).some((row) =>
          (row.content as Comp | undefined)?.body == 'continued without a nudge'
        ),
      'replacement automatically answers the same transcript',
    )
    assertEquals(requests.length, 2, 'one model request on each side of drain')
    let log = await transcript(host.graph, session)
    assertEquals(log.filter((row) => row.call).length, 1)
    assertEquals(log.filter((row) => row.result).length, 1)
    assertEquals(await Deno.readTextFile(`${dir}/shell.finished`), 'finished\n')
    assert(!log.some((row) => row.error || row.cancel))
    next.kill('SIGTERM')
    await next.exit()
    assert(!await exists(`${dir}/old.ready`))
    assert(!await exists(`${dir}/next.ready`))
  } finally {
    open()
    for (let run of children) run.kill('SIGKILL')
    await Promise.all(children.map((run) => run.output))
    for (let file of ['shell.pid', 'launcher.pid']) {
      let pid = Number(
        await Deno.readTextFile(`${dir}/${file}`).catch(() => ''),
      )
      if (pid) pids.push(pid)
    }
    for (let pid of new Set(pids)) reap(pid)
    await host?.close()
    await server.shutdown()
    await Deno.remove(dir, { recursive: true })
    for (let pid of new Set([...pids, ...children.map((r) => r.proc.pid)])) {
      await wait(() => {
        try {
          Deno.kill(pid, 0)
          return false
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error
          return true
        }
      }, `owned pid ${pid} gone`)
    }
    let freed = Deno.listen({ hostname: '127.0.0.1', port: webPort })
    freed.close()
    let modelPort = Deno.listen({
      hostname: '127.0.0.1',
      port: server.addr.port,
    })
    modelPort.close()
    assert(!await exists(dir), 'probe home removed')
  }
})
