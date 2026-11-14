// A conversation's lines (./conversation.ts): each kind of entry drawn as the
// person reads it, a host's kinds ahead of these, a margin where a view loads
// one, and which entries make a line (./lines.ts `joined`).
import { equal, test } from '@yaks/testing'
import { renderToString } from 'preact-render-to-string'
import { Fragment, h } from 'preact'
import { define } from '@yaks/render'
import type { Bundle } from '@yaks/graph'
import {
  type Beside,
  draw,
  joined,
  type Kind,
  kind,
  kinds,
  MARGIN,
  margin,
  namer,
} from './conversation.ts'

let e = (eid: string, comps: object = {}) =>
  ({ entity: { eid }, entry: { session: 's' }, ...comps }) as Bundle
let names = namer({
  tools: {
    t: { title: 'Read a file', step: { doing: 'Reading…', done: 'Read it' } },
  },
})
// What a person reads of a line, and what kind of line it is.
let read = (b: Bundle, beside: Partial<Beside> = {}, registry = kinds) => {
  let said = draw(registry, b, { names, ...beside })
  if (!said) return null
  let text = renderToString(h(Fragment, null, said.node)).replace(
    /<[^>]+>/g,
    ' ',
  )
  return [said.is ?? '', text.replace(/\s+/g, ' ').trim(), said.text ?? '']
}

test('each kind of entry is drawn as the person reads it', () => {
  let failed = 'Something went wrong, and the agent stopped before it ' +
    'finished. Send your message again to try once more.'
  equal(read(e('w', { content: { body: 'Hello' } })), ['theirs', 'Hello', ''])
  equal(
    read(
      e('task', { content: { body: '{"task":{"doc":{"body":"Fix it"}}}' } }),
    ),
    ['theirs', 'Fix it', ''],
  )
  equal(read(e('o', { output: {}, content: { body: '**Done.**' } })), [
    '',
    'Done.',
    '',
  ])
  equal(read(e('quiet', { output: {} })), null)
  equal(read(e('stop', { stop: {} })), ['', 'Stopped.', ''])
  equal(read(e('x', { exception: {}, content: { body: 'boom' } })), [
    '',
    `${failed} Details boom`,
    failed,
  ])
  equal(
    read(e('r', { refusal: { code: 'busy' }, response: {} }), {
      who: 'the Operator',
    })![2],
    'The Operator could not get an answer from its model, so it stopped ' +
      'before replying. Send your message again to try once more.',
  )
  // A refusal beside an output is that output's words.
  equal(
    read(e('r', { refusal: {}, output: {}, content: { body: 'No.' } })),
    ['', 'No.', ''],
  )
})

test('a call is one step: running, then settled by its result in place', () => {
  let call = e('c', { call: { to: 't', args: { path: 'a.txt' } } })
  let answer = (comps: object) => e('r', { result: { call: 'c' }, ...comps })
  equal(read(call), [
    'step',
    'Reading… What it asked for Path a.txt',
    '',
  ])
  equal(read(call, { result: answer({ content: { body: 'hi' } }) }), [
    'step',
    'Read it What it asked for Path a.txt What came back hi',
    '',
  ])
  let no = read(call, {
    result: answer({ refusal: {}, content: { body: '404' } }),
  })!
  equal(
    no[2],
    'Tried reading\n\nThis step did not work, so the agent went on without it.',
  )
})

test("a host's kinds draw ahead of these, and pass an entry back to them", () => {
  let host = define<Kind>([
    kind('.marked', (b) => b.marked ? { node: 'Marked' } : undefined),
    kind('.output', () => undefined),
    ...kinds.renderers,
  ])
  equal(read(e('m', { marked: {}, content: { body: 'Hi' } }), {}, host), [
    '',
    'Marked',
    '',
  ])
  equal(read(e('o', { output: {}, content: { body: 'Yes.' } }), {}, host), [
    '',
    'Yes.',
    '',
  ])
})

test('a margin is drawn where a view loads one, by the most specific that draws it', () => {
  let said = (registry: typeof kinds, b: Bundle) =>
    renderToString(h(Fragment, null, margin(registry, b, { names })))
  let noted = define<Kind>([
    kind(
      '.noted',
      (b) => (b.noted as { by?: string }).by ? { node: 'Noted' } : undefined,
      MARGIN,
    ),
    kind('.entry', () => ({ node: '#1' }), MARGIN),
    ...kinds.renderers,
  ])
  let words = e('w', { content: { body: 'Hello' } })
  equal(said(kinds, words), '')
  equal(said(noted, words), '#1')
  equal(said(noted, e('n', { noted: { by: 'a' } })), 'Noted')
  equal(said(noted, e('n', { noted: {} })), '#1')
  equal(read(words, {}, noted), ['theirs', 'Hello', ''])
})

test('which entries make a line: a result joins its call, a run of repeats is one', () => {
  let ids = (lines: ReturnType<typeof joined>) =>
    lines.map((l) => [l.entry.entity.eid, l.result?.entity.eid, l.n])
  let entries = [
    e('c1', { call: {} }),
    e('c2', { call: {} }),
    e('r2', { result: { call: 'c2' } }),
    e('r1', { result: { call: 'c1' } }),
    e('t1', { tick: {} }),
    e('t2', { tick: {} }),
    e('t3', { tick: {} }),
  ]
  equal(ids(joined(entries)), [
    ['c1', 'r1', undefined],
    ['c2', 'r2', undefined],
    ['t1', undefined, undefined],
    ['t2', undefined, undefined],
    ['t3', undefined, undefined],
  ])
  equal(ids(joined(entries, (a, b) => !!a.tick && !!b.tick)).slice(2), [
    ['t3', undefined, 3],
  ])
})
