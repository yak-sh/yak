import { assertEquals } from '@std/assert'
import { report, spoolOf, taken, trim, turnOf } from './turn.ts'

let prompt = (text: string, sid = 's1') => ({
  hook_event_name: 'UserPromptSubmit',
  session_id: sid,
  prompt: text,
})
let stop = (text: string, sid = 's1') => ({
  hook_event_name: 'Stop',
  session_id: sid,
  last_assistant_message: text,
})

let spooled = (body: (path: string) => void) => {
  let dir = Deno.makeTempDirSync()
  try {
    body(`${dir}/spool/turns.jsonl`)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
}

Deno.test('a prompt is an input, a stop is an output, the rest is nothing', () => {
  assertEquals(turnOf(prompt('hi'), 'T'), { sid: 's1', at: 'T', input: 'hi' })
  assertEquals(turnOf(stop('done'), 'T'), {
    sid: 's1',
    at: 'T',
    output: 'done',
  })
  assertEquals(
    turnOf({ hook_event_name: 'SessionStart', session_id: 's1' }),
    undefined,
  )
  assertEquals(turnOf(prompt('')), undefined)
  assertEquals(turnOf(stop('hi', '')), undefined)
})

Deno.test('a prompt keeps where its harness writes it down, and under what id', () => {
  let where = { transcript_path: '/t.jsonl', prompt_id: 'p1' }
  assertEquals(turnOf({ ...prompt('hi'), ...where }, 'T'), {
    sid: 's1',
    at: 'T',
    input: 'hi',
    transcript: '/t.jsonl',
    promptId: 'p1',
  })
  assertEquals(
    turnOf({ ...stop('done'), ...where }, 'T')?.transcript,
    undefined,
  )
})

Deno.test('the spool sits beside the database, and a memory graph has none', () => {
  assertEquals(spoolOf('/h/.yak/yak.db'), '/h/.yak/spool/turns.jsonl')
  assertEquals(spoolOf(':memory:'), undefined)
  assertEquals(spoolOf(undefined), undefined)
})

Deno.test('lines come back in order, and a trim keeps what arrived since', () =>
  spooled((path) => {
    report(prompt('one\ntwo'), path)
    report(stop('three'), path)
    let { turns, ends, bytes } = taken(path)
    assertEquals(turns.map((t) => t.input ?? t.output), ['one\ntwo', 'three'])
    assertEquals(ends.at(-1), bytes)
    report(prompt('four'), path)
    trim(path, ends[0])
    assertEquals(taken(path).turns.map((t) => t.input ?? t.output), [
      'three',
      'four',
    ])
  }))

Deno.test('a spool nobody wrote is empty', () =>
  spooled((path) =>
    assertEquals(taken(path), { turns: [], ends: [], bytes: 0 })
  ))
