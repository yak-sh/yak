import { assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { ids, locked, store } from './harness.ts'
import { drain, WAIT } from './service.ts'
import { report } from './turn.ts'

let say = (path: string, event: string, sid: string, text: string) =>
  report({
    hook_event_name: event,
    session_id: sid,
    prompt: text,
    last_assistant_message: text,
  }, path)

let spooled = async (body: (path: string) => Promise<void>) => {
  let dir = Deno.makeTempDirSync()
  try {
    await body(`${dir}/turns.jsonl`)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
}

let c = (b: Bundle, name: string) => b[name] as Comp | undefined

// A session's transcript as [side, text] pairs, in entry order.
let told = async (g: ReturnType<typeof locked>, session: string) =>
  (await g.read(`.entry.session=${session}&.order=entry.seq&*`)).map((b) => [
    c(b, 'output') ? 'output' : 'input',
    c(b, 'content')?.body,
  ])

Deno.test('prompts and replies land in order, a new session under its own id', () =>
  spooled(async (path) => {
    let g = locked(store())
    say(path, 'UserPromptSubmit', 'fresh', 'fix it')
    say(path, 'Stop', 'fresh', 'fixed')
    say(path, 'UserPromptSubmit', 'one', 'and this')
    assertEquals(await drain(g, path), 3)
    let [s] = await g.read('.session.id=fresh&*')
    assertEquals(c(s, 'session')?.operator, true)
    assertEquals(await told(g, s.entity.eid), [
      ['input', 'fix it'],
      ['output', 'fixed'],
    ])
    assertEquals(await told(g, ids.run1), [['input', 'and this']])
    assertEquals(await drain(g, path), 0)
  }))

Deno.test('what a person typed is signed with them; a prompt not yet written down waits', () =>
  spooled(async (path) => {
    let g = locked(store())
    let transcript = `${path}.transcript`
    let written = (...kinds: string[]) =>
      Deno.writeTextFileSync(
        transcript,
        kinds.map((kind, i) =>
          JSON.stringify({ type: 'user', promptId: `p${i}`, origin: { kind } })
        ).join('\n'),
      )
    let ask = (text: string, i: number) =>
      report({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'one',
        prompt: text,
        transcript_path: transcript,
        prompt_id: `p${i}`,
      }, path)
    let signed = async () =>
      (await g.read(`.entry.session=${ids.run1}&.order=entry.seq&*`)).map((
        b,
      ) => [c(b, 'content')?.body, c(b, 'created')?.by])
    ask('typed', 0)
    ask('notified', 1)
    ask('typed too', 2)
    written('human', 'task-notification')
    assertEquals(await drain(g, path, ids.ada), 2)
    written('human', 'task-notification', 'human')
    assertEquals(await drain(g, path, ids.ada), 1)
    ask('never written', 3)
    assertEquals(await drain(g, path, ids.ada), 0)
    assertEquals(await drain(g, path, ids.ada, Date.now() + WAIT), 1)
    assertEquals(await signed(), [
      ['typed', ids.ada],
      ['notified', undefined],
      ['typed too', ids.ada],
      ['never written', undefined],
    ])
  }))

Deno.test('a line read twice writes nothing new', () =>
  spooled(async (path) => {
    let g = locked(store())
    say(path, 'UserPromptSubmit', 'one', 'once')
    let line = Deno.readTextFileSync(path)
    await drain(g, path)
    Deno.writeTextFileSync(path, line) // as if the trim never happened
    await drain(g, path)
    assertEquals(await told(g, ids.run1), [['input', 'once']])
  }))
