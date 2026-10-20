import { equal, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { idKeywords } from '@yaks/id'
import { kernelDoc } from '@yaks/kernel/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { sessionDoc } from './comp.ts'
import { ended, hear, heirs, listen, pending, said } from './listen.ts'
import { statusComputed } from './state.ts'

let vocab = loadVocab([docDoc, sessionDoc], [idKeywords])
let named = (eid: string) => eid.toUpperCase()

test('an item is one line, whitespace folded, naming what it points at', () => {
  let b: Bundle = {
    entity: { eid: 'c1', num: 7 },
    comment: { target: 't1' },
    created: { via: 's2' },
    doc: { title: '', body: 'two\n\nlines\tand a tab' },
  }
  assertEquals(
    said(vocab, b, named).split(' on ')[1],
    'T1 from S2: two lines and a tab',
  )
})

// A graph that answers every query with the rows `rows` holds at the time, and
// whose apply keeps what it was handed.
let ears = loadVocab([docDoc, sessionDoc, {
  $defs: {
    comment: {
      component: true,
      type: 'object',
      properties: { target: { type: 'string' } },
    },
    notified: { component: true, type: 'object', properties: {} },
  },
}], [idKeywords])
let stub = (rows: () => Bundle[]) => {
  let applied: Bundle[] = []
  let graph = {
    vocab: ears,
    get: () => [],
    apply: (bundles: Bundle[]) => (applied.push(...bundles), bundles),
    read: (q: unknown) => typeof q == 'string' ? [] : rows(),
  } as unknown as Graph
  return { graph, marked: () => applied.map((b) => b.entity.eid) }
}
let heard = async (rows: Bundle[], session: string) => {
  let lines: string[] = []
  let { graph, marked } = stub(() => rows)
  await hear(graph, null, session, (line) => lines.push(line))
  return { lines, marked: marked() }
}

test('what the session wrote itself is never said, and what is said is marked', async () => {
  let rows: Bundle[] = [
    {
      entity: { eid: 'c1' },
      comment: { target: 't' },
      created: { via: 'other' },
      doc: { title: '', body: 'hi' },
    },
    {
      entity: { eid: 'c2' },
      comment: { target: 't' },
      created: { via: 'me' },
      doc: { title: '', body: 'mine' },
    },
  ]
  let { lines, marked } = await heard(rows, 'me')
  assertEquals(lines.length, 1)
  assertEquals(marked, ['c1'])
})

let words = loadVocab([
  kernelDoc,
  provenanceDoc,
  docDoc,
  mailDoc,
  notifyDoc,
  sessionDoc,
  toolsDoc,
  personaDoc,
  projectDoc,
], [idKeywords])
let wrote = (by: string, to: string, n = 1): Bundle[] => [
  {
    entity: { eid: `letter-${by}-${n}` },
    mail: { from: 'p@example.com' },
    $actor: { by, via: by },
  },
  {
    entity: { eid: `reply-${by}-${n}` },
    mail: {
      from: 'owner@example.com',
      target: to,
      reply_to: `letter-${by}-${n}`,
    },
    doc: { title: 'Re: a question', body: 'yes' },
  },
]
// A native transcript wearing a persona: settled between turns, or mid-turn.
let transcript = (
  id: string,
  persona: string,
  turn: 'settled' | 'working',
): Bundle[] => [
  { entity: { eid: id }, session: { id, persona } },
  {
    entity: { eid: `${id}-asked` },
    entry: { session: id, seq: 1 },
    content: { body: 'look into it' },
    using: {},
  },
  ...turn == 'settled'
    ? [{
      entity: { eid: `${id}-done` },
      entry: { session: id, seq: 2 },
      output: { source: `${id}-asked` },
      content: { body: 'done' },
    }]
    : [],
]
let office = () =>
  graph({ storage: ram(words, { computed: statusComputed }), vocab: words })

// A project with a sub-project, the personas its sessions wear and one from
// elsewhere. Three sessions wrote to the owner from the project: one still
// running, one its harness ended and one whose transcript stopped. The owner
// answered each, and answered the ended one's second letter at the
// sub-project's address. Outside sessions and native transcripts work for
// each project, the native ones mid-turn or at rest.
let desk = office()
await desk.apply([
  { entity: { eid: 'p' }, project: {} },
  { entity: { eid: 'sub' }, project: {}, filed: { project: 'p' } },
  { entity: { eid: 'elsewhere' }, project: {} },
  { entity: { eid: 'operator' }, persona: { home: 'p' } },
  { entity: { eid: 'specialist' }, persona: { home: 'sub' } },
  { entity: { eid: 'stranger' }, persona: { home: 'elsewhere' } },
  { entity: { eid: 'running' }, session: { id: 'running' } },
  { entity: { eid: 'ended' }, session: { id: 'ended', ended: true } },
  { entity: { eid: 'stopped' }, session: { id: 'stopped' } },
  {
    entity: { eid: 'halt' },
    entry: { session: 'stopped', seq: 1 },
    stop: {},
  },
  { entity: { eid: 'next' }, session: { id: 'next', persona: 'operator' } },
  {
    entity: { eid: 'nearby' },
    session: { id: 'nearby', persona: 'specialist' },
  },
  { entity: { eid: 'other' }, session: { id: 'other', persona: 'stranger' } },
  ...transcript('busy', 'operator', 'working'),
  ...transcript('idle', 'operator', 'settled'),
  ...transcript('busy-sub', 'specialist', 'working'),
])
let terminal = await desk.get(
  ['running', 'ended', 'stopped', 'busy', 'idle'],
  ['session'],
)
test('a batch of sessions distinguishes harness end and stop from live and settled turns', async () =>
  equal([...await ended(desk, terminal)].sort(), ['ended', 'stopped']))

for (
  let bundle of [
    wrote('running', 'p'),
    wrote('ended', 'p'),
    wrote('ended', 'sub', 2),
    wrote('stopped', 'p'),
  ].flat()
) await desk.apply([bundle])
// Letters no session wrote to: an alert that arrived at the project, the
// owner's answer to it, his answer to a letter another graph sent (this one
// never kept it), and an answer going out, which is nobody's to hear.
let re = { from: 'owner@example.com', target: 'p' }
await desk.apply([
  {
    entity: { eid: 'alert' },
    mail: { from: 'alerts@example.com', target: 'p' },
  },
  { entity: { eid: 're-alert' }, mail: { ...re, reply_to: 'alert' } },
  { entity: { eid: 'stray' }, mail: { ...re, in_reply_to: 'b1@tracker' } },
  { entity: { eid: 'out' }, mail: { ...re, in_reply_to: 'b2' }, deliver: {} },
  // A letter to an address filed under the project, as hello@yaks.app is,
  // and one to an address filed nowhere, which nobody hears.
  { entity: { eid: 'hello' }, email: { address: 'hello@example.app' } },
  { entity: { eid: 'hello' }, filed: { project: 'p' } },
  { entity: { eid: 'loose' }, email: { address: 'loose@example.app' } },
  {
    entity: { eid: 'to-hello' },
    mail: { from: 'a@example.com', target: 'hello' },
  },
  {
    entity: { eid: 'to-loose' },
    mail: { from: 'a@example.com', target: 'loose' },
  },
  // The graph's own news for the project: a bug the tracker opened.
  {
    entity: { eid: 'knock-p' },
    knock: { target: 'p' },
    doc: { title: '', body: 'BuildFailed: the build of yak failed' },
  },
])

let hears = async (session: string) =>
  (await pending(desk, session)).map(({ item }) => item.entity.eid).sort()
for (
  let [session, heard, what] of [
    [
      'running',
      ['reply-running-1'],
      'a running session hears the reply to its own letter',
    ],
    [
      'ended',
      ['reply-ended-1', 'reply-ended-2'],
      'a session that ended hears its replies if it comes back',
    ],
    [
      'next',
      [
        'alert',
        'knock-p',
        're-alert',
        'reply-ended-1',
        'reply-ended-2',
        'reply-stopped-1',
        'stray',
        'to-hello',
      ],
      'a letter or knock that reached the project, or a reply whose letter’s writer is over or was no session, is heard by a session of the project or of a project above it',
    ],
    [
      'nearby',
      ['reply-ended-2'],
      'a sub-project’s session hears what reached the sub-project, not its parent',
    ],
    ['other', [], 'another project’s session hears none of it'],
  ] as const
) {
  test(what, async () => equal(await hears(session), [...heard]))
}

for (
  let [item, may, what] of [
    ['reply-ended-1', ['busy'], 'a letter held for a project'],
    ['reply-ended-2', ['busy', 'busy-sub'], 'a letter held for a sub-project'],
    ['knock-p', ['busy'], 'a knock at a project'],
    ['to-hello', ['busy'], 'a letter to an address filed under a project'],
    ['to-loose', [], 'a letter to an address filed nowhere'],
  ] as const
) {
  test(`${what} may reach only native transcripts at work of its project or of one above it`, async () =>
    equal((await heirs(desk, await desk.get([item]))).sort(), [...may]))
}

// A project whose persona two native transcripts wear, one at rest and one
// mid-turn, news and a letter held for it, and a knock at the one at rest.
let rest = office()
await rest.apply([
  { entity: { eid: 'p' }, project: {} },
  { entity: { eid: 'operator' }, persona: { home: 'p' } },
  ...transcript('resting', 'operator', 'settled'),
  ...transcript('working', 'operator', 'working'),
  { entity: { eid: 'news' }, knock: { target: 'p' }, doc: { body: 'bug' } },
  { entity: { eid: 'alert' }, mail: { from: 'a@example.com', target: 'p' } },
  {
    entity: { eid: 'nudge' },
    knock: { target: 'resting' },
    doc: { body: 'you' },
  },
])

let resting = async (s: string) =>
  (await pending(rest, s)).map(({ item }) => item.entity.eid).sort()
test('a native transcript at rest hears only what is addressed to it, never what is held for its project', async () =>
  equal(await resting('resting'), ['nudge']))
test('a native transcript at work hears what is held for its project', async () =>
  equal(await resting('working'), ['alert', 'news']))

test('a listener told once waits for something to say, says it and ends', async () => {
  let reply: Bundle = {
    entity: { eid: 'c1' },
    comment: { target: 't' },
    doc: { title: '', body: 'a reply' },
  }
  let rows: Bundle[] = []
  let { graph, marked } = stub(() => rows)
  let lines: string[] = []
  let waits = 0
  await listen(graph, null, 'me', {
    out: (line) => lines.push(line),
    // the first wait ends with the reply there to read; a second is a fault
    every: () =>
      waits++
        ? Promise.reject(new Error('it said something and kept listening'))
        : Promise.resolve(void (rows = [reply])),
    once: true,
  })
  equal([waits, lines.length, marked()], [1, 1, ['c1']])
})

// A session with a knock waiting for it.
let waiting = office()
await waiting.apply([
  { entity: { eid: 'me' }, session: { id: 'me' } },
  {
    entity: { eid: 'mail' },
    knock: { target: 'me' },
    doc: { body: 'a reply' },
  },
])

test('a listener told once says what waits for it, marks it said and ends', async () => {
  let lines: string[] = []
  await listen(waiting, null, 'me', {
    out: (line) => lines.push(line),
    every: () => Promise.reject(new Error('it waited with something to say')),
    once: true,
  })
  equal(lines.length, 1)
  equal((await waiting.get(['mail']))[0].notified != null, true)
})

// With no project, status cannot change what is heard. Keep status unavailable
// to prove addressed correspondence does not depend on reading a transcript.
let withoutProject = graph({
  vocab: words,
  storage: ram(words, { computed: statusComputed }),
})
let projectlessRead = withoutProject.read
withoutProject.read = (query, options) => {
  if (JSON.stringify(query).includes('"status"')) {
    throw new Error('a session without a project needs no transcript status')
  }
  return projectlessRead(query, options)
}
await withoutProject.apply([
  { entity: { eid: 'unhomed' }, session: { id: 'unhomed' } },
  {
    entity: { eid: 'start-unhomed' },
    entry: { session: 'unhomed' },
    using: {},
  },
  {
    entity: { eid: 'direct-unhomed' },
    knock: { target: 'unhomed' },
    doc: { body: 'your reply' },
  },
])
let unhomedReply = await pending(withoutProject, 'unhomed').then(
  (items) => () => items.map(({ item }) => item.entity.eid),
  (error) => () => {
    throw error
  },
)
test('a native session without a project hears its addressed reply without transcript status', () => {
  equal(unhomedReply(), ['direct-unhomed'])
})

test('a waiting listener skips unchanged revisions and hears the next commit', async () => {
  let rows: Bundle[] = [], revision = 1, reads = 0, waits = 0
  let { graph: g } = stub(() => (reads++, rows))
  let before = 0
  let stop = new AbortController()
  let lines: string[] = []
  let source = {
    ...g,
    storage: { revision: () => revision },
  } as unknown as Graph
  await listen(source, null, 'me', {
    out: (line) => lines.push(line),
    once: true,
    stop: stop.signal,
    every: () => {
      waits++
      if (waits == 1) before = reads
      if (waits == 3) {
        equal(reads, before)
        rows = [{
          entity: { eid: 'news' },
          comment: { target: 't' },
          doc: { body: 'arrived' },
        }]
        revision++
      }
      if (waits > 3) stop.abort()
      return Promise.resolve()
    },
  })
  equal([waits, lines.length, reads > before], [3, 1, true])
})

test('a listener does not miss a commit during its read', async () => {
  let revision = 1,
    waits = 0,
    stop = new AbortController(),
    lines: string[] = []
  let rows: Bundle[] = []
  let { graph: g } = stub(() => {
    if (!rows.length) {
      revision++
      rows = [{
        entity: { eid: 'during' },
        comment: { target: 't' },
        doc: { body: 'during read' },
      }]
      return []
    }
    return rows
  })
  await listen(
    { ...g, storage: { revision: () => revision } } as unknown as Graph,
    null,
    'me',
    {
      out: (line) => lines.push(line),
      once: true,
      stop: stop.signal,
      every: () => {
        if (++waits > 1) stop.abort()
        return Promise.resolve()
      },
    },
  )
  equal(lines.length, 1)
})

await desk.apply([
  {
    entity: { eid: 'heir-record-p' },
    doc: { title: 'Parent record' },
    filed: { project: 'p' },
  },
  {
    entity: { eid: 'heir-record-sub' },
    doc: { title: 'Child record' },
    filed: { project: 'sub' },
  },
])
let mixedHeirItems: Bundle[] = [
  { entity: { eid: 'heir-mail' }, mail: { target: 'p' } },
  {
    entity: { eid: 'heir-comment-sub' },
    comment: { target: 'heir-record-sub' },
  },
  { entity: { eid: 'heir-comment-p' }, comment: { target: 'heir-record-p' } },
  {
    entity: { eid: 'heir-comment-again' },
    comment: { target: 'heir-record-sub' },
  },
  {
    entity: { eid: 'heir-comment-missing' },
    comment: { target: 'heir-record-missing' },
  },
]
let mixedHeirs = await heirs(desk, mixedHeirItems)
test('mixed project mail and repeated comment targets retain their native heirs', () =>
  equal([...mixedHeirs].sort(), ['busy', 'busy-sub']))
let scopedHeirs = await heirs({
  vocab: desk.vocab,
  read: desk.read.bind(desk),
  get: (ids, comps) =>
    desk.get(ids, comps, {
      visibility: { components: { filed: '.entity.eid!=heir-record-sub' } },
    }),
}, mixedHeirItems)
test('hidden comment target filings cannot add project heirs', () =>
  equal(scopedHeirs, ['busy']))
