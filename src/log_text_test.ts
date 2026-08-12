// The shared log→text renderer: every LogRow kind reads as one legible line,
// a rowless machinery entry is dropped (not dumped as raw JSON), and the sift
// screens by seq, prose and time.
import { assertEquals } from '@std/assert'
import {
  type LogEntry,
  renderEntry,
  renderRow,
  transcribe,
} from './log_text.ts'

Deno.test('every row kind renders one legible line', () => {
  assertEquals(
    renderRow({ kind: 'say', role: 'agent', text: 'hi' }),
    'agent: hi',
  )
  assertEquals(renderRow({ kind: 'reason', text: 'ponder' }), '… ponder')
  assertEquals(renderRow({ kind: 'exec', command: 'ls -a' }), '$ ls -a')
  assertEquals(
    renderRow({ kind: 'tool', name: '↳ shell', detail: 'ok' }),
    '[↳ shell] ok',
  )
  assertEquals(
    renderRow({ kind: 'turn', model: 'gpt-5.6-sol' }),
    '— turn — gpt-5.6-sol',
  )
  assertEquals(renderRow({ kind: 'turn' }), '— turn —')
  assertEquals(renderRow({ kind: 'error', text: 'boom' }), 'ERROR boom')
  assertEquals(
    renderRow({ kind: 'sys', tag: 'checkpoint', text: 'summary' }),
    '(checkpoint summary)',
  )
  assertEquals(renderRow({ kind: 'sys', tag: 'attention' }), '(attention)')
})

Deno.test('full width keeps prose newlines; a bounded width collapses and clips', () => {
  let multi = { kind: 'say', role: 'user', text: 'line one\nline two' } as const
  assertEquals(renderRow(multi), 'user: line one\nline two')
  // width bounds the VALUE (not the whole line): newlines collapse, then clip.
  assertEquals(renderRow(multi, 12), 'user: line one lin')
})

// The seq gutter, stripped, so a case reads by its content.
let said = (l: string) => l.replace(/^\s*\d+ {2}/, '')

Deno.test('a rowless JSON entry is machinery and drops; raw bytes stay visible', () => {
  let json: LogEntry = {
    seq: 44,
    line: JSON.stringify({ eid: 'ff8d', seq: 44, entry: {} }),
  }
  assertEquals(renderEntry(json), undefined)
  let bytes: LogEntry = { seq: 7, line: 'panic: runtime error' }
  assertEquals(renderEntry(bytes), '   7  panic: runtime error')
})

Deno.test('an entry renders with a seq gutter', () => {
  assertEquals(
    renderEntry({
      seq: 3,
      line: '',
      row: { kind: 'say', role: 'agent', text: 'done' },
    }),
    '   3  agent: done',
  )
})

Deno.test('transcribe drops machinery, and sifts by seq, prose and time', () => {
  let entries: LogEntry[] = [
    {
      seq: 1,
      line: '',
      row: {
        kind: 'say',
        role: 'user',
        text: 'go',
        at: '2026-08-12T00:00:00Z',
      },
    },
    {
      seq: 2,
      line: '',
      row: { kind: 'reason', text: 'think', at: '2026-08-12T01:00:00Z' },
    },
    {
      seq: 3,
      line: '',
      row: { kind: 'exec', command: 'ls', at: '2026-08-12T02:00:00Z' },
    },
    { seq: 4, line: JSON.stringify({ eid: 'x', seq: 4 }) }, // machinery, rowless
    {
      seq: 5,
      line: '',
      row: {
        kind: 'say',
        role: 'agent',
        text: 'ok',
        at: '2026-08-12T03:00:00Z',
      },
    },
  ]
  // Whole: machinery (seq 4) is gone; everything else renders.
  assertEquals(transcribe(entries).map(said), [
    'user: go',
    '… think',
    '$ ls',
    'agent: ok',
  ])
  // Prose only: say + reason.
  assertEquals(transcribe(entries, { prose: true }).map(said), [
    'user: go',
    '… think',
    'agent: ok',
  ])
  // Seq range is inclusive on both ends.
  assertEquals(transcribe(entries, { from: 2, to: 3 }).map(said), [
    '… think',
    '$ ls',
  ])
  // Time bounds screen on the entry's created.at.
  assertEquals(
    transcribe(entries, { since: '2026-08-12T02:00:00Z' }).map(said),
    ['$ ls', 'agent: ok'],
  )
})
