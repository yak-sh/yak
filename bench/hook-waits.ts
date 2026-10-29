/** Lifecycle HTTP handlers in process, without listeners or child processes.
 * Each sample has fresh session/claim/bus work, so an empty successful no-op
 * cannot stand in for creating context, delivering a notice or releasing work.
 * This excludes the installed shell/curl transport; its CPU is measured live.
 * The fixture owns its graph and transcript directory.
 */
import type { Comp } from '@yaks/graph'
import { type Sample, type Samples, stopwatch } from '@yaks/benchmark'
import { compose } from '../packages/cli/host.ts'
import { read } from '../packages/cli/config.ts'
import { starter } from '../packages/cli/init.ts'
import { lifecycle } from '../packages/session/hooks.ts'
import { sessionEid } from '../packages/session/who.ts'
import { PATH } from '../packages/session/routes.ts'
import { selected } from './selected.ts'

export let HOOK_WAITS = [
  'hook/SessionStart',
  'hook/SubagentStart',
  'hook/SessionEnd',
  'hook/PostToolUse-delivery',
  'hook/PostToolUse-subagent',
]
export async function measure(
  args: string[] = [],
): Promise<Record<string, Samples>> {
  let n = Number(args[0] ?? 1)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('positive sample count required')
  }
  let dir = await Deno.makeTempDir({ prefix: 'T-127678-hooks-' })
  let configPath = `${dir}/yak.json`
  let person = crypto.randomUUID()
  let host: Awaited<ReturnType<typeof compose>> | undefined
  let results: Record<string, Samples> = {}
  let timed = async (
    name: string,
    setup: () => Promise<() => Promise<void>>,
  ) => {
    if (!selected(name)) return
    let samples: Sample[] = []
    for (let i = 0; i < n; i++) {
      let run = await setup()
      let took = stopwatch()
      await run()
      samples.push({
        ...took(),
        source: 'in-process-handler',
        counts: { claims: 1, pending: 1 },
        details: {
          fixture:
            'isolated starter SQLite; in-process HTTP handler; no shell or socket; duties disabled',
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
    config.plugins = config.plugins?.filter((p) =>
      !['@yaks/web', '@yaks/browse', '@yaks/canvas'].includes(String(p))
    )
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
    if (!host.handler) throw new Error('missing web handler')
    let post = async (hook: object) => {
      let response = await host!.handler!(
        new Request(`http://hooks${PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(hook),
        }),
      )
      let answer = await response.json()
      if (!response.ok) {
        throw new Error(
          `hook HTTP ${response.status}: ${JSON.stringify(answer)}`,
        )
      }
      return answer
    }
    let send = (runner: string, subagent = false) =>
      post({
        session_id: runner,
        hook_event_name: 'PostToolUse',
        ...(subagent ? { agent_id: 'bench-child' } : {}),
      })
    // Warm each handler before its samples, as on the long-running server.
    for (let event of ['SessionStart', 'SubagentStart', 'SessionEnd']) {
      if (!selected(`hook/${event}`)) continue
      for (let i = 0; i < 5; i++) {
        let f = await fixture()
        await post({
          session_id: f.runner,
          hook_event_name: event,
          cwd: dir,
          ...(event == 'SubagentStart' ? { agent_id: 'bench-child' } : {}),
        })
      }
      await timed(`hook/${event}`, async () => {
        let f = await fixture()
        return async () => {
          let answer = await post({
            session_id: f.runner,
            hook_event_name: event,
            cwd: dir,
            ...(event == 'SubagentStart' ? { agent_id: 'bench-child' } : {}),
          })
          if (event == 'SubagentStart') {
            let [child] = await graph.get(
              [sessionEid('bench-child', f.runner)],
              ['session', 'spawned'],
            )
            if (
              (child?.spawned as Comp)?.parent != f.session ||
              !JSON.stringify(answer).includes('bench-child')
            ) {
              throw new Error(
                'SubagentStart did not create and return its child session',
              )
            }
          } else if (event == 'SessionStart') {
            let out = JSON.stringify(answer)
            if (!out.includes('claimed') || !out.includes(f.mark)) {
              throw new Error(`missing held context: ${out}`)
            }
          } else {
            let rows = await graph.get([f.session, f.task], [
              'session',
              'claim',
            ])
            if (
              !rows.some((r) =>
                r.entity.eid == f.session && (r.session as Comp)?.ended == true
              ) ||
              rows.some((r) => r.entity.eid == f.task && r.claim)
            ) throw new Error('SessionEnd did not end and release its claim')
          }
        }
      })
    }
    // The door a person's tool calls reach is a `yak serve` that has answered
    // many. A fresh host's first requests compile the door's code (about
    // 70 ms, then 20, then steady), which is no wait anyone has twice, so
    // they are spent before timing.
    for (let i = 0; i < 5; i++) {
      let f = await fixture()
      if (selected('hook/PostToolUse-delivery')) await send(f.runner)
      if (selected('hook/PostToolUse-subagent')) await send(f.runner, true)
    }
    await timed('hook/PostToolUse-delivery', async () => {
      let f = await fixture()
      return async () => {
        let answer = await send(f.runner)
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
        let answer = await send(f.runner, true)
        if (
          Object.keys(answer).length ||
          (await graph.get([f.notice], ['notified']))[0]?.notified ||
          !(await graph.get([f.session], ['hooked']))[0]?.hooked
        ) throw new Error('subagent stole bus work or failed to mark hooked')
      }
    })
    return results
  } finally {
    await host?.close()
    await Deno.remove(dir, { recursive: true })
  }
}
if (import.meta.main) console.log(JSON.stringify(await measure(Deno.args)))
