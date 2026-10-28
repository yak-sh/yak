/** Every installed lifecycle event through its real process or HTTP door.
 * Each sample has fresh session/claim/bus work, so an empty successful no-op
 * cannot stand in for creating context, delivering a notice or releasing work.
 * The fixture owns its graph, transcript directory, server and process homes.
 */
import { type Sample, type Samples, stopwatch } from '@yaks/benchmark'
import { compose } from '../packages/cli/host.ts'
import { read } from '../packages/cli/config.ts'
import { starter } from '../packages/cli/init.ts'
import { lifecycle } from '../packages/session/hooks.ts'
import { PATH } from '../packages/session/routes.ts'
import { settled } from './settled.ts'

export let HOOK_WAITS = [
  'hook/SessionStart',
  'hook/SubagentStart',
  'hook/SessionEnd',
  'hook/PostToolUse-delivery',
  'hook/PostToolUse-subagent',
]
let root = new URL('../', import.meta.url).pathname
let decoder = new TextDecoder()
export async function measure(
  args: string[] = [],
): Promise<Record<string, Samples>> {
  let n = Number(args[0] ?? 3)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('positive sample count required')
  }
  let dir = await Deno.makeTempDir({ prefix: 'T-127678-hooks-' })
  let configPath = `${dir}/yak.json`
  let person = crypto.randomUUID()
  let host: Awaited<ReturnType<typeof compose>> | undefined
  let server: Deno.HttpServer<Deno.NetAddr> | undefined
  let env = {
    TASKS_HOME: `${dir}/tasks`,
    HARNESS_HOME: `${dir}/harness`,
    HARNESS_WORKTREE_DIR: `${dir}/worktrees`,
    PROCESS_DIR: `${dir}/process`,
    YAK_RUNTIME_CACHE: `${dir}/runtime`,
    TASKS_SESSION: '',
    CLAUDE_CODE_SESSION_ID: '',
  }
  let cli = async (argv: string[], hook: object) => {
    let child = new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        '--config',
        `${root}deno.json`,
        `${root}packages/cli/yak.ts`,
        '--config',
        configPath,
        '--no-duties',
        ...argv,
      ],
      cwd: dir,
      env,
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
    let writer = child.stdin.getWriter()
    await writer.write(new TextEncoder().encode(JSON.stringify(hook)))
    await writer.close()
    let out = await child.output()
    if (!out.success) {
      throw new Error(`${argv.join(' ')}: ${decoder.decode(out.stderr)}`)
    }
    return decoder.decode(out.stdout)
  }
  let results: Record<string, Samples> = {}
  let timed = async (
    name: string,
    setup: () => Promise<() => Promise<void>>,
  ) => {
    let samples: Sample[] = []
    for (let i = 0; i < n; i++) {
      let run = await setup()
      let took = stopwatch()
      await run()
      samples.push({
        ...took(),
        source: 'end-to-end',
        counts: { claims: 1, pending: 1 },
        details: {
          fixture:
            'isolated starter SQLite; actual installed hook doors; duties disabled',
        },
      })
    }
    results[name] = samples
    console.error(name, JSON.stringify(samples))
  }
  try {
    await Deno.mkdir(`${dir}/transcripts`)
    let config = starter(person)
    config.db = `${dir}/yak.db`
    config.duties = false
    config.plugins!.push('@yaks/notify', {
      use: '@yaks/mail',
      with: { sender: { via: 'stash' } },
    })
    config.plugins = config.plugins?.map((p) =>
      p == '@yaks/session'
        ? { use: '@yaks/session', with: { transcripts: `${dir}/transcripts` } }
        : p
    )
    await Deno.writeTextFile(configPath, JSON.stringify(config))
    host = await compose(read(configPath), ['graph', 'web'])
    await settled(host)
    let graph = host.graph
    await graph.apply([{
      entity: { eid: person },
      person: {},
      doc: { title: 'Hook benchmark' },
    }])
    // Check the registration itself, not a guessed list of harness events.
    let installed = lifecycle()
    for (
      let event of [
        'SessionStart',
        'SubagentStart',
        'SessionEnd',
        'PostToolUse',
        'UserPromptSubmit',
      ]
    ) {
      if (!installed[event]) throw new Error(`hook not installed: ${event}`)
    }
    let fixture = async () => {
      let session = crypto.randomUUID(),
        task = crypto.randomUUID(),
        notice = crypto.randomUUID()
      let runner = `bench-${session}`
      let mark = `Hook work ${task}`
      await graph.apply([
        { entity: { eid: session }, session: { id: runner } },
        {
          entity: { eid: task },
          task: {},
          doc: { title: mark },
          claim: { session },
        },
        {
          entity: { eid: notice },
          knock: { target: session },
          doc: { body: `Hook delivery ${notice}` },
        },
      ])
      return { session, task, notice, runner, mark }
    }
    for (let event of ['SessionStart', 'SubagentStart']) {
      await timed(`hook/${event}`, async () => {
        let f = await fixture()
        return async () => {
          let out = await cli(['session', 'context', '--hook', '-'], {
            session_id: f.runner,
            hook_event_name: event,
            cwd: dir,
          })
          if (!out.includes('claimed') || !out.includes(f.mark)) {
            throw new Error(`missing held context: ${out}`)
          }
          let row = (await graph.get([f.session], ['session']))[0]
          if (!row?.session) throw new Error('session missing')
        }
      })
    }
    await timed('hook/SessionEnd', async () => {
      let f = await fixture()
      return async () => {
        await cli(['session', 'wrap', '--hook', '-'], {
          session_id: f.runner,
          hook_event_name: 'SessionEnd',
          cwd: dir,
        })
        let rows = await graph.get([f.session, f.task], ['session', 'claim'])
        if (
          !rows.some((r) =>
            r.entity.eid == f.session &&
            (r.session as Record<string, unknown>)?.ended == true
          ) || rows.some((r) => r.entity.eid == f.task && r.claim)
        ) throw new Error('SessionEnd did not end and release its claim')
      }
    })
    if (!host.handler) throw new Error('missing web handler')
    server = Deno.serve(
      { hostname: '127.0.0.1', port: 0, onListen() {} },
      host.handler,
    )
    let url = `http://127.0.0.1:${server.addr.port}${PATH}`
    let post = async (runner: string, subagent = false) => {
      let response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: runner,
          hook_event_name: 'PostToolUse',
          ...(subagent ? { agent_id: 'bench-child' } : {}),
        }),
      })
      let answer = await response.json()
      if (!response.ok) {
        throw new Error(
          `hook HTTP ${response.status}: ${JSON.stringify(answer)}`,
        )
      }
      return answer
    }
    await timed('hook/PostToolUse-delivery', async () => {
      let f = await fixture()
      return async () => {
        let answer = await post(f.runner)
        if (!JSON.stringify(answer).includes(`Hook delivery ${f.notice}`)) {
          throw new Error(`missing bus context: ${JSON.stringify(answer)}`)
        }
        if (!(await graph.get([f.notice], ['notified']))[0]?.notified) {
          throw new Error('delivery was not marked')
        }
      }
    })
    await timed('hook/PostToolUse-subagent', async () => {
      let f = await fixture()
      return async () => {
        let answer = await post(f.runner, true)
        if (
          Object.keys(answer).length ||
          (await graph.get([f.notice], ['notified']))[0]?.notified ||
          !(await graph.get([f.session], ['hooked']))[0]?.hooked
        ) throw new Error('subagent stole bus work or failed to mark hooked')
      }
    })
    return results
  } finally {
    await server?.shutdown()
    await host?.close()
    await Deno.remove(dir, { recursive: true })
  }
}
if (import.meta.main) console.log(JSON.stringify(await measure(Deno.args)))
