// Graph Session log projection tests hold the provider-neutral rendering and
// derived-state contract without a server, browser, or process transcript.
import { assertEquals, assertMatch } from '@std/assert'
import { type EntryRow, graphLog, graphLogPage } from './entry_log.ts'

let row = (
  eid: string,
  seq: number,
  comps: EntryRow['comps'],
): EntryRow => ({ eid, seq, comps })

Deno.test('graph log renders ordered calls, results, model, and usage', () => {
  let rows = [
    row('input', 1, {
      message: { role: 'user' },
      content: { body: 'do it' },
    }),
    row('generation', 2, {
      generation: {
        through: 'input',
        provider: 'codex',
        model: 'requested',
        serving_model: 'served',
      },
      usage: { input: 8, cached: 3, output: 5, reasoning: 2 },
      delivered: { at: 'now', via: 'runner:tasksd' },
    }),
    row('call', 3, {
      output: { source: 'generation' },
      call: { key: 'call-1' },
      bash: { command: 'printf yes' },
    }),
    row('result', 4, {
      result: { call: 'call' },
      content: { body: 'yes' },
      exit: { code: 0 },
    }),
    row('final', 5, {
      output: { source: 'generation' },
      message: { role: 'agent' },
      content: { body: 'done' },
    }),
  ]
  let log = graphLog(rows.toReversed())
  assertEquals(log.latest, 5)
  assertEquals(log.context, 8)
  assertEquals(log.model, 'served')
  assertEquals(log.busy, false)
  assertEquals(log.entries.map((entry) => entry.seq), [1, 2, 3, 4, 5])
  assertEquals(log.entries[1].row, {
    kind: 'turn',
    model: 'served',
    usage: JSON.stringify({
      input_tokens: 8,
      cached_input_tokens: 3,
      output_tokens: 5,
      reasoning_tokens: 2,
    }),
    context: 8,
  })
  assertEquals(log.entries[2].row, {
    kind: 'exec',
    command: 'printf yes',
    desc: 'Command',
  })
  assertEquals(log.entries[3].row, {
    kind: 'tool',
    name: '↳ shell',
    detail: 'yes',
    ok: true,
  })
  assertMatch(log.entries[4].line, /"message":\{"role":"agent"\}/)
})

Deno.test('graph log reports each request input as its context', () => {
  let rows = [
    row('first', 1, {
      generation: { model: 'gpt' },
      usage: { input: 8000, cached: 3000, output: 5, reasoning: 2 },
      delivered: { at: 'then' },
    }),
    row('second', 2, {
      generation: { model: 'gpt' },
      usage: { input: 21000, cached: 14000, output: 9, reasoning: 4 },
      delivered: { at: 'now' },
    }),
  ]
  assertEquals(
    graphLog(rows).entries.map((entry) =>
      entry.row?.kind == 'turn' ? entry.row.context : undefined
    ),
    [8000, 21000],
  )
})

Deno.test('graph log derives busy and pages by sequence', () => {
  let rows = [
    row('input', 1, { message: { role: 'user' } }),
    row('generation', 2, {
      generation: { through: 'input', provider: 'codex', model: 'asked' },
      lease: { holder: 'runner', at: 'a', until: 'b' },
    }),
    row('attention', 3, { attention: {} }),
  ]
  assertEquals(graphLog(rows).busy, true)
  assertEquals(
    graphLogPage(rows, new URLSearchParams('after=1')).entries.map((e) =>
      e.seq
    ),
    [2, 3],
  )
  assertEquals(
    graphLogPage(rows, new URLSearchParams('tail=2&limit=1')).entries.map((e) =>
      e.seq
    ),
    [2],
  )
})

Deno.test('output evidence without a lease is not ready twice', () => {
  let rows = [
    row('generation', 1, {
      generation: { through: 'input', provider: 'codex', model: 'asked' },
    }),
    row('output', 2, {
      output: { source: 'generation' },
      opaque: { format: 'openai:future', data: '{}' },
    }),
  ]
  assertEquals(graphLog(rows).busy, false)
})
