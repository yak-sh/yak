/** Real local CLI lifecycle waits under exclusively owned systemd units.
 * Includes unit scheduling, pinned-runtime preparation, graph/pool assembly and
 * HTTP readiness. Ready-first restart uses the production restart() door with
 * explicit private roles; it never selects the box's installed units. No model,
 * managed run, live graph, provider or outside network is involved. */
import type { Sample, Samples } from '@yaks/benchmark'
import { compose } from '../packages/cli/host.ts'
import { read } from '../packages/cli/config.ts'
import { restart } from '../packages/cli/restart.ts'

export let LIFECYCLE_NAMES = [
  'lifecycle/serve-ready',
  'lifecycle/work-ready',
  'lifecycle/restart-ready',
  'lifecycle/restart-request-gap',
]
let root = new URL('../', import.meta.url).pathname
let text = new TextDecoder()
let pause = (ms: number) => new Promise<void>((go) => setTimeout(go, ms))
let present = async (path: string) => {
  try {
    return (await Deno.stat(path)).isFile
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  }
}
let command = async (exe: string, args: string[]) => {
  let out = await new Deno.Command(exe, {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!out.success) {
    throw new Error(`${exe} ${args.join(' ')}: ${text.decode(out.stderr)}`)
  }
  return text.decode(out.stdout)
}
let systemctl = (...args: string[]) => command('systemctl', ['--user', ...args])
let wait = async (fact: () => Promise<boolean>, label: string) => {
  let end = performance.now() + 120_000
  while (!await fact()) {
    if (performance.now() >= end) throw new Error(`Timed out: ${label}`)
    await pause(10)
  }
}
// systemd expands % specifiers even inside quoted words.
let quote = (s: string) => JSON.stringify(s.replaceAll('%', '%%'))

export let measure = async (
  args: string[] = [],
): Promise<Record<string, Samples>> => {
  let n = Number(args[0] ?? 3)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('positive sample count required')
  }
  let runtime = Deno.env.get('XDG_RUNTIME_DIR')
  if (!runtime) {
    throw new Error('local lifecycle requires XDG_RUNTIME_DIR and user systemd')
  }
  // Do not replace actual lifecycle with a mock supervisor if unavailable.
  await systemctl('show-environment')
  let dir = await Deno.makeTempDir({ prefix: 'T-127678-lifecycle-' })
  let prefix = `T-127678-${crypto.randomUUID()}`
  let web = `${prefix}-web`, work = `${prefix}-work`
  let templates = [
    `${runtime}/systemd/user/${web}@.service`,
    `${runtime}/systemd/user/${work}@.service`,
  ]
  let roles = [
    { unit: work, old: [`${work}@*.service`] },
    { unit: web, old: [`${web}@*.service`] },
  ]
  let results: Record<string, Sample[]> = Object.fromEntries(
    LIFECYCLE_NAMES.map((name) => [name, []]),
  )
  let port = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let number = port.addr.port
  port.close()
  let marker = crypto.randomUUID()
  let person = crypto.randomUUID()
  let plugins = [
    '@yaks/kernel',
    '@yaks/provenance',
    '@yaks/id',
    '@yaks/doc',
    '@yaks/alias',
    '@yaks/edge',
    '@yaks/effects',
    '@yaks/tools',
    '@yaks/process',
    '@yaks/task',
    '@yaks/api',
    '@yaks/sqlite',
  ]
  let webConfig = `${dir}/web.json`, workConfig = `${dir}/work.json`
  let config = {
    db: `${dir}/yak.db`,
    person,
    plugins,
    port: number,
    hostname: '127.0.0.1',
  }
  let url = `http://127.0.0.1:${number}/query?q=${
    encodeURIComponent(`.doc.title="${marker}"`)
  }`
  let ask = async () => {
    let response = await fetch(url, {
      headers: { connection: 'close' },
      signal: AbortSignal.timeout(5000),
    })
    let body = await response.text()
    if (!response.ok || !body.includes(marker)) {
      throw new Error(`HTTP readiness: ${response.status} ${body}`)
    }
  }
  let stop = () => systemctl('stop', `${web}@*.service`, `${work}@*.service`)
  let record = (
    name: string,
    value: number,
    counts: Record<string, number> = {},
  ) => {
    results[name].push({
      value,
      source: 'end-to-end',
      counts,
      details: {
        fixture:
          'private SQLite, own systemd templates, production CLI and restart()',
        readiness: name == 'lifecycle/work-ready'
          ? 'production pool/graph readiness file'
          : 'real readiness files + populated HTTP response',
        remote: false,
      },
    })
  }
  let active = async () =>
    (await systemctl(
      'list-units',
      '--state=active,activating,deactivating',
      '--plain',
      '--no-legend',
      '--no-pager',
      `${web}@*.service`,
      `${work}@*.service`,
    )).trim()
  try {
    await Deno.writeTextFile(
      webConfig,
      JSON.stringify({ ...config, duties: false }),
    )
    await Deno.writeTextFile(workConfig, JSON.stringify(config))
    let host = await compose(read(webConfig), ['graph'])
    try {
      await host.graph.apply([{
        entity: { eid: person },
        doc: { title: marker },
      }])
    } finally {
      await host.close()
    }
    await Deno.mkdir(`${runtime}/systemd/user`, { recursive: true })
    for (let [i, role] of [web, work].entries()) {
      let ready = `${dir}/${role}-%i.ready`
      let cli = [
        Deno.execPath(),
        'run',
        '-A',
        '--config',
        `${root}deno.json`,
        `${root}packages/cli/yak.ts`,
        '--config',
        i == 0 ? webConfig : workConfig,
        ...(i == 0
          ? ['serve', '--no-duties', '--share']
          : ['work', '--roles', 'effects']),
        '--ready',
      ]
      let env = {
        YAK_RUNTIME_CACHE: `${dir}/runtime`,
        TASKS_HOME: `${dir}/tasks`,
        HARNESS_HOME: `${dir}/harness`,
        PROCESS_DIR: `${dir}/process`,
        TASKS_SESSION: '',
        CLAUDE_SESSION_ID: '',
        PATH: Deno.env.get('PATH') ?? '/usr/bin:/bin',
      }
      await Deno.writeTextFile(
        templates[i],
        `[Unit]\nDescription=Isolated T-127678 ${
          i == 0 ? 'web' : 'work'
        } benchmark\n[Service]\nType=simple\nWorkingDirectory=${root}\n${
          Object.entries(env).map(([k, v]) =>
            `Environment=${quote(`${k}=${v}`)}`
          ).join('\n')
        }\nExecStart=${
          cli.map(quote).join(' ')
        } "${ready}"\nExecStopPost=/usr/bin/rm -f "${ready}"\nRestart=no\nSuccessExitStatus=143\nKillMode=${
          i == 0 ? 'process' : 'mixed'
        }\nTimeoutStopSec=30s\nRuntimeMaxSec=180s\n`,
      )
    }
    for (let i = 0; i < n; i++) {
      for (
        let [role, name] of [[web, 'lifecycle/serve-ready'], [
          work,
          'lifecycle/work-ready',
        ]]
      ) {
        let began = performance.now()
        await systemctl('--no-block', 'start', `${role}@initial.service`)
        await wait(
          () => present(`${dir}/${role}-initial.ready`),
          `${role} ready`,
        )
        if (role == web) await ask()
        record(name, performance.now() - began)
      }
      let polling = true,
        requests = 0,
        failed = 0,
        gap = 0,
        last = performance.now()
      let poll = (async () => {
        while (polling) {
          try {
            await ask()
            let now = performance.now()
            gap = Math.max(gap, now - last)
            last = now
            requests++
          } catch {
            failed++
          }
          await pause(5)
        }
      })()
      let began = performance.now()
      try {
        let said = await restart({ runtimeDir: dir, roles })
        if (!said.includes(`${web}@`) || !said.includes(`${work}@`)) {
          throw new Error(`incomplete handover: ${said}`)
        }
        await ask()
        record('lifecycle/restart-ready', performance.now() - began)
        await wait(async () => {
          let units = await active()
          return !units.includes('@initial.service')
        }, 'old owned units drained')
        await ask()
        await pause(25)
      } finally {
        polling = false
        await poll
      }
      if (failed || !requests) {
        throw new Error(
          `handover HTTP: ${failed} failed, ${requests} succeeded`,
        )
      }
      record('lifecycle/restart-request-gap', gap, {
        requests,
        failures: failed,
      })
      await stop()
      if (await active()) throw new Error('owned units remain after stop')
    }
    return results
  } finally {
    await stop()
    await wait(
      async () => !await active(),
      `cleanup: owned units still active (${prefix})`,
    )
    for (let template of templates) {
      await Deno.remove(template).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error
      })
    }
    await Deno.remove(dir, { recursive: true })
    console.error(
      `lifecycle cleanup: ${prefix}; no active owned units; templates and ${dir} removed`,
    )
  }
}
if (import.meta.main) console.log(JSON.stringify(await measure(Deno.args)))
