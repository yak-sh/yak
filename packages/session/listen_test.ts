import { equal, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { idKeywords } from '@yaks/id'
import { kernelDoc } from '@yaks/kernel/vocab'
import { mailDoc } from '@yaks/mail/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { sessionDoc } from './comp.ts'
import { hear, heirs, pending, said } from './listen.ts'

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

// A read that answers every query with the same rows, and an apply that keeps
// what it was handed.
let heard = async (rows: Bundle[], session: string) => {
  let lines: string[] = []
  let applied: Bundle[] = []
  let graph = {
    vocab: loadVocab([docDoc, sessionDoc, {
      $defs: {
        comment: {
          component: true,
          type: 'object',
          properties: { target: { type: 'string' } },
        },
        notified: { component: true, type: 'object', properties: {} },
      },
    }], [idKeywords]),
    get: () => [],
    apply: (bundles: Bundle[]) => (applied.push(...bundles), bundles),
    read: (q: unknown) => typeof q == 'string' ? [] : rows,
  } as unknown as Graph
  await hear(graph, null, session, (line) => lines.push(line))
  return { lines, marked: applied.map((b) => b.entity.eid) }
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

// A project with a sub-project, the personas its sessions wear and one from
// elsewhere. Three sessions wrote to the owner from the project: one still
// running, one its harness ended and one whose transcript stopped. The owner
// answered each, and answered the ended one's second letter at the
// sub-project's address.
let office = loadVocab([
  kernelDoc,
  docDoc,
  mailDoc,
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
let desk = graph({ storage: ram(office), vocab: office })
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
])
for (
  let bundle of [
    wrote('running', 'p'),
    wrote('ended', 'p'),
    wrote('ended', 'sub', 2),
    wrote('stopped', 'p'),
  ].flat()
) await desk.apply([bundle])

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
      ['reply-ended-1', 'reply-ended-2', 'reply-stopped-1'],
      'once a letter’s writer is over, a session of the project its reply reached hears it, or of a project above it',
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

test('a held reply may reach a session of its project or of one above it', async () => {
  let [atP, atSub] = await desk.get(['reply-ended-1', 'reply-ended-2'])
  equal((await heirs(desk, [atP])).sort(), ['next'])
  equal((await heirs(desk, [atSub])).sort(), ['nearby', 'next'])
})
