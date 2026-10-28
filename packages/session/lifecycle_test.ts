// The HTTP lifecycle door records through the same runner as the CLI.
import type { Comp } from '@yaks/graph'
import { equal, test } from '@yaks/testing'
import { compose } from '../cli/host.ts'
import { registry, show } from '../cli/answer.ts'
import { used } from '../cli/config.ts'
import { routes } from './routes.ts'
import { sessionEid } from './who.ts'

let host = await compose({
  db: ':memory:',
  duties: false,
  plugins: [
    '@yaks/kernel',
    '@yaks/provenance',
    '@yaks/id',
    '@yaks/doc',
    '@yaks/process',
    '@yaks/tools',
    '@yaks/task',
    '@yaks/session',
  ],
}, ['graph', 'web'])
let views = await registry((host.config.plugins ?? []).map(used))
let prior: string[] = []
let render = host.text!
host.text = async (answer, wrote) => {
  let lines: string[] = []
  await show(
    { tui: false, out: (s) => lines.push(s) },
    views,
    host.vocab,
    answer,
    {},
    { lookup: (ids) => host.graph.get(ids), query: (q) => host.graph.read(q) },
    wrote,
  )
  prior.push(lines.join('\n'))
  return render(answer, wrote)
}
let door = routes(host).find((r) => r.path == '/session/hook')!
let run = async (hook: object) => {
  let response = await door.handle(
    new Request('http://hooks/session/hook', {
      method: 'POST',
      body: JSON.stringify(hook),
    }),
  )
  let raw = await response.text()
  return { status: response.status, body: JSON.parse(raw) }
}
let session = crypto.randomUUID(), task = crypto.randomUUID()
await host.graph.apply([
  { entity: { eid: session }, session: { id: session, ended: true } },
  {
    entity: { eid: task },
    task: {},
    doc: { title: 'held work' },
    claim: { session },
  },
])
let start = await run({ hook_event_name: 'SessionStart', session_id: session })
let resumed = (await host.graph.get([session], ['session']))[0]
let child = 'test-child'
let sub = await run({
  hook_event_name: 'SubagentStart',
  session_id: session,
  agent_id: child,
})
let spawned =
  (await host.graph.get([sessionEid(child, session)], ['session', 'spawned']))[
    0
  ]
let end = await run({ hook_event_name: 'SessionEnd', session_id: session })
let ended = (await host.graph.get([session], ['session']))[0]
let held = (await host.graph.get([task], ['claim']))[0]
let calls = await host.graph.read('.call *')
let malformed = await run([])
await host.close()

test('HTTP start resumes the session and returns its claims as context', () => {
  equal(start.status, 200)
  equal(start.body.hookSpecificOutput.hookEventName, 'SessionStart')
  equal(
    start.body.hookSpecificOutput.additionalContext.includes('held work'),
    true,
  )
  equal(
    start.body.hookSpecificOutput.additionalContext.includes('claimed'),
    true,
  )
  equal((resumed.session as Comp)?.ended, undefined)
})
test('HTTP subagent start creates a separate session and names its parent', () => {
  equal(sub.status, 200)
  equal((spawned.session as Comp)?.id, child)
  equal((spawned.spawned as Comp)?.parent, session)
  equal(sub.body.hookSpecificOutput.hookEventName, 'SubagentStart')
})
test('HTTP end records the session ended and releases its claims', () => {
  equal(end, { status: 200, body: {} })
  equal((ended.session as Comp)?.ended, true)
  equal(held?.claim, undefined)
})
test('HTTP lifecycle events keep the tool call records', () => {
  equal(calls.length, 3)
})
test('start and subagent context retain the CLI renderer output exactly', () => {
  equal(start.body.hookSpecificOutput.additionalContext, prior[0])
  equal(sub.body.hookSpecificOutput.additionalContext, prior[1])
})
test('the lifecycle door refuses non-object hook payloads', () => {
  equal(malformed.status, 400)
})
