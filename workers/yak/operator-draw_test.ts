// The Operator's lines as the socket sends them (operator-draw.ts `Lines`):
// each line, sent alone and read back from JSON, draws from the entries it
// sends what the whole conversation draws of it.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { PART } from '@yaks/persona/part'
import { Fragment, h } from 'preact'
import { parseHTML } from 'linkedom'
import { type Box, look as kit, mount, type Node } from '@yaks/native'
import type { Colors } from '@yaks/ui'
import {
  CONTEXT,
  drawLines,
  lines,
  look,
  PERSON,
  type Seen,
  type View,
  wire,
} from './operator-draw.ts'
import { margins, metadata } from './operator-metadata.ts'
import { define } from '@yaks/render'
import { renderToString } from 'preact-render-to-string'
import { namer } from '@yaks/session/conversation'
import { HEARD, rows } from './operator-view.ts'
import { rowsOf } from './operator-rows.ts'
import { sourceReference } from './operator-source.ts'

let entry = (eid: string, seq: number, comps: object, session = 's') =>
  ({ entity: { eid }, entry: { session, seq }, ...comps }) as Bundle
let told = (instructions: string) => ({
  ask: { to: 'm' },
  sending: { instructions, offer: 'tools' },
})

test('source references stay out of chat and task inputs, preserving the person’s words', () => {
  let note = sourceReference('a'.repeat(64))
  let body = '  name,group\nZoë 雪,Group A\n  '
  let original = body + note
  let inputs = [
    body + note,
    JSON.stringify({ task: { doc: { body } } }) + note,
    original + note,
    body + '\n\nOriginal message text: message.txt (attachment user words)',
  ].map((body, i) => entry('input-' + i, i + 1, { content: { body } }))
  let painted = rows(inputs, namer(seen), seen).map((r) => r.html)
  let words = (html: string) =>
    parseHTML(html).document.querySelector('.Transcript_Bubble')!.textContent
  assertEquals(painted.slice(0, 2).map(words), [body, body])
  assertStringIncludes(painted[2], original)
  assertStringIncludes(
    painted[3],
    body + '\n\nOriginal message text: message.txt (attachment user words)',
  )
})

test('entry actions copy the person’s displayed words and preserve reply Markdown', () => {
  let input = 'Please check **these notes**.'
  let output = 'Done.\n\n- Read [the notes](/notes)'
  let entries = [
    entry('input', 1, {
      content: { body: HEARD + input + sourceReference('a'.repeat(64)) },
      operator_channel: { channel: 'voice', framing: HEARD },
    }),
    entry('output', 2, { output: {}, content: { body: output } }),
  ]
  assertEquals(
    rows(entries, namer({})).map((r) =>
      parseHTML(r.html).document.querySelector('[data-entry-text]')!
        .getAttribute('data-entry-text')
    ),
    [input, output],
  )
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

test('a view draws what it loads: the context a model was given, a margin beside each line', () => {
  let names = namer(seen)
  let drawn = (view?: View) =>
    lines(conversation, names, seen, view).map((l) =>
      renderToString(h(Fragment, null, l.node))
    )
  // Each line's own number, after those of the lines folded in it.
  let numbers = (view?: View) =>
    drawn(view).map((s) =>
      [...s.matchAll(/data-sequence[^>]*>([^<]*)/g)].at(-1)?.[1]
    )
  let briefless = define(PERSON.filter((k) => !CONTEXT.includes(k)))
  assertEquals(drawn().filter((s) => s.includes('The context')).length, 4)
  assertEquals(drawn(briefless).filter((s) => s.includes('context')), [])
  assertEquals(drawn(briefless).length, 4)
  assertEquals(numbers(), Array(7).fill(undefined))
  let admin = define([...PERSON, margins(metadata(conversation, [], [], []))])
  assertEquals(numbers(admin), ['#1', '#3', '#4', '#6', '#7', '#11', undefined])
})

test('a contact request stays inline in the person’s conversation through confirmation and socket updates', () => {
  let contact = {
    id: 'contact-request',
    number: '+12695550142',
    action: '/manage/mill/operator?texts=1',
  }
  let proposed = entry(contact.id, 2, {
    operator_contact: {
      person: 'person',
      session: 's',
      source: 'request',
      address: contact.number,
    },
    notice: {},
    content: { body: JSON.stringify({ contact }) },
  })
  let entries = [
    entry('request', 1, { content: { body: 'Text me when done.' } }),
    proposed,
  ]
  let whole = rows(entries, namer({}))
  let html = whole.find((r) => r.id == contact.id)!.html
  let form = parseHTML(html).document.querySelector('form')!
  assertEquals(form.closest('details'), null)
  assertEquals(form.getAttribute('action'), contact.action)
  assertEquals(
    form.querySelector('[name=number]')!.getAttribute('value'),
    contact.number,
  )
  assertEquals(
    form.querySelector('[name=agreed]')!.hasAttribute('checked'),
    false,
  )
  for (let mark of [{}, { verified: {} }, { cancelled: {} }]) {
    let changed = [entries[0], { ...proposed, ...mark }]
    let painted = rows(changed, namer({}))
    for (let line of lines(changed, namer({}))) {
      let sent = JSON.parse(JSON.stringify(wire([line], changed)))
      assertEquals(rowsOf(sent), painted.filter((r) => r.id == line.id))
    }
    let updated = parseHTML(
      painted.find((r) => r.id == contact.id)!.html,
    ).document
    assertEquals(
      !!updated.querySelector('form'),
      !('verified' in mark || 'cancelled' in mark),
    )
  }
  let email = {
    ...proposed,
    operator_contact: { person: 'person', address: 'person@example.net' },
  }
  let changed = parseHTML(rows([email], namer({}))[0].html).document
  assertEquals(changed.querySelector('form'), null)
  assertStringIncludes(
    changed.textContent ?? changed.toString(),
    'Check your email',
  )
})

test('an outside agent’s chat is a step named for whom it was with, holding the chat and never the model’s recap', () => {
  let note = sourceReference('b'.repeat(64))
  let asked = 'Timing check 24 for T-155323: reply with the single word "ok".'
  let chat = [
    entry('said', 1, {
      content: { body: asked + note },
      entry: { session: 'chat', from: 'an outside agent' },
    }, 'chat'),
    entry('answer', 2, { output: {}, content: { body: 'ok' } }, 'chat'),
  ]
  let recap = `Chat chat closed (quiet).\n\nAsked:\n${
    asked + note
  }\n\nDone / open:\nok`
  let notice = entry('closed', 3, {
    notice: { child: 'chat' },
    delivery: { child: 'chat', outcome: 'settled', through: 'answer' },
    content: { body: recap },
  })
  let threads = {
    closed: {
      session: 'chat',
      who: 'An outside agent for Jeff',
      lines: wire(lines(chat, namer({})), chat, { opens: '/operator' }),
    },
  }
  let [row] = rows([notice], namer({}), { threads })
  let fold = parseHTML(row.html).document.querySelector('details')!
  assertEquals(fold.className, 'More More-quiet')
  assertEquals(
    fold.querySelector(':scope > summary')!.textContent,
    'Chatted with an outside agent for Jeff',
  )
  let inset = fold.querySelector(':scope > .More_Body')!
  assertEquals(
    inset.querySelector('a')!.getAttribute('href'),
    '/operator/chat',
  )
  assertEquals(
    [...inset.querySelectorAll('.Transcript_Bubble, .Transcript_Reply')].map(
      (e) => e.textContent,
    ),
    [asked, 'ok'],
  )
  assertEquals(row.html.includes('attachment_read'), false)
  assertEquals(row.html.includes('Asked:'), false)
})

test('a context that changed draws only its changed layers, each with its change, and one changed in spacing alone is not drawn', () => {
  let ask = (eid: string, seq: number, layers: string[], session = 's') =>
    entry(eid, seq, told(layers.join(PART)), session)
  let base = '# Base\nBe kind.'
  let entries = [
    ask('a1', 1, [base, '# Rules\nBe brief.\nBe calm.']),
    // Another session drew the new rules above.
    ask('b1', 2, ['# Rules\nBe plain.\nBe calm.'], 't'),
    ask('a2', 3, [base, '# Rules\nBe plain.\nBe calm.']),
    ask('a3', 4, ['# Base\n  Be   kind. ', '# Rules\nBe plain.\n\nBe calm.']),
    ask('a4', 5, [base, '# Rules\nBe plain.\nBe calm.', '# More\nBe quick.']),
  ]
  let painted = rows(entries, namer(seen), { ...seen, helpers: [] })
  assertEquals(painted.map((r) => r.id), ['a1', 'b1', 'a2', 'a4'])
  let text = (id: string) =>
    parseHTML(`<div>${painted.find((r) => r.id == id)!.html}</div>`)
      .document.querySelector('div')!.textContent!.replace(/\s+/g, ' ').trim()
  for (let id of ['a2', 'a4']) {
    assertStringIncludes(text(id), 'changed here')
    assertEquals(text(id).includes('The same as above'), false)
    assertEquals(text(id).includes('Base'), false)
  }
  assertStringIncludes(
    text('a2'),
    'Rules (changed)Taken outBe brief.Put inBe plain.',
  )
  assertEquals(text('a2').includes('Be calm.'), false)
  assertStringIncludes(text('a4'), 'More (new)Be quick.')
  assertEquals(text('a4').includes('Rules'), false)
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
  let words = main.children.map(said).map((s) => s.replace(/\|+$/, ''))
  assertEquals(words[0], 'Make me a notes app')
  assertEquals(words[2], 'Read notes for Jeff')
  assertEquals(
    words.at(-2),
    'Something went wrong, and the Operator stopped before it finished. Send your message again to try once more.|Details',
  )
  free()
})
