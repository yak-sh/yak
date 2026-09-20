// The two words, over a graph small enough to read: what a save writes, what
// a patch leaves alone, and the token that stands between a merge and a
// clobber.
import { assert, assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Comp, graph, token, type ToolCtx } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { memoryDoc } from './comp.ts'
import { line } from './recall.ts'
import { runs, unread, witnessed } from './tools.ts'

// What a memory points AT: the portfolio it is scoped to, and the person whose
// correction it records. Spelled here rather than composed, so the test says
// its whole world in one place.
let around: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    project: {
      component: true,
      type: 'object',
      kind: true,
      properties: {},
    },
    created: {
      component: true,
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    person: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: {} },
    },
  },
}

let vocab = loadVocab([docDoc, memoryDoc, around])
let tools = runs()

let fresh = () => graph({ storage: ram(vocab), vocab, plugins: [] })

let ctx = (args: Record<string, unknown>, g = fresh()) =>
  ({ graph: g, read: (q: string) => g.read(q), args }) as unknown as ToolCtx

let comp = (b: Bundle | undefined, name: string) => b?.[name] as Comp

let save = async (args: Record<string, unknown>, g: ReturnType<typeof fresh>) =>
  await g.apply(await tools.memory_save!([], ctx(args, g)) as Bundle[])

let read = async (g: ReturnType<typeof fresh>, eid: string) =>
  (await g.read(`.eid=${eid}`))[0]

Deno.test('every memory tool is declared and implemented', () => {
  assertEquals(loadTools(memoryDoc, tools).map((t) => t.name).sort(), [
    'memory_recall',
    'memory_save',
  ])
})

Deno.test('a new memory is the sentence, and where it belongs', async () => {
  let g = fresh()
  await g.apply([{ entity: { eid: 'p19' }, project: {} }])
  let [said] = await tools.memory_save!(
    [],
    ctx({
      said: '  always commit your changes  ',
      title: 'commit as you go',
      scope: 'p19',
      context: 'we were talking about\nlanding work',
    }, g),
  ) as Bundle[]
  assertEquals(comp(said, 'doc'), {
    title: 'commit as you go',
    body: 'always commit your changes',
  })
  assertEquals(comp(said, 'memory'), {
    scope: 'p19',
    context: 'we were talking about\nlanding work',
  })
  // Nobody said it was feedback, so it wears none.
  assert(!said.feedback)
})

Deno.test('feedback names who gave it, or says only that somebody did', async () => {
  let by = async (feedback: string) =>
    comp(
      (await tools.memory_save!(
        [],
        ctx({ said: 'use grams', feedback }),
      ) as Bundle[])[0],
      'feedback',
    )
  assertEquals(await by('jeff'), { by: 'jeff' })
  assertEquals(await by(''), {})
})

Deno.test('a patch leaves alone what the line left out', async () => {
  let g = fresh()
  await save({ said: 'use grams, never cups', title: 'measurements' }, g)
  let m = (await g.read('.memory'))[0].entity.eid
  await save({ id: m, scope: 'p19', context: 'the recipe app' }, g)
  assertEquals(comp(await read(g, m), 'doc'), {
    title: 'measurements',
    body: 'use grams, never cups',
  })
  assertEquals(comp(await read(g, m), 'memory'), {
    scope: 'p19',
    context: 'the recipe app',
  })
})

Deno.test('the words are not replaced by somebody who never read them', async () => {
  let g = fresh()
  await save({ said: 'use grams, never cups' }, g)
  let m = (await g.read('.memory'))[0].entity.eid
  let no = await assertRejects(
    async () =>
      await tools.memory_save!([], ctx({ id: m, said: 'use cups' }, g)),
    Error,
  ) as Error
  assertEquals(no.message, unread(m))
  // With the token that came back on the read, it lands.
  let was = witnessed(await read(g, m)).$was!.doc.body
  await save({ id: m, said: 'use cups', was }, g)
  assertEquals(comp(await read(g, m), 'doc').body, 'use cups')
  // And a token for words that have since moved is refused, whole.
  await assertRejects(
    () => save({ id: m, said: 'use spoons', was }, g),
    Error,
    'has moved since it was read',
  )
  assertEquals(comp(await read(g, m), 'doc').body, 'use cups')
})

Deno.test('a memory this graph does not hold is said so', async () => {
  await assertRejects(
    async () => await tools.memory_save!([], ctx({ id: 'nobody', said: 'x' })),
    Error,
    'no memory: nobody',
  )
})

Deno.test('a recall asks the store for the ranking it has', () => {
  // Words: the store's own index over `doc` ranks them, so nothing orders.
  assertEquals(
    line({ limit: 8, said: 'how do they like it?' }),
    'how do they like it&.memory&.doc?&.created?&.limit=8',
  )
  // An anchor: the vectors rank them, where the host keeps any.
  assertEquals(
    line({ limit: 3, near: 'T-1' }),
    '.near=T-1&.memory&.doc?&.created?&.order=similar&.limit=3',
  )
  // Neither: the newest, screened by where they belong.
  assertEquals(
    line({ limit: 2, scope: 'p19', feedback: true }),
    '.memory&.memory.scope=p19&.feedback&.doc?&.created?' +
      '&.order=-entity.num&.limit=2',
  )
})

Deno.test('a recall answers whole memories, each wearing its token', async () => {
  let g = fresh()
  await save({ said: 'use grams, never cups', feedback: 'jeff' }, g)
  await save({ said: 'always commit your changes' }, g)
  let out = await tools.memory_recall!([], ctx({}, g)) as Bundle[]
  assertEquals(out.length, 2)
  for (let b of out) {
    assertEquals(b.$was, { doc: { body: token(comp(b, 'doc').body) } })
  }
  // Only the ones recording a correction, when that is what was asked.
  let feedback = await tools.memory_recall!(
    [],
    ctx({ feedback: true }, g),
  ) as Bundle[]
  assertEquals(feedback.map((b) => comp(b, 'doc').body), [
    'use grams, never cups',
  ])
})
