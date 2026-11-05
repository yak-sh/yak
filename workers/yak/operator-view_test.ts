// An error in the Operator's chat reads as words; what it said shows only
// inside a closed "Details". A conversation says which apps it changed, for
// the app beside the chat (T-140509).
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { toolEid } from '@yaks/tools/result'
import { about, changed, frame, helperFrame, rows } from './operator-view.ts'

let error =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"tools.26.custom.input_schema: input_schema does not support oneOf"}}'
let entry = (eid: string, seq: number, comps: Record<string, unknown>) =>
  ({ entity: { eid }, entry: { session: 's', seq }, ...comps }) as Bundle

// A conversation as it was recorded: a refused ask, a failed step and a crash.
let entries = [
  entry('in', 1, { content: { body: 'Any app errors recently?' } }),
  entry('ask', 2, { ask: { to: 'm', through: 'in' } }),
  entry('no', 3, {
    content: { body: error },
    output: { source: 'ask' },
    refusal: { code: 'request' },
    response: { body: error.slice(4) },
  }),
  entry('call', 4, { call: { to: 'tool', args: { app: 'msp430' } } }),
  entry('back', 5, {
    content: { body: '{"message":"no such app"}' },
    result: { call: 'call' },
    refusal: { code: 'missing' },
  }),
  entry('crash', 6, { failed: { message: 'Worker exceeded its CPU time' } }),
  // A helper's end as Jeff's conversation 68fd688b recorded it, before the
  // receipt carried `delivery`.
  entry('helper', 7, {
    content: {
      body:
        'child 44bf29e4-a03f-8fed-ad75-25d6efa4204f failed\nThis call has no verified cost bound',
    },
  }),
]

let drawn = () =>
  parseHTML(
    `<main>${
      rows(entries, (t) => ({ doing: `Reading ${t}…`, done: `Read ${t}` }))
        .map((r) => r.html).join('')
    }</main>`,
  ).document

test('an error reads as words, its detail only inside a closed disclosure', () => {
  let doc = drawn()
  let shown = [...doc.querySelectorAll('.Talk_Trouble > p')]
    .map((p) => p.textContent)
  assertEquals(shown.length, 4)
  for (let said of shown) assert(!/[{}]/.test(said!), said!)
  let details = [...doc.querySelectorAll('.Talk_Trouble > details')]
  assertEquals(details.length, 4)
  for (let d of details) {
    assert(!d.hasAttribute('open'))
    assertEquals(d.querySelector('summary')!.textContent, 'Details')
  }
  assertStringIncludes(
    details[0].textContent!,
    '"type": "invalid_request_error"',
  )
  assertStringIncludes(details[2].textContent!, 'CPU time')
  assertStringIncludes(details[3].textContent!, 'no verified cost bound')
  // Nothing of an error is drawn as a reply, or as the person's words.
  assertEquals(doc.querySelectorAll('.Talk_Reply').length, 0)
  assertEquals(
    [...doc.querySelectorAll('.Talk_You')].map((p) => p.textContent),
    ['Any app errors recently?'],
  )
})

// A step that called `to` with `args`, at seq n, and its answer at n + 1.
let step = (n: number, to: string, args: object, back: object = {}) => [
  entry(`c${n}`, n, { call: { to: toolEid(to), args } }),
  entry(`r${n}`, n + 1, { result: { call: `c${n}` }, ...back }),
]
let steps = [
  ...step(1, 'app_files', { op: 'write', app: 'notes' }),
  ...step(3, 'app_deploy', { app: 'notes' }),
  ...step(5, 'app_deploy', { app: 'gone' }, { refusal: { code: 'missing' } }),
  ...step(7, 'app_new', { slug: 'club', space: 'mill' }),
  ...step(9, 'app_rollback', { app: 'mill/notes' }),
  ...step(11, 'app_update', { app: 'chores' }),
  entry('c13', 13, {
    call: { to: toolEid('app_deploy'), args: { app: 'later' } },
  }),
]
let names = (t: string) => ({ doing: `Doing ${t}…`, done: `Did ${t}` })

test('a conversation says which apps it put out a new version of, in which space', () => {
  // Writing files only stages them, a refused deploy changed nothing, and a
  // deploy still under way has not changed it yet.
  assertEquals(changed(steps), [
    { space: '', app: 'notes' },
    { space: 'mill', app: 'club' },
    { space: 'mill', app: 'notes' },
    { space: '', app: 'chores' },
  ])
  // A step's frame names only what changed past where the page had read.
  assertEquals(frame('t', steps, names, 8).operator.changed, [
    { space: 'mill', app: 'notes' },
    { space: '', app: 'chores' },
  ])
  assertEquals(
    helperFrame('t', steps.slice(0, 4), [], names, 0).operator.changed,
    [{ space: '', app: 'notes' }],
  )
})

test('words sent about an app reach the Operator saying which, and read as written', () => {
  let said = `${about('notes')}Make the title bigger`
  let doc = parseHTML(
    `<main>${
      rows([entry('in', 1, { content: { body: said } })], names)
        .map((r) => r.html).join('')
    }</main>`,
  ).document
  assertEquals(
    doc.querySelector('.Talk_You')?.textContent,
    'Make the title bigger',
  )
})
