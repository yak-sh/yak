/** The box bench's optional explicit HTTP door, with its own server and cache. */
import { read } from '@yaks/cli'
import { derivedEid } from '@yaks/graph'
import type { Sample } from '@yaks/benchmark'
import type { Event } from '@yaks/trace'
import { doorUrl, rpc } from '../packages/cli/rpc.ts'
import { cached } from '../packages/cli/store.ts'
import { childEnv, PERMS, split } from './box-lib.ts'
import type { Timed } from './box.ts'

let ROOT = new URL('..', import.meta.url).pathname
let PERSON = derivedEid('@yaks/bench box door person')
let SESSION = derivedEid('@yaks/bench box door session')
let TARGET = derivedEid('@yaks/bench box door target')
let PHASES = [
  'boot',
  'import',
  'setup',
  'list',
  'dispatch',
  'request',
  'preparation',
  'render',
  'close',
  'exit',
  'total',
]
let CASES = ['read', 'write']
type Record = { method: string; tool?: string; ms: number; spans: Event[] }
type Clock = (
  argv: string[],
  env?: globalThis.Record<string, string>,
  perms?: string[],
) => Promise<Timed>

export let door = async (
  config: string,
  scratch: string,
  port: number,
  timed: Clock,
) => {
  // Bind first: an occupied port fails before any graph write or reset.
  let reservation = Deno.listen({ hostname: '127.0.0.1', port })
  reservation.close()
  let serverConfig = `${scratch}/door.json`
  let ready = `${scratch}/door.ready`
  let records = `${scratch}/door.jsonl`
  await Deno.writeTextFile(
    serverConfig,
    JSON.stringify({
      ...read(config),
      port,
      hostname: '127.0.0.1',
      duties: false,
    }),
  )
  let env = {
    YAKS_HOME: `${scratch}/client`,
    YAK_CONFIG: serverConfig,
    TASKS_SESSION: SESSION,
  }
  let host = `127.0.0.1:${port}`
  let perms = [...PERMS, `--allow-net=127.0.0.1:${port}`]
  let yak = (argv: string[]) =>
    timed([`${ROOT}packages/cli/yak.ts`, '--host', host, ...argv], env, perms)
  await timed([
    `${ROOT}packages/cli/yak.ts`,
    '--config',
    serverConfig,
    'graph',
    'apply',
    '--bundles',
    JSON.stringify([
      { entity: { eid: PERSON }, person: {}, doc: { title: 'box door bench' } },
      { entity: { eid: SESSION }, session: { id: SESSION, actor: PERSON } },
      { entity: { eid: TARGET }, doc: { title: 'box door bench target' } },
      ...Array.from({ length: 5 }, (_, i) => ({
        entity: { eid: derivedEid(`@yaks/bench box door task ${i}`) },
        task: {},
        doc: { title: `box door bench task ${i}` },
      })),
    ]),
  ], { YAKS_HOME: `${scratch}/client` })
  let log = await Deno.open(`${scratch}/door.log`, {
    create: true,
    write: true,
  })
  let child = new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      ...perms,
      '--config',
      `${ROOT}deno.json`,
      `${ROOT}bench/box-door-server.ts`,
      serverConfig,
      ready,
      records,
    ],
    env: childEnv({ YAKS_HOME: `${scratch}/server` }),
    clearEnv: true,
    stdout: 'null',
    stderr: 'piped',
  }).spawn()
  let logging = child.stderr.pipeTo(log.writable)
  let ended = false
  let status = child.status.then((s) => {
    ended = true
    return s
  })
  let close = async () => {
    if (!ended) child.kill('SIGTERM')
    let timer = setTimeout(() => {
      if (!ended) child.kill('SIGKILL')
    }, 5_000)
    try {
      await status
      await logging
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    let until = performance.now() + 30_000
    while (!(await Deno.stat(ready).catch(() => null))) {
      if (ended || performance.now() > until) {
        throw new Error(
          `box door: server not ready\n${await Deno.readTextFile(
            `${scratch}/door.log`,
          )}`,
        )
      }
      await new Promise((done) => setTimeout(done, 25))
    }
    let ask = rpc({ url: doorUrl(host), via: SESSION })
    let result = async (name: string, args: unknown) => {
      let answer = await ask('tools/call', { name, arguments: args })
      if (answer.isError) throw new Error(JSON.stringify(answer))
      return (answer.structuredContent as {
        result: { entity: { eid: string }; [key: string]: unknown }[]
      }).result
    }
    let session = await result('graph_show', { ids: [SESSION] })
    if ((session[0]?.session as { actor?: string })?.actor != PERSON) {
      throw new Error('box door: session actor was not seeded')
    }
    let commands = (body: string): [string, string[]][] => [
      ['read', ['task', 'list', '--limit', '5']],
      ['write', ['comment', 'new', TARGET, body]],
    ]
    let rows = await result('task_list', { limit: 5 })
    if (rows.length != 5 || rows.some((r) => !r.task)) {
      throw new Error('box door: read must return five tasks')
    }
    let history = async (): Promise<Record[]> =>
      (await Deno.readTextFile(records)).trim().split('\n').filter(Boolean).map(
        (line) => JSON.parse(line),
      )
    let verify = async (body: string) => {
      let rows = await result('graph_query', {
        q: `.comment.target=${TARGET} .doc.body=${
          JSON.stringify(body)
        } ?created ?updated`,
      })
      let stamp = rows[0]?.created as { by?: string; via?: string } | undefined
      if (rows.length != 1 || stamp?.by != PERSON || stamp?.via != SESSION) {
        throw new Error(
          `box door: write attribution failed: ${JSON.stringify(rows)}`,
        )
      }
    }
    let names = [
      'door/cache',
      ...CASES.flatMap((name) => [
        `door/${name}/wall`,
        `door/${name}/server`,
        ...PHASES.map((phase) => `door-startup/${name}/${phase}`),
      ]),
    ]
    return {
      names,
      close,
      collect: async (runs: number) => {
        let got: globalThis.Record<string, Sample[]> = {}
        let add = (
          name: string,
          value: number,
          details?: unknown,
          counts?: globalThis.Record<string, number>,
        ) => (got[name] ??= []).push({ value, details, counts })
        for (let i = -1; i < runs; i++) {
          let body = `box door bench ${crypto.randomUUID()}`
          for (let [name, argv] of commands(body)) {
            let before = (await history()).length
            let t = await yak(argv)
            let calls = (await history()).slice(before).filter((r) =>
              r.method == 'tools/call'
            )
            if (name == 'write') await verify(body)
            if (i < 0) continue
            add(`door/${name}/wall`, t.ms, {
              requests: calls.map((r) => r.tool),
              by: PERSON,
              via: SESSION,
            }, { cpu: t.cpu, inputs: t.inputs })
            let main = calls.find((r) =>
              r.tool == (name == 'read' ? 'task_list' : 'comment_new')
            )
            if (!main) {
              throw new Error(`box door: no ${name} tools/call recorded`)
            }
            add(`door/${name}/server`, main.ms, {
              split: split(main.spans),
              spans: main.spans,
            })
          }
          if (i >= 0) {
            let start = performance.now()
            let roster = await cached(host, env.YAKS_HOME)
            let ms = performance.now() - start
            if (!roster) throw new Error('box door: warm roster was not cached')
            add('door/cache', ms, {
              tools: roster.tools.length,
              vocabulary: !!roster.vocab,
            })
          }
        }
        for (
          let [name, argv] of commands(`box door probe ${crypto.randomUUID()}`)
        ) {
          let out = `${scratch}/door-probe.json`
          let t = await timed(
            [`${ROOT}bench/box-door-probe.ts`, '--host', host, ...argv],
            { ...env, BOX_PROBE_OUT: out },
            perms,
          )
          let p = JSON.parse(await Deno.readTextFile(out))
          let m = p.marks
          let requests =
            (p.requests as { start: number; ms: number; preparation: number }[])
              .filter((r) => r.start >= m.runStart)
          let request = requests.reduce((sum, r) => sum + r.ms, 0)
          let phases = {
            boot: p.origin + m.boot - t.start,
            import: m.import - m.boot,
            setup: m.listStart - m.import,
            list: m.list - m.listStart,
            dispatch: m.runStart - m.list,
            request,
            preparation: requests.reduce((sum, r) => sum + r.preparation, 0),
            render: m.run - m.runStart - request,
            close: m.close - m.run,
            exit: t.end - p.origin - m.close,
            total: t.ms,
          }
          for (let [phase, ms] of Object.entries(phases)) {
            add(`door-startup/${name}/${phase}`, ms, { requests: p.requests })
          }
          if (name == 'write') await verify(argv.at(-1)!)
        }
        return got
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
