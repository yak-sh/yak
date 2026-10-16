import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { promptContext, promptHook, promptTiming } from './prompt.ts'

let now = new Date('2026-10-16T15:00:00Z')
let ended = '2026-10-16T14:58:00.000Z'
let queued = '2026-10-16T14:57:00.000Z'
let jsonl = (...rows: unknown[]) =>
  rows.map((r) => JSON.stringify(r)).join('\n')
let reply = (at = ended, stop = 'end_turn') => ({
  type: 'assistant',
  timestamp: at,
  message: { stop_reason: stop },
})
let enqueue = {
  type: 'queue-operation',
  operation: 'enqueue',
  timestamp: queued,
  content: 'hi',
}
let hook = { hook_event_name: 'UserPromptSubmit', prompt: 'hi' }

// Queue time is earlier than the reply: the very distinction the context
// must retain, even when the hook is run after that reply finishes.
test('prompt timing retains a submission made while the previous reply arrived', () => {
  assertEquals(
    promptTiming(hook, jsonl(enqueue, reply()), now),
    `Prompt sent: ${queued}; previous reply ended: ${ended}.`,
  )
})

test('tools and sidechains cannot finish the previous reply', () => {
  let text = jsonl(
    reply(),
    reply('2026-10-16T14:59:00Z', 'tool_use'),
    { ...reply('2026-10-16T14:59:30Z'), isSidechain: true },
  ) + '\n{"type":"assistant",'
  assertEquals(
    promptTiming(hook, text, now),
    `Prompt observed: ${now.toISOString()}; previous reply ended: ${ended}.`,
  )
})

test('prompt ids select this submission rather than repeated text', () => {
  assertEquals(
    promptTiming(
      { ...hook, prompt_id: 'current' },
      jsonl(
        enqueue,
        { type: 'user', promptId: 'old', timestamp: queued },
        reply(),
        { type: 'user', promptId: 'current', timestamp: now.toISOString() },
      ),
      now,
    ),
    `Prompt sent: ${now.toISOString()}; previous reply ended: ${ended}.`,
  )
})

test('a consumed queue item is not the next identical submission', () => {
  assertEquals(
    promptTiming(
      hook,
      jsonl(
        enqueue,
        { type: 'user', timestamp: queued },
        reply(),
      ),
      now,
    ),
    `Prompt observed: ${now.toISOString()}; previous reply ended: ${ended}.`,
  )
})

test('a first prompt reports an unknown reply without inventing times', () => {
  assertEquals(
    promptTiming(
      { ...hook, timestamp: queued },
      jsonl(
        null,
        { ...reply(), timestamp: 'not a date' },
      ),
      now,
    ),
    `Prompt observed: ${now.toISOString()}; previous reply ended: unknown.`,
  )
})

let path = Deno.makeTempFileSync()
Deno.writeTextFileSync(path, jsonl(enqueue, reply()))
let large = Deno.makeTempFileSync()
Deno.writeTextFileSync(
  large,
  'x'.repeat(1024 * 1024 + 5) + '\n' + jsonl(reply()),
)

test('the hook reads its local transcript as one short context line', () => {
  assertEquals(
    promptContext({ ...hook, transcript_path: path }, now),
    `Prompt sent: ${queued}; previous reply ended: ${ended}.`,
  )
})

test('the bounded tail drops its partial first record', () => {
  assertStringIncludes(
    promptContext({ ...hook, transcript_path: large }, now),
    `previous reply ended: ${ended}.`,
  )
})

test('missing transcripts and malformed hook payloads are silent', () => {
  assertEquals(promptContext({ transcript_path: `${path}.missing` }, now), '')
  assertEquals(promptContext({}, now), '')
  assertEquals(promptHook('{'), undefined)
  assertEquals(promptHook('null'), undefined)
  assertEquals(promptHook('{"hook_event_name":"SessionStart"}'), undefined)
  assertEquals(promptHook(JSON.stringify(hook)), hook)
})

test('cancelled queued prompts and other sessions do not supply sent times', () => {
  assertEquals(
    promptTiming(
      { ...hook, session_id: 'ours' },
      jsonl(
        enqueue,
        { ...enqueue, operation: 'remove' },
        { ...enqueue, sessionId: 'theirs' },
        { ...reply(), sessionId: 'theirs' },
      ),
      now,
    ),
    `Prompt observed: ${now.toISOString()}; previous reply ended: unknown.`,
  )
})

test('a queued submission keeps its sent time when recorded later as a user turn', () => {
  assertEquals(
    promptTiming(
      { ...hook, prompt_id: 'current' },
      jsonl(
        enqueue,
        reply(),
        { type: 'user', promptId: 'current', timestamp: now.toISOString() },
      ),
      now,
    ),
    `Prompt sent: ${queued}; previous reply ended: ${ended}.`,
  )
})
