// The Operator's lines as the socket sends them (operator-draw.ts `Lines`):
// each line, sent alone and read back from JSON, draws from the entries it
// sends what the whole conversation draws of it.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { PART } from '@yaks/persona/part'
import { h } from 'preact'
import { type Box, look as kit, mount, type Node } from '@yaks/native'
import type { Colors } from '@yaks/ui'
import {
  drawLines,
  lines,
  look,
  namer,
  type Seen,
  wire,
} from './operator-draw.ts'
import { HEARD, rows } from './operator-view.ts'
import { rowsOf } from './operator-rows.ts'

let entry = (eid: string, seq: number, comps: object, session = 's') =>
  ({ entity: { eid }, entry: { session, seq }, ...comps }) as Bundle
let told = (instructions: string) => ({
  ask: { to: 'm' },
  sending: { instructions, offer: 'tools' },
})

let conversation = [
  entry('in', 1, { content: { body: 'Make me a notes app' } }),
  entry('fork', 2, {
    prompt: { source: 'harness:fork' },
    content: { body: 'You are a fork.' },
  }),
  entry('ask1', 3, told(`# Base\nBe kind.${PART}# Rules\nBe brief.`)),
  entry('c4', 4, { call: { to: 'files', args: { app: 'notes' } } }),
  entry('r5', 5, { result: { call: 'c4' }, content: { body: '{"ok":1}' } }),
  entry('ask2', 6, told(`# Base\nBe kind.${PART}# Rules\nBe plain.`)),
  entry('h', 7, {
    content: { body: `${HEARD}Is it done?` },
    notice: {},
    operator_call: { call: 'v' },
    operator_channel: { channel: 'voice', framing: HEARD },
  }),
  entry('q', 8, {
    content: { body: 'Is the notes app done?' },
    operator_call: { call: 'v', asked: true },
  }),
  entry('c9', 9, { call: { to: 'files', args: { app: 'notes' } } }),
  entry('a', 10, { content: { body: 'Yes.' }, output: { source: 'ask' } }),
  entry('no', 11, { failed: { message: 'Worker exceeded its CPU time' } }),
]
let seen: Seen = {
  helpers: [{
    session: 'hs',
    call: 'c4',
    entries: [
      entry('hask', 1, told('# Helper\nWrite the files.'), 'hs'),
      entry('hout', 2, { output: {}, content: { body: 'Wrote them.' } }, 'hs'),
    ],
  }, {
    session: 'given',
    entries: [entry('gask', 1, told('# Given\nA task.'), 'given')],
  }],
  offers: new Map([['tools', [{
    name: 'app_files',
    description: 'Reads and writes files.',
    parameters: { type: 'object' },
  }]]]),
  tools: {
    files: {
      title: 'Use files',
      step: { doing: 'Reading %{app}…', done: 'Read %{app} for %{person}' },
    },
  },
  person: 'Jeff',
  called: 'Wren',
  opens: '/manage/mill/operator',
}

test('each line sent alone draws from its own entries what the conversation draws', () => {
  let names = namer(seen)
  let whole = rows(conversation, names, seen)
  assertEquals(whole.map((r) => r.id), [
    'in',
    'ask1',
    'c4',
    'ask2',
    'h',
    'q',
    'no',
    'gask',
  ])
  for (let line of lines(conversation, names, seen)) {
    let sent = JSON.parse(JSON.stringify(wire([line], conversation, seen)))
    assertEquals(rowsOf(sent), whole.filter((r) => r.id == line.id))
  }
  // What a line sends is what it reads (a helper's step, the ask before it
  // too), and the tools, helpers and offers those name.
  let [c4] = lines(conversation, names, seen).filter((l) => l.id == 'c4')
  let sent = wire([c4], conversation, seen)
  assertEquals(sent.entries.map((b) => b.entity.eid), [
    'fork',
    'ask1',
    'c4',
    'r5',
  ])
  assertEquals(sent.helpers.map((h) => h.entries.map((b) => b.entity.eid)), [
    ['hask'],
  ])
  assertEquals(Object.keys(sent.tools), ['files'])
  assertEquals(Object.keys(sent.offers), ['tools'])
  assertStringIncludes(rowsOf(sent)[0].html, 'Read notes for Jeff')
})

// What a painted node says, its boxes' parts joined by `|`.
let said = (n: Node): string =>
  n.kind == 'text'
    ? n.runs.map((r) => typeof r == 'string' ? r : said(r)).join('')
    : n.kind == 'box'
    ? n.children.map(said).join('|')
    : ''

test('the lines sent paint natively, each step one line until pressed', async () => {
  let sent = JSON.parse(JSON.stringify(
    wire(lines(conversation, namer(seen), seen), conversation, seen),
  ))
  // Every colour one ink: what is said is under test, not how it looks.
  let ink = new Proxy({}, { get: () => 'ink' }) as Colors
  let themed = kit(ink)
  let painted: Node | null = null
  let free = mount(
    h(
      'main',
      {},
      drawLines(sent).map(({ id, node }) => h('div', { key: id }, node)),
    ),
    { ...themed, classes: { ...themed.classes, ...look(ink) } },
    (n) => painted = n,
  )
  await new Promise((r) => setTimeout(r))
  let main = (painted as unknown as Box).children[0] as Box
  let words = main.children.map(said)
  assertEquals(words[0], 'Make me a notes app')
  assertEquals(words[2], 'Read notes for Jeff')
  assertEquals(
    words.at(-2),
    'Something went wrong, and the Operator stopped before it finished. Send your message again to try once more.|Details',
  )
  free()
})
