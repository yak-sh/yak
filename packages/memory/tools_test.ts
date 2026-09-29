// The memory tools, over a graph small enough to read: what a save writes or
// marks, what a patch leaves alone, the token that stands between a merge and a
// clobber, and the four reads around a memory.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  type Actor,
  type Bundle,
  type Comp,
  graph,
  Refused,
  signed,
  token,
} from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { loadVocab, type PropSchema, type VocabDoc } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { memoryDoc } from './comp.ts'
import { type Asked, heard, line } from './recall.ts'
import { saved } from './save.ts'
import { runs, unread, witnessed } from './tools.ts'

// What a memory lives among: the portfolio it is scoped to, the people and
// sessions that write, transcripts, comments and tasks that hold words, and
// what a session worked on. Written out here rather than composed, so the test
// says its whole world in one place.
let ref: PropSchema = { type: 'string', ref: 'entity', death: 'keep' }
let stamp = { stamped: true }
let comp = (
  properties: Record<string, PropSchema> = {},
  kind = false,
): PropSchema => ({
  component: true,
  type: 'object',
  ...(kind ? { kind: true, before: ['doc'] } : {}),
  properties,
})
let around: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    created: comp({
      at: { type: 'string', format: 'date-time', ...stamp },
      by: { ...ref, ...stamp },
      via: { ...ref, ...stamp },
    }),
    project: comp({}, true),
    person: comp({ name: { type: 'string' } }, true),
    session: comp({}, true),
    task: comp({}, true),
    comment: comp({ target: { ...ref, death: 'cascade' } }, true),
    entry: comp({
      session: { ...ref, death: 'cascade' },
      seq: { type: 'number' },
    }, true),
    content: comp({ body: { type: 'string' } }),
    edge: comp({
      from: { ...ref, death: 'cascade' },
      to: { ...ref, death: 'cascade' },
    }, true),
    worked: comp(),
    claim: comp({ session: ref }),
  },
}

let vocab = loadVocab([docDoc, memoryDoc, around])
let tools = runs()

type G = ReturnType<typeof fresh>
let fresh = () => graph({ storage: ram(vocab), vocab, plugins: [] })

// Writes as somebody, at a moment, so who said what, and in which order, is
// the test's to state.
let tick = 0
let write = (g: G, change: Bundle[], who: Actor = {}) =>
  g.apply(signed(change, who), {
    now: new Date(Date.UTC(2026, 8, 1, 0, 0, tick++)).toISOString(),
  })

let call = (args: Record<string, unknown>): Bundle => ({
  entity: { eid: 'c1' },
  call: { args },
})

let ask = async (name: string, args: Record<string, unknown>, g: G) =>
  await tools[name]!(call(args), g) as Bundle[]

let save = async (args: Record<string, unknown>, g: G, who: Actor = {}) =>
  await write(g, await ask('memory_save', args, g), who)

let part = (b: Bundle | undefined, name: string) => b?.[name] as Comp
let eids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)
let read = async (g: G, eid: string) => (await g.get([eid]))[0]
let marks = async (g: G) => eids(await g.read('.memory'))

// A transcript: entries in one session, each what somebody typed or replied.
let said = (session: string, seq: number, body: string): Bundle => ({
  entity: { eid: `${session}.${seq}` },
  entry: { session, seq },
  content: { body },
})

let jeff = { by: 'jeff', via: 's1' }
let agent = { by: 'agent', via: 's1' }

test('every memory tool is declared and implemented', () => {
  assertEquals(loadTools(memoryDoc, tools).map((t) => t.name).sort(), [
    'memory_around',
    'memory_recall',
    'memory_save',
    'memory_session',
    'memory_source',
    'memory_target',
    'memory_thread',
  ])
})

test('words the graph already holds are marked where they are', async () => {
  let g = fresh()
  await write(g, [
    said('s1', 1, 'ok so the persona.\nuse grams,   never cups. and commit'),
  ], jeff)
  await save(
    {
      said: 'use grams, never cups',
      context: 'the recipe app',
      feedback: 'jeff',
    },
    g,
    agent,
  )
  // The entry itself is the memory: no copy of the words anywhere.
  assertEquals(await marks(g), ['s1.1'])
  let e = await read(g, 's1.1')
  assertEquals(part(e, 'doc'), undefined)
  assertEquals(part(e, 'memory').context, 'the recipe app')
  // Who marked it is the mark's; who said it stays the entry's.
  assertEquals(part(e, 'memory').by, 'agent')
  assert(part(e, 'memory').at)
  assertEquals(part(e, 'created').by, 'jeff')
  // And a recall answers it with the words it holds.
  let [back] = await ask('memory_recall', { said: 'grams' }, g)
  assertEquals(heard(back).said, part(e, 'content').body)
})

test('the words are marked where their speaker first said them', async () => {
  let g = fresh()
  await write(g, [{
    entity: { eid: 'quote' },
    doc: { body: 'Jeff says: "always commit your changes"' },
  }], agent)
  await write(g, [said('s1', 1, 'always commit your changes')], jeff)
  await write(g, [said('s1', 2, 'always commit your changes')], jeff)
  await save({ said: 'always commit your changes', feedback: 'jeff' }, g, agent)
  assertEquals(await marks(g), ['s1.1'])
  // Words nobody says whose they are cannot be placed, so they are kept as
  // their own.
  await save({ said: 'always commit your changes' }, g, agent)
  let [kept] = (await marks(g)).filter((e) => e != 's1.1')
  assertEquals(
    part(await read(g, kept), 'doc').body,
    'always commit your changes',
  )
})

test('source is where a person said the words, never a quote of them', async () => {
  let g = fresh()
  await write(g, [{
    entity: { eid: 'quote' },
    doc: { body: 'Jeff says: "always commit your changes"' },
  }], agent)
  await write(g, [said('s1', 1, 'ok. always commit\nyour  changes')], jeff)
  let source = (said: string) => ask('memory_source', { said, by: 'jeff' }, g)
  assertEquals(eids(await source('always commit your changes')), ['s1.1'])
  await assertRejects(() => source('Jeff says'), Refused, 'nothing jeff wrote')
})

test('on marks the entity named, only for words it holds', async () => {
  let g = fresh()
  await write(g, [
    { entity: { eid: 't1' }, task: {}, doc: { title: 'a task' } },
    {
      entity: { eid: 'k1' },
      comment: { target: 't1' },
      doc: { body: 'stop building gates' },
    },
  ], jeff)
  await save({ on: 'k1', feedback: 'jeff' }, g, agent)
  assertEquals(await marks(g), ['k1'])
  assertEquals(part(await read(g, 'k1'), 'feedback'), { by: 'jeff' })
  assertEquals(part(await read(g, 'k1'), 'doc').body, 'stop building gates')
  // It is still a comment: a mark says what happened to it, not what it is.
  assertEquals(vocab.kindOf(await read(g, 'k1')), 'comment')
  await assertRejects(
    () => ask('memory_save', { on: 'k1', said: 'build more gates' }, g),
    Refused,
    'does not hold those words',
  )
  await assertRejects(
    () => ask('memory_save', { on: 't1' }, g),
    Refused,
    't1 holds no words',
  )
  // The words of a mark are what happened there, and a save never replaces
  // them.
  let was = witnessed(await read(g, 'k1')).$was!.doc.body
  await assertRejects(
    () => ask('memory_save', { id: 'k1', said: 'x', was }, g),
    Refused,
    'never replaces those words',
  )
})

test('a new memory is the sentence, and where it belongs', async () => {
  let g = fresh()
  await write(g, [{ entity: { eid: 'p19' }, project: {} }])
  let [kept] = await ask('memory_save', {
    said: '  always commit your changes  ',
    title: 'commit as you go',
    scope: 'p19',
    context: 'we were talking about\nlanding work',
  }, g)
  assertEquals(part(kept, 'doc'), {
    title: 'commit as you go',
    body: 'always commit your changes',
  })
  assertEquals(part(kept, 'memory'), {
    scope: 'p19',
    context: 'we were talking about\nlanding work',
  })
  // Nobody said it was feedback, so it wears none.
  assert(!kept.feedback)
  await assertRejects(() => ask('memory_save', { said: ' ' }, g), Refused)
})

test('feedback names who gave it, or says only that somebody did', async () => {
  let by = async (feedback: string) =>
    part(
      (await ask('memory_save', { said: 'use grams', feedback }, fresh()))[0],
      'feedback',
    )
  assertEquals(await by('jeff'), { by: 'jeff' })
  assertEquals(await by(''), {})
})

test('a patch leaves alone what the line left out', async () => {
  let g = fresh()
  await save({ said: 'use grams, never cups', title: 'measurements' }, g)
  let [m] = await marks(g)
  await save({ id: m, scope: 'p19', context: 'the recipe app' }, g)
  assertEquals(part(await read(g, m), 'doc'), {
    title: 'measurements',
    body: 'use grams, never cups',
  })
  let memory = part(await read(g, m), 'memory')
  assertEquals([memory.scope, memory.context], ['p19', 'the recipe app'])
})

test('the words are not replaced by somebody who never read them', async () => {
  let g = fresh()
  await save({ said: 'use grams, never cups' }, g)
  let [m] = await marks(g)
  await assertRejects(
    () => ask('memory_save', { id: m, said: 'use cups' }, g),
    Refused,
    unread(m),
  )
  // With the token that came back on the read, it lands.
  let was = witnessed(await read(g, m)).$was!.doc.body
  await save({ id: m, said: 'use cups', was }, g)
  assertEquals(part(await read(g, m), 'doc').body, 'use cups')
  // And a token for words that have since moved is refused, whole.
  await assertRejects(
    () => save({ id: m, said: 'use spoons', was }, g),
    Error,
    'has moved since it was read',
  )
  assertEquals(part(await read(g, m), 'doc').body, 'use cups')
})

test('a memory this graph does not hold is said so', async () => {
  await assertRejects(
    () => ask('memory_save', { id: 'nobody', said: 'x' }, fresh()),
    Refused,
    'no memory: nobody',
  )
})

test('a recall answers whole memories, each wearing its token', async () => {
  let g = fresh()
  await save({ said: 'use grams, never cups', feedback: 'jeff' }, g)
  await save({ said: 'always commit your changes' }, g)
  let out = await ask('memory_recall', {}, g)
  // The newest words first.
  assertEquals(out.map((b) => heard(b).said), [
    'always commit your changes',
    'use grams, never cups',
  ])
  for (let b of out) {
    assertEquals(b.$was, { doc: { body: token(part(b, 'doc').body) } })
  }
  // Only the ones recording a correction, when that is what was asked.
  let feedback = await ask('memory_recall', { feedback: true }, g)
  assertEquals(feedback.map((b) => heard(b).said), ['use grams, never cups'])
})

test('a recall stays in its space, and words never speak its grammar', async () => {
  let g = fresh()
  let [a] = eids(
    await write(
      g,
      saved({ eid: '$a', said: 'how they like it', space: 'ada' }),
    ),
  )
  let [b] = eids(
    await write(g, saved({ eid: '$b', said: 'how they like it', space: 'bo' })),
  )
  let recall = async (asked: Partial<Asked>) =>
    eids(await g.read(line({ limit: 8, space: 'ada', ...asked })))
  // `.doc` is two words here, and the text has no "doc" in it.
  assertEquals(await recall({ said: '.doc&how they like it' }), [])
  assertEquals(await recall({ said: 'how they&like it?' }), [a])
  // A ranker answered with ids: the space still bounds them, so one space
  // cannot rank another's memories in.
  assertEquals(await recall({ eids: [a, b] }), [a])
})

// A transcript with a gap in its numbering, and the second session beside it.
let transcript = async (g: G) => {
  await write(g, [{ entity: { eid: 's1' }, session: {} }])
  for (let seq of [1, 2, 4, 5, 6, 7, 9]) {
    await write(g, [said('s1', seq, `line ${seq}`)])
  }
  await write(g, [said('s2', 5, 'elsewhere')])
}

test('around reads an entry as grep -C reads a line', async () => {
  let g = fresh()
  await transcript(g)
  let seqs = async (args: Record<string, unknown>) =>
    (await ask('memory_around', args, g)).map((b) => part(b, 'entry').seq)
  assertEquals(await seqs({ id: 's1.5', before: 2, after: 1 }), [2, 4, 5, 6])
  assertEquals(await seqs({ id: 's1.5' }), [1, 2, 4, 5, 6, 7, 9])
  assertEquals(await seqs({ id: 's1.1', before: 0, after: 0 }), [1])
  // Whole: every component rides back, the words among them.
  let [e] = await ask('memory_around', { id: 's1.9', before: 0 }, g)
  assertEquals(part(e, 'content').body, 'line 9')
  await assertRejects(
    () => ask('memory_around', { id: 's1' }, g),
    Refused,
    'no transcript entry',
  )
})

// A task, two comments on it, a reply to the first and a reply to that.
let discussion = async (g: G) => {
  let on = (eid: string, target: string) => ({
    entity: { eid },
    comment: { target },
    doc: { body: eid },
  })
  await write(g, [{ entity: { eid: 't1' }, task: {}, doc: { title: 't' } }])
  await write(g, [on('k1', 't1')])
  await write(g, [on('k2', 't1')])
  await write(g, [on('r1', 'k1')])
  await write(g, [on('r2', 'r1')])
  await write(g, [{ entity: { eid: 't9' }, task: {}, doc: { title: 'quiet' } }])
}

test('target is what a comment is aimed at, whole', async () => {
  let g = fresh()
  await discussion(g)
  let [t] = await ask('memory_target', { id: 'k1' }, g)
  assertEquals([t.entity.eid, vocab.kindOf(t)], ['t1', 'task'])
  assertEquals(eids(await ask('memory_target', { id: 'r2' }, g)), ['r1'])
  await assertRejects(
    () => ask('memory_target', { id: 't1' }, g),
    Refused,
    'aimed at nothing',
  )
})

test('a thread is what it is about, then every comment, oldest first', async () => {
  let g = fresh()
  await discussion(g)
  let thread = ['t1', 'k1', 'k2', 'r1', 'r2']
  assertEquals(eids(await ask('memory_thread', { id: 'r2' }, g)), thread)
  assertEquals(eids(await ask('memory_thread', { id: 't1' }, g)), thread)
  assertEquals(eids(await ask('memory_thread', { id: 't9' }, g)), ['t9'])
})

test('session is where it was said, and what that session worked on', async () => {
  let g = fresh()
  await transcript(g)
  await write(g, [
    { entity: { eid: 't1' }, task: {}, doc: { title: 'worked' } },
    { entity: { eid: 't2' }, task: {}, claim: { session: 's1' } },
    { entity: { eid: 'w1' }, edge: { from: 's1', to: 't1' }, worked: {} },
  ])
  assertEquals(eids(await ask('memory_session', { id: 's1.4' }, g)), [
    's1',
    't1',
    't2',
  ])
  // Anything else: the session it was written through.
  await write(g, [{
    entity: { eid: 'k1' },
    comment: { target: 't1' },
    doc: { body: 'x' },
  }], {
    by: 'jeff',
    via: 's1',
  })
  assertEquals(eids(await ask('memory_session', { id: 'k1' }, g))[0], 's1')
  // Something written through anything but a session was said in none.
  await write(g, [{ entity: { eid: 'p1' }, person: {} }])
  await write(g, [{ entity: { eid: 'k2' }, comment: { target: 't1' } }], {
    via: 'p1',
  })
  for (let id of ['t1', 'k2']) {
    await assertRejects(
      () => ask('memory_session', { id }, g),
      Refused,
      'written through no session',
    )
  }
})
