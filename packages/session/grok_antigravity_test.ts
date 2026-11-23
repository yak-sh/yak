// Grok Build and Antigravity CLI transcripts, written where each keeps them
// on a Mac, found and read by the same duty that reads Claude Code's and
// Codex's. The rows follow the shapes those CLIs were seen to write; no
// provider process is run.
import { line } from '@yaks/query'
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, type Comp, identityEid } from '@yaks/graph'
import { homes } from './files.ts'
import { look, type Seen } from './service.ts'
import { ids, locked, store } from './testing.ts'

let user = Deno.makeTempDirSync()
let env = { get: (name: string) => name == 'HOME' ? user : undefined }
let lines = (...rows: unknown[]) =>
  rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
let write = (path: string, text: string) => {
  Deno.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  Deno.writeTextFileSync(path, text)
}

let grokId = '0f4a52e1-6c1e-4c55-9a1b-1e7f3c0f5b10'
write(
  `${user}/.grok/sessions/%2FUsers%2Ferik%2Fapp/${grokId}/chat_history.jsonl`,
  lines(
    { type: 'system', content: 'You are Grok.' },
    { type: 'user', content: 'Why does the build fail?' },
    { type: 'reasoning', encrypted_content: 'opaque' },
    {
      type: 'assistant',
      content: 'Reading the config.',
      model_id: 'grok-4.6-build',
      tool_calls: [{
        id: 'call_7',
        name: 'read_file',
        arguments: '{"path":"deno.json"}',
      }],
    },
    { type: 'tool_result', tool_call_id: 'call_7', content: '{"tasks":{}}' },
    { type: 'assistant', content: 'No build task is defined.' },
  ),
)

let agyId = '7d2b9a40-31c8-4f4e-8f0e-5b8a1d6c2e93'
let step = (i: number, more: Record<string, unknown>) => ({
  step_index: i,
  created_at: `2026-11-23T10:00:0${i}.000Z`,
  ...more,
})
write(
  `${user}/.gemini/antigravity-cli/brain/${agyId}/.system_generated/logs/transcript_full.jsonl`,
  lines(
    step(0, {
      type: 'USER_INPUT',
      source: 'USER_EXPLICIT',
      content: 'List the tests',
    }),
    step(1, {
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      thinking: 'Find test files.',
      content: 'Searching.',
      tool_calls: [
        { name: 'find_by_name', args: { Pattern: '*_test.ts' } },
        { name: 'view_file', args: { AbsolutePath: '/w/a_test.ts' } },
      ],
    }),
    step(2, {
      type: 'GENERIC',
      source: 'MODEL',
      status: 'DONE',
      content: 'a_test.ts',
    }),
    step(3, {
      type: 'GENERIC',
      source: 'MODEL',
      status: 'ERROR',
      content: 'denied',
    }),
    step(4, {
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      content: 'One test file.',
    }),
  ),
)

let found = await homes([], true, env)
let g = locked(store())
await look(g, found, { tails: new Map(), done: new Set() } as Seen, {
  person: ids.ada,
  slice: Infinity,
  budget: Infinity,
})
let transcript = async (id: string) => {
  let [s] = await g.read(line`.session.id=${id} ?session`)
  return await g.read(
    line`.entry.session=${s.entity.eid} .order=entry.seq *`,
  )
}
let body = (b: Bundle) => (b.content as Comp | undefined)?.body
let kind = (b: Bundle) =>
  b.call
    ? `call ${(b.call as Comp).id}`
    : b.result
    ? `result ${body(b)}`
    : b.using
    ? 'using'
    : b.output
    ? `${b.reasoning ? 'thought' : 'said'} ${body(b)}`
    : `typed ${body(b)}`

test('Grok and Antigravity accounts are found where each CLI keeps them on a Mac', () => {
  assertEquals(found.map((h) => h.runner).sort(), ['antigravity', 'grok'])
})

test("A Grok session's history is read into its session, each result naming its call", async () => {
  let rows = await transcript(grokId)
  assertEquals(rows.map(kind), [
    'using',
    'typed Why does the build fail?',
    'said Reading the config.',
    'call call_7',
    'result {"tasks":{}}',
    'said No build task is defined.',
  ])
  let call = rows.find((b) => b.call)!
  assertEquals((call.call as Comp).args, { path: 'deno.json' })
  assertEquals((call.call as Comp).to, identityEid('tool', ['read_file']))
  assertEquals(
    (rows.find((b) => b.result)!.result as Comp).call,
    call.entity.eid,
  )
  assertEquals((rows[1].created as Comp).by, ids.ada)
})

test("An Antigravity conversation's steps are read in, each outcome answering its call", async () => {
  let rows = await transcript(agyId)
  assertEquals(rows.map(kind), [
    'using',
    'typed List the tests',
    'thought Find test files.',
    'said Searching.',
    'call step-2',
    'call step-3',
    'result a_test.ts',
    'result denied',
    'said One test file.',
  ])
  let calls = rows.filter((b) => b.call)
  let results = rows.filter((b) => b.result)
  assertEquals(
    results.map((b) => (b.result as Comp).call),
    calls.map((b) => b.entity.eid),
  )
  assertEquals((calls[1].call as Comp).args, { AbsolutePath: '/w/a_test.ts' })
  assertEquals(results.map((b) => !!b.refusal), [false, true])
  assertEquals((rows[1].created as Comp).at, '2026-11-23T10:00:00.000Z')
})
