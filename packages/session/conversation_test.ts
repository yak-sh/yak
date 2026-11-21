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
  files,
  joined,
  type Kind,
  kind,
  kinds,
  MARGIN,
  margin,
  markdown,
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
  // A background call's Pending line is the call's, never the person's.
  equal(
    read(
      e('p', { tool_progress: { call: 'c' }, content: { body: 'Pending' } }),
    ),
    null,
  )
  equal(read(e('stop', { stop: {} })), ['', 'Stopped.', ''])
  // What a provider or the host said of a failure is never shown: the line
  // says what happened in plain words.
  let raw = '5028: @cf/zai-org/glm-5.3-flash was deprecated'
  let ended = (comps: object) =>
    read(
      e('r', { output: { source: 'a' }, content: { body: raw }, ...comps }),
      { who: 'the Operator' },
    )?.[1]
  let refused = 'The Operator could not get an answer from its model, so ' +
    'it stopped before replying. Send your message again to try once more.'
  equal(ended({ refusal: { code: 'model' } }), refused)
  equal(ended({ refusal: { code: 'busy' }, response: { body: raw } }), refused)
  equal(ended({ exception: {} }), failed.replace('the agent', 'the Operator'))
  equal(ended({ notice: {} }), "The Operator's answer was interrupted.")
  equal(read(e('x', { exception: {}, content: { body: 'boom' } })), [
    '',
    failed,
    failed,
  ])
  // A ceiling met is said in the host's own words.
  equal(
    read(e('r', {
      refusal: { code: 'limit' },
      output: {},
      content: { body: 'The budget is spent.' },
    })),
    ['', 'The budget is spent.', ''],
  )
})

test("a model's thought is a step among its calls, opening on what it thought", () => {
  let thought = e('r', {
    output: {},
    reasoning: {},
    content: { body: 'Matt asked for a **guide**.' },
  })
  equal(read(thought), [
    'step',
    'Thought it through Matt asked for a guide .',
    '',
  ])
  equal(read(e('q', { output: {}, reasoning: {}, content: {} })), null)
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

test('a call naming an integration wears its logo, the plug where it has none', () => {
  let names = namer({
    tools: { t: { step: { doing: 'Asking…', done: 'Asked' } } },
    logos: { gmail: 'data:image/svg+xml,g', mine: null },
  })
  let drawn = (args: object) =>
    renderToString(
      h(
        Fragment,
        null,
        draw(kinds, e('c', { call: { to: 't', args } }), {
          names,
        })!.node,
      ),
    )
  equal(
    drawn({ integration: 'gmail' }).includes('src="data:image/svg+xml,g"'),
    true,
  )
  equal(drawn({ connection: 'mine' }).includes('Logo_Mark-none'), true)
  equal(drawn({ integration: 'other' }).includes('Logo'), false)
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

test('the files with a line: a picture as itself, any other file as its kind, name and size', () => {
  let drawn = (...sent: Parameters<typeof files>[0]) =>
    renderToString(h(Fragment, null, files(sent)))
  let picture = drawn({ name: 'a.png', mime: 'image/png', href: '?f=0' })
  equal(picture.includes('<img src="?f=0" alt="a.png"'), true)
  let held = drawn({
    name: 'notes.pdf',
    size: 2_400_000,
    remove: { 'data-drop-remove': 0 },
  })
  let text = held.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  equal(text, 'PDF notes.pdf 2.4 MB ✕')
  equal(held.includes('aria-label="Remove notes.pdf"'), true)
  equal(drawn({ name: 'a.svg', mime: 'image/svg+xml' }).includes('<img'), false)
  equal(files([]), null)
})

test('a bare URL in prose reads as its host; a link with words keeps them', () => {
  let drawn = (text: string) =>
    renderToString(markdown(text)).match(/<a [^>]*>([^<]*)<\/a>/g)!
      .map((a) => a.replace(/<[^>]+>/g, ''))
  equal(
    drawn(
      'Tap https://yaks.app/approve?t=a.b to approve, <https://www.x.com/y>, or [the guide](https://yaks.app/guide).',
    ),
    ['yaks.app', 'x.com', 'the guide'],
  )
})
