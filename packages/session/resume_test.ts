// A Grok conversation opened in Claude Code: written where Claude Code keeps
// its transcripts, under the session's own id, and what Claude Code adds
// after it read back into the same session. No harness process is run.
import { line } from '@yaks/query'
import { test } from '@yaks/testing'
import { assertEquals, assertMatch } from '@std/assert'
import { type Bundle, type Comp, identityEid } from '@yaks/graph'
import { homes } from './files.ts'
import { look, type Seen } from './service.ts'
import { ids, locked, store } from './testing.ts'
import { openInClaude, projectDir } from './resume.ts'

let user = Deno.makeTempDirSync()
let env = { get: (name: string) => name == 'HOME' ? user : undefined }
let account = `${user}/.claude`
let jsonl = (...rows: unknown[]) =>
  rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
let write = (path: string, text: string) => {
  Deno.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  Deno.writeTextFileSync(path, text)
}

let grokId = '0f4a52e1-6c1e-4c55-9a1b-1e7f3c0f5b10'
write(
  `${user}/.grok/sessions/%2Fw/${grokId}/chat_history.jsonl`,
  jsonl(
    { type: 'user', content: 'Why does the build fail?' },
    {
      type: 'assistant',
      content: 'Reading the config.',
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
Deno.mkdirSync(`${account}/projects`, { recursive: true })

let g = locked(store())
// Each look lists the transcripts afresh, as a later pass of the duty does.
let read = async () =>
  await look(g, await homes([], true, env), {
    tails: new Map(),
    done: new Set(),
  } as Seen, {
    person: ids.ada,
    slice: Infinity,
    budget: Infinity,
  })
await read()
let [grok] = await g.read(line`.session.id=${grokId} ?session`)
let session = grok.entity.eid
let said = async () =>
  (await g.read(line`.entry.session=${session} .order=entry.seq *`))
    .flatMap((b: Bundle) => {
      let body = (b.content as Comp | undefined)?.body
      return b.call ? [`call ${(b.call as Comp).name}`] : body ? [body] : []
    })

let first = await openInClaude(g, session, { account, cwd: '/w' })
let path = `${projectDir(account, '/w')}/${session}.jsonl`
let written = Deno.readTextFileSync(path).trim().split('\n')
  .map((l) => JSON.parse(l))

test('a Grok conversation is written as a Claude Code transcript under its own id', () => {
  assertEquals(first, { path, cwd: '/w', written: 6 })
  assertEquals(
    written.map((l) => [l.type, l.sessionId, l.cwd]),
    Array(6).fill(0).map((_, i) => [
      ['user', 'assistant', 'assistant', 'user', 'assistant', 'user'][i],
      session,
      '/w',
    ]),
  )
  assertEquals(written[2].message.content[0], {
    type: 'tool_use',
    id: 'call_7',
    name: 'read_file',
    input: { path: 'deno.json' },
  })
  assertEquals(written[3].message.content[0].tool_use_id, 'call_7')
  assertEquals(
    written.slice(1).map((l) => l.parentUuid),
    written.slice(0, -1).map((l) => l.uuid),
  )
  assertMatch(written[5].message.content, /another model takes it over now/)
})

// Claude Code resumes it and appends a turn of its own.
let last = written.at(-1).uuid
Deno.writeTextFileSync(
  path,
  jsonl({
    type: 'user',
    uuid: 'c1',
    parentUuid: last,
    sessionId: session,
    message: { role: 'user', content: 'Add one.' },
  }),
  { append: true },
)
await read()
let after = await said()

test('what Claude Code adds is read into the same session, and nothing written from it again', () => {
  assertEquals(after, [
    'Why does the build fail?',
    'Reading the config.',
    'call read_file',
    '{"tasks":{}}',
    'No build task is defined.',
    'Add one.',
  ])
})

let again = await openInClaude(g, session, { account })

test('opening it again writes nothing the file holds', () => {
  assertEquals(again, { path, cwd: '/w', written: 0 })
})

await g.apply([{
  entity: { eid: 'native-1' },
  entry: { session },
  content: { body: 'Added a build task.' },
  output: { source: session },
}])
let back = await openInClaude(g, session, { account })
let tail = Deno.readTextFileSync(path).trim().split('\n').slice(-2)
  .map((l) => JSON.parse(l))

test('what another model said since is written after the last line, with the note', () => {
  assertEquals(back.written, 2)
  assertEquals(tail[0].parentUuid, 'c1')
  assertEquals(tail[0].message.content, [{
    type: 'text',
    text: 'Added a build task.',
  }])
  assertEquals(tail[1].type, 'user')
})

// A Claude Code session another model took over here (`session_send` names
// the model on an entry of its own) is still read from its file.
let ccId = '5d0c8f3e-2b7a-4f19-9c6e-0a1b2c3d4e5f'
let ccPath = `${projectDir(account, '/w')}/${ccId}.jsonl`
let typed = (uuid: string, content: string) => ({
  type: 'user',
  uuid,
  sessionId: ccId,
  origin: { kind: 'human' },
  message: { role: 'user', content },
})
write(ccPath, jsonl(typed('t1', 'First.')))
await read()
let codex = identityEid('provider', ['codex'])
await g.apply([{ entity: { eid: codex }, provider: { name: 'codex' } }, {
  entity: { eid: 'taken' },
  entry: { session: ccId },
  content: { body: 'Go on.' },
  using: { provider: codex },
}])
Deno.writeTextFileSync(ccPath, jsonl(typed('t2', 'Back here.')), {
  append: true,
})
await read()
let taken = (await g.read(line`.entry.session=${ccId} .order=entry.seq *`))
  .map((b) => (b.content as Comp | undefined)?.body).filter(Boolean)

test('a Claude Code session another model took over is still read from its file', () => {
  assertEquals(taken, ['First.', 'Go on.', 'Back here.'])
})
