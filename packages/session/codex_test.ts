// Synthetic rollouts exercise the same bounded discovery and importer as the
// duty. No provider process or private transcript is needed to read one.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, type Comp, type Graph, identityEid } from '@yaks/graph'
import { codexRollout } from './readers.ts'
import { look, type Seen } from './service.ts'
import { transcriptOf } from './tail.ts'
import { ids, locked, store } from './testing.ts'

let id = '4f19e945-0430-4570-9f94-43b07b7eddd0'
let child = '450e0240-5832-40f2-93bb-e99bad190334'
let at = '2026-10-19T15:00:00.000Z'
let event = (type: string, payload: Record<string, unknown>) => ({
  type,
  timestamp: at,
  payload,
})
let item = (type: string, more: Record<string, unknown>) =>
  event('response_item', { type, ...more })
let message = (role: string, text: string, kind?: string) =>
  item('message', {
    role,
    content: [{ type: 'input_text', text }],
    ...(kind
      ? {
        internal_chat_message_metadata_passthrough: {
          content_item_kinds: [kind],
        },
      }
      : {}),
  })
let encode = (...lines: unknown[]) =>
  lines.map((x) => JSON.stringify(x)).join('\n') + '\n'
let metadata = (id: string, parent?: string) =>
  event('session_meta', {
    id,
    cwd: '/work',
    source: parent
      ? { subagent: { thread_spawn: { parent_thread_id: parent } } }
      : 'cli',
  })
let seen = (): Seen => ({ tails: new Map(), done: new Set() })
let dir = Deno.makeTempDirSync()
Deno.mkdirSync(`${dir}/2026/10/19`, { recursive: true })
let path = (id: string) =>
  `${dir}/2026/10/19/rollout-2026-10-19T15-00-00-${id}.jsonl`
// A look at the rollouts given all the time it needs: these cases check what a
// read writes, and how looks share their time is service_test.ts's.
let read = (graph: Graph, seen: Seen, o: Parameters<typeof look>[3] = {}) =>
  look(graph, '', seen, {
    codex: dir,
    slice: Infinity,
    budget: Infinity,
    ...o,
  })
let g = locked(store())
let resumed = locked(store())
let childGraph = locked(store())
let managedGraph = locked(store())
let history = locked(store())
let provider = identityEid('provider', ['codex'])
await managedGraph.apply([
  { entity: { eid: id }, session: { id } },
  {
    entity: { eid: provider },
    provider: { name: 'codex', transport: 'process' },
  },
  {
    entity: { eid: 'asked' },
    entry: { session: id },
    using: { provider },
    content: { body: 'managed input' },
  },
])
Deno.writeTextFileSync(
  path(id),
  encode(
    metadata(id),
    message('developer', 'the instructions'),
    message('user', 'the environment', 'environments.environment_context'),
    message('user', 'help me', 'user.text'),
    event('event_msg', { type: 'user_message', message: 'help me' }),
    event('turn_context', { model: 'gpt-6.1-sol', effort: 'high' }),
    item('reasoning', {
      summary: [{ type: 'summary_text', text: 'thinking' }],
    }),
    item('function_call', {
      name: 'exec',
      namespace: 'functions',
      call_id: 'call_1',
      arguments: '{"cmd":"ls"}',
    }),
    item('function_call_output', { call_id: 'call_1', output: 'file.ts' }),
    message('assistant', 'done'),
    event('event_msg', { type: 'agent_message', message: 'done' }),
    event('event_msg', { type: 'task_complete' }),
  ),
)
let rows = async (graph: typeof g) =>
  await graph.read(`.entry.session=${id} .order=entry.seq *`)
let body = (b: Bundle) => (b.content as Comp | undefined)?.body

// Prepare the resumable case outside its timed operation.
let first = seen()
await read(resumed, first, { person: ids.ada, slice: 0 })
let firstCount = (await rows(resumed)).length
await read(g, seen(), { person: ids.ada })
let imported = await rows(g)

test('Codex rollout messages retain roles, calls, timestamps and runner identity', () => {
  assertEquals(imported.filter((b) => b.content).map(body), [
    'the instructions',
    'the environment',
    'help me',
    'thinking',
    'file.ts',
    'done',
  ])
  let human = imported.find((b) => body(b) == 'help me')!
  assertEquals((human.created as Comp).by, ids.ada)
  assertEquals((human.created as Comp).at, at)
  assertEquals(imported.find((b) => body(b) == 'the environment')!.notice, {})
  assertEquals(imported.find((b) => body(b) == 'thinking')!.reasoning, {})
  let call = imported.find((b) => b.call)!
  assertEquals((call.call as Comp).id, 'call_1')
  assertEquals(
    (imported.find((b) => b.result)!.result as Comp).call,
    call.entity.eid,
  )
  assertEquals(imported.filter((b) => b.using).map((b) => b.using), [
    { provider },
    { provider, model: identityEid('model', ['gpt-6.1-sol']), effort: 'high' },
  ])
})

await read(resumed, seen(), { person: ids.ada })
let resumedRows = await rows(resumed)
let transcript = await transcriptOf(resumed, path(id))
await read(resumed, seen(), { person: ids.ada })
let replayed = await rows(resumed)
await read(managedGraph, seen())
let managedRows = await rows(managedGraph)

test('Codex rollout resumes partial consumption across importer restart without duplicates', () => {
  assertEquals(firstCount, 1)
  assertEquals(
    resumedRows.map((b) => b.entity.eid),
    imported.map((b) => b.entity.eid),
  )
  assertEquals(
    replayed.map((b) => b.entity.eid),
    imported.map((b) => b.entity.eid),
  )
  assertEquals(transcript?.consumed, 12)
})

test('Codex rollout of a managed thread leaves its stdout transcript alone', () => {
  assertEquals(managedRows.map(body), ['managed input'])
})

test('Codex tool inputs and outputs scrub credentials while custom tool text survives', () => {
  assertEquals(
    codexRollout(item('custom_tool_call', {
      name: 'apply_patch',
      call_id: 'patch',
      input: '*** Begin Patch\ntoken=ghp_0123456789abcdef',
    })).entries,
    [{
      call: {
        to: 'apply_patch',
        id: 'patch',
        args: {
          input: '*** Begin Patch\ntoken=[redacted]',
        },
      },
    }],
  )
  assertEquals(
    codexRollout(item('custom_tool_call_output', {
      call_id: 'patch',
      output: 'Authorization: Bearer abc.def',
    })).entries[0].content,
    { body: 'Authorization: [redacted]' },
  )
})

// Finish fixture consumers before removing their directory, independently of
// test ordering (the runner can select individual cases).
Deno.writeTextFileSync(
  path(child),
  encode(
    metadata(child, id),
    metadata(id),
    message('user', 'delegated prompt', 'user.text'),
    item('agent_message', {
      author: '/root/peer',
      recipient: '/root',
      content: [{ type: 'text', text: 'peer report' }],
    }),
    message('assistant', 'child answer'),
  ),
)
let childSeen = seen()
await read(childGraph, childSeen, { person: ids.ada })
Deno.writeTextFileSync(
  path(child),
  encode(message('user', 'follow-up delegation', 'user.text')),
  { append: true },
)
await read(childGraph, childSeen, { person: ids.ada })
let [childRow] = await childGraph.get([child])
let stamps = async () =>
  (await childGraph.get([id, child])).map((b) => b.updated)
let stamped = await stamps()
await read(childGraph, seen(), { person: ids.ada })
let restamped = await stamps()
let childEntries = await childGraph.read(`.entry.session=${child} *`)
Deno.utimeSync(path(id), new Date(0), new Date(0))
// A month on, both rollouts are old. A look reads one old rollout, whichever
// the filesystem lists first (tmpfs lists the newest file first), so two
// looks read both.
let backfill = seen(), later = Date.now() + 30 * 86400000
await read(history, backfill, { now: later })
await read(history, backfill, { now: later })
let old = await rows(history)

test('Codex children retain thread identities and never attribute a delegated prompt to the owner', () => {
  assertEquals((childRow.session as Comp)?.id, child)
  assertEquals((childRow.spawned as Comp)?.parent, id)
  assertEquals((childRow.session as Comp)?.operator, false)
  assertEquals(
    childEntries.find((b) => body(b) == 'delegated prompt')!.notice,
    {},
  )
  assertEquals(childEntries.find((b) => body(b) == 'peer report')!.notice, {})
  assertEquals(
    childEntries.find((b) => body(b) == 'follow-up delegation')!.notice,
    {},
  )
})

test('Codex rollouts opened again by a new importer leave their sessions unwritten', () => {
  assertEquals(restamped, stamped)
})

test('old Codex rollouts backfill prose through the existing bounded importer', () => {
  assertEquals(old.filter((b) => b.content).map(body), ['help me', 'done'])
  assertEquals(old.filter((b) => b.using).length, 2)
})

Deno.removeSync(dir, { recursive: true })
