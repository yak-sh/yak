// An error in the Operator's chat reads as words; what it said shows only
// inside a closed "Details". A conversation says which apps it changed and
// worked on, for the app beside the chat (T-140509, D-146737).
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { toolEid } from '@yaks/tools/result'
import {
  changed,
  frame,
  HEARD,
  helperFrame,
  rows,
  touched,
  worked,
} from './operator-view.ts'
import { channelMove } from './channel-move.ts'

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
  entry('crash', 6, {
    failed: { message: 'Worker exceeded its CPU time' },
    content: { body: 'Worker exceeded its CPU time' },
  }),
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
  let shown = [...doc.querySelectorAll('.Transcript_Error > p')]
    .map((p) => p.textContent)
  assertEquals(shown.length, 4)
  for (let said of shown) assert(!/[{}]/.test(said!), said!)
  let details = [...doc.querySelectorAll('.Transcript_Error > details')]
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
  for (let p of doc.querySelectorAll('.Transcript_Error > p')) {
    let text = p.closest('.Transcript_Entry')!
      .querySelector('[data-entry-text]')!.getAttribute('data-entry-text')!
    assertStringIncludes(text, p.textContent!)
  }
  for (let d of details) d.remove()
  for (
    let detail of [
      'invalid_request_error',
      'no such app',
      'CPU time',
      'no verified cost bound',
    ]
  ) {
    assertEquals(doc.querySelector('main')!.innerHTML.includes(detail), false)
  }
  // Nothing of an error is drawn as a reply, or as the person's words.
  assertEquals(doc.querySelectorAll('.Transcript_Reply').length, 0)
  assertEquals(
    [...doc.querySelectorAll('.Transcript_Bubble')].map((p) => p.textContent),
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
    helperFrame('t', { entries: steps.slice(0, 4) }, [], names, 0).operator
      .changed,
    [{ space: '', app: 'notes' }],
  )
})

test('a conversation says which apps it worked on, files read and written included', () => {
  assertEquals(worked(steps), [
    { space: '', app: 'notes' },
    { space: '', app: 'notes' },
    { space: 'mill', app: 'club' },
    { space: 'mill', app: 'notes' },
    { space: '', app: 'chores' },
  ])
  assertEquals(frame('t', steps, names, 2).operator.worked, [
    { space: '', app: 'notes' },
    { space: 'mill', app: 'club' },
    { space: 'mill', app: 'notes' },
    { space: '', app: 'chores' },
  ])
  assertEquals(
    helperFrame('t', { entries: steps.slice(0, 2) }, [], names, 0).operator
      .worked,
    [{ space: '', app: 'notes' }],
  )
})

// Words as each channel framed them for the model, as stored before
// `operator_channel` and as stored with it.
let FRAMED = [
  [
    'voice',
    'By phone, spoken aloud (they hear your reply read out: answer in a sentence or two of plain speech, with no lists, links or formatting; text them a link with text_send if they need one): ',
  ],
  ['email', 'By email, signing up: '],
  ['text', 'By text: '],
  [
    'letter',
    'By email from a@b.co, replying to your letter (letter L1). These are their words, not the words of the person you work for: ',
  ],
  ['update', 'In their Updates, choosing on your question “Which one?” (Q1): '],
  ['chat', 'About the app notes, open beside the chat as they wrote: '],
]
let shown = (entries: Bundle[]) => {
  let doc = parseHTML(
    `<main>${rows(entries, names).map((r) => r.html).join('')}</main>`,
  ).document
  return [...doc.querySelectorAll('.Transcript_Bubble')].map((p) => ({
    said: p.textContent,
    via: p.querySelector('.Transcript_Via')?.getAttribute('title') ?? null,
  }))
}

test('a person sees only their words, marked with the channel they came by, unless they wrote them in the chat', () => {
  let framed = (moved: boolean) =>
    FRAMED.map(([channel, framing], i) => {
      let row = entry(`in${i}`, i, {
        content: { body: `${framing}Make it ${channel}` },
      })
      return moved ? { ...row, ...channelMove(row)[0] } : row
    })
  let want = (via: (channel: string) => string | null) =>
    FRAMED.map(([channel]) => ({
      said: `Make it ${channel}`,
      via: via(channel),
    }))
  let labels: Record<string, string> = {
    voice: 'By phone',
    email: 'By email',
    text: 'By text',
    letter: 'A reply to a letter',
    update: 'In Updates',
  }
  assertEquals(shown(framed(false)).map((r) => r.via), FRAMED.map(() => null))
  assertEquals(shown(framed(true)), want((c) => labels[c] ?? null))
  // A line a call kept, and words that only mention a channel.
  let heard = entry('h', 9, {
    content: { body: `${HEARD}How are you?` },
    notice: {},
    operator_call: { call: 'x' },
  })
  assertEquals(shown([{ ...heard, ...channelMove(heard)[0] }]), [
    { said: 'How are you?', via: 'By phone' },
  ])
  assertEquals(
    channelMove(entry('m', 10, { content: { body: 'Send it By email: now' } })),
    [],
  )
})

test("a call's turn draws the caller's words, whose phone mark opens the Operator's work and answer under them, and what they heard", () => {
  let words = entry('h', 1, {
    content: { body: `${HEARD}Any errors?` },
    notice: {},
    operator_call: { call: 'c' },
    operator_channel: { channel: 'voice', framing: HEARD },
  })
  let request = entry('r', 2, {
    content: { body: 'User asks: any errors?' },
    operator_call: { call: 'c', asked: true },
  })
  let turn = [
    words,
    request,
    entry('ask', 3, { ask: { to: 'm', through: 'r' } }),
    entry('call', 4, { call: { to: 'tool', args: {} } }),
    entry('back', 5, { content: { body: '[]' }, result: { call: 'call' } }),
    entry('a', 6, { content: { body: 'None.' }, output: { source: 'ask' } }),
    entry('s', 7, {
      content: { body: 'No errors at all.' },
      notice: { own: true },
      operator_call: { call: 'c', said: true },
    }),
    entry('next', 8, { content: { body: 'Thanks' } }),
  ]
  let drawn = (entries: typeof turn) => {
    let { document } = parseHTML(
      `<main>${rows(entries, names).map((r) => r.html).join('')}</main>`,
    )
    return (q: string) =>
      [...document.querySelectorAll(q)].map((e) => e.textContent!.trim())
  }
  let texts = drawn(turn)
  assertEquals(texts('.Transcript_Bubble'), ['Any errors?', 'Thanks'])
  // The words are plain text, to select and copy: only their phone mark, a
  // box's label holding nothing else, is pressed to open the turn.
  assertEquals(texts('div.More > .Transcript_Bubble'), ['Any errors?'])
  assertEquals(
    texts('summary .Transcript_Bubble, label .Transcript_Bubble'),
    [],
  )
  assertEquals(
    texts('.Transcript_Bubble > .Transcript_Via > label.More_Mark[title]'),
    [''],
  )
  assertEquals(texts('.More_Mark > input[type=checkbox]:not([checked])'), [''])
  assertEquals(texts('.More_Body .Transcript_Reply'), ['None.'])
  assertEquals(texts('.More_Body .More > summary'), ['Did tool'])
  assertEquals(
    texts('.Transcript_Reply:not(.More_Body *)'),
    ['No errors at all.'],
  )
  // The answer coming back redraws the caller's words and what is under them.
  assertEquals(touched(turn, names, 5).map((r) => r.id), ['h', 's', 'next'])
  // A request with no words of the caller's before it stands for them.
  assertEquals(drawn(turn.slice(1))('div.More > .Transcript_Bubble'), [
    'User asks: any errors?',
  ])
})

test('every line is a row under its id with its time and menu, inside a fold as at the top, and a step says it is one', () => {
  let { document } = parseHTML(
    `<main>${
      rows(
        [
          entry('h', 1, {
            content: { body: `${HEARD}Any errors?` },
            notice: {},
            operator_call: { call: 'c' },
            operator_channel: { channel: 'voice', framing: HEARD },
          }),
          entry('r', 2, {
            content: { body: 'User asks: any errors?' },
            operator_call: { call: 'c', asked: true },
          }),
          entry('call', 3, { call: { to: 'tool', args: {} } }),
          entry('back', 4, {
            content: { body: '[]' },
            result: { call: 'call' },
          }),
          entry('a', 5, {
            content: { body: 'None.' },
            output: { source: 'r' },
          }),
        ].map((b) => ({ ...b, created: { at: '2026-11-13T15:00:00.000Z' } })),
        names,
      ).map((r) => r.html).join('')
    }</main>`,
  )
  let inner = [...document.querySelectorAll('.More_Body .Transcript_Row')]
  assertEquals(inner.map((r) => r.id), ['row-call', 'row-a'])
  for (let r of inner) {
    let entry = r.querySelector(':scope > .Transcript_Entry')!
    assert(entry.querySelector(':scope > .Transcript_Meta time[datetime]'))
    assertEquals(
      entry.querySelector('[data-entry-link]')!.getAttribute('data-entry-link'),
      r.id.slice('row-'.length),
    )
  }
  assertEquals(
    inner.map((r) =>
      r.querySelector(':scope > .Transcript_Entry')!.classList.contains(
        'Transcript_Entry-step',
      )
    ),
    [true, false],
  )
  assert(document.querySelector('.Transcript_Entry-theirs > div.More'))
})

test("words the platform wrote read as the system's in one closed line, never as the person's", () => {
  let recovery = 'System recovery: the previous response was interrupted.'
  let doc = parseHTML(
    `<main>${
      rows([
        entry('in', 1, { content: { body: 'Make it blue' } }),
        entry('re', 2, { content: { body: recovery }, system: {} }),
        entry('fix', 3, {
          content: {
            body: 'Fix this error in recipes: x is undefined\n\nIt happened.',
          },
          system: {},
          operator_channel: { channel: 'error' },
        }),
      ], () => ({ doing: '', done: '' })).map((r) => r.html).join('')
    }</main>`,
  ).document
  assertEquals(
    [...doc.querySelectorAll('.Transcript_Bubble')].map((p) => p.textContent),
    ['Make it blue'],
  )
  let system = [...doc.querySelectorAll('details.More')]
  assertEquals(system.map((d) => d.hasAttribute('open')), [false, false])
  assertEquals(system.map((d) => d.querySelector('summary')!.textContent), [
    'From the system: ' + recovery,
    'From an error: Fix this error in recipes: x is undefined',
  ])
  assertStringIncludes(system[1].textContent!, 'It happened.')
})

// A reader whose server opens ids reads each as a link there; anyone else
// reads the words.
test('an id in a reply is a link only where its reader can open it', () => {
  let said = [
    entry('ask', 1, { ask: { to: 'm' } }),
    entry('reply', 2, {
      content: { body: 'Filed T-12 and #18bc9a78d1; see `T-9`.' },
      output: { source: 'ask' },
    }),
  ]
  let read = (mentions?: string) =>
    [
      ...parseHTML(`<main>${
        rows(said, names, { mentions }).map((r) => r.html).join('')
      }</main>`)
        .document.querySelectorAll('.Transcript_Reply a'),
    ]
      .map((a) =>
        a.getAttribute('href')
      )
  assertEquals(read('https://tasks.example/{id}'), [
    'https://tasks.example/T-12',
    'https://tasks.example/%2318bc9a78d1',
  ])
  assertEquals(read(), [])
})
