// A write through the tools answers what it made is near: the host composes
// this plugin's reply into its one runner (@yaks/cli `compose`), and a task,
// a memory or a comment a call made comes back with its nearest few of the
// same kind, then its nearest few resources of any kind.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, type Comp, mint } from '@yaks/graph'
import { compose, type Plug } from '@yaks/cli/host'
import { answerOf, toolEid, worded } from '@yaks/tools'
import { hashEmbedder, retries, searched, sweep } from './mod.ts'
import { fields } from './fields.ts'

retries.waits = [0]

let PLUGINS: Plug[] = [
  '@yaks/kernel',
  '@yaks/provenance',
  '@yaks/edge',
  '@yaks/doc',
  '@yaks/task',
  '@yaks/memory',
  '@yaks/model',
  '@yaks/notify',
  '@yaks/persona',
]

// A graph with this plugin, its embedder as given.
let open = (embedder?: Record<string, unknown>) =>
  compose({
    db: ':memory:',
    numbers: false,
    plugins: [
      ...PLUGINS,
      { use: '@yaks/embedding', with: embedder ? { embedder } : {} },
    ],
  }, ['graph'])

type Yak = Awaited<ReturnType<typeof open>>

let SHELF = [
  { title: 'Fix the login page crash on submit', memory: false },
  { title: 'Paint the garden shed green', memory: false },
  { title: 'Fix the login page crash on submit', memory: true },
]

// The graph before the call: two tasks, a memory and whatever else is given,
// each with its vector.
let stocked = async (yak: Yak, more: Bundle[] = []) => {
  await yak.graph.apply(SHELF.map((s, i) => ({
    entity: { eid: `old-${i}` },
    doc: { title: s.title },
    ...s.memory ? { memory: {} } : { task: {} },
  })))
  if (more.length) await yak.graph.apply(more)
  await sweep(
    yak.storage.statements,
    fields(yak.vocab, searched),
    hashEmbedder(),
  )
}

// A call, through the session `via` where one is given.
let call = async (
  yak: Yak,
  tool: string,
  args: Record<string, unknown>,
  via?: string,
) => {
  await yak.runner.ensure([tool])
  let id = mint()
  return answerOf(
    await yak.runner.call({
      entity: { eid: id },
      call: { to: toolEid(tool), args },
      ...via ? { $actor: { via } } : {},
    }),
    id,
  )
}

// The hits of one list: `near`, the possible twins, or `related`.
let hits = (answer: Bundle[], list = 'near'): Comp[] =>
  answer.filter((b) => (b.hit as Comp | undefined)?.[list]).map((b) => {
    let { [list]: _, ...h } = b.hit as Comp
    return { eid: b.entity.eid, ...h }
  })

let eids = (answer: Bundle[], list = 'near') =>
  hits(answer, list).map((h) => h.eid)

let made = (answer: Bundle[]) => answer.find((b) => b.created)!.entity.eid

test('a new task answers its nearest tasks, and not itself or a memory', async () => {
  let yak = await open({ provider: 'hash' })
  try {
    await stocked(yak)
    let answer = await call(yak, 'task_new', {
      title: 'The login page crashes on submit',
    })
    let found = hits(answer)
    assertEquals(found.map((h) => h.eid), ['old-0', 'old-1'])
    // The memory saying the same is related, though not a task.
    assertEquals(eids(answer, 'related'), ['old-2'])
    assertEquals(found[0], {
      eid: 'old-0',
      id: 'old-0',
      kind: 'task',
      title: 'Fix the login page crash on submit',
      snippet: '',
      source: 'meaning',
      status: 'open',
    })
    // What a model reads: the new task, then a line for each neighbour.
    assertEquals(
      worded(answer).split('\n').filter((l) => /^(near|related)/.test(l)),
      [
        `near ${
          made(answer)
        }: old-0 Fix the login page crash on submit · task open (meaning)`,
        `near ${
          made(answer)
        }: old-1 Paint the garden shed green · task open (meaning)`,
        `related to ${
          made(answer)
        }: old-2 Fix the login page crash on submit · memory (meaning)`,
      ],
    )

    // Two made by one call are not each other's neighbours: both are new.
    let plan = await call(yak, 'graph_apply', {
      bundles: ['again', 'once more'].map((w, i) => ({
        entity: { eid: `$t${i}` },
        doc: { title: `Fix the login page crash ${w}` },
        task: {},
      })),
    })
    let each = ['old-0', made(answer), 'old-1']
    assertEquals(eids(plan), [...each, ...each])

    // A write that created nothing is answered as it was.
    let moved = await call(yak, 'task_update', {
      task: 'old-1',
      title: 'Paint the garden shed blue',
    })
    assertEquals(hits(moved), [])
    // Nor is a read: what it answers was there already.
    assertEquals(hits(await call(yak, 'task_list', {})), [])
  } finally {
    await yak.close()
  }
})

test('a comment answers comments near it, shown by their words', async () => {
  let yak = await open({ provider: 'hash' })
  try {
    await stocked(yak)
    // The first comment's vector is made as it is answered, not by a sweep.
    await call(yak, 'comment_new', {
      target: 'old-0',
      body: 'The crash is in the submit handler of the login form.',
    })
    let answer = await call(yak, 'comment_new', {
      target: 'old-1',
      body: 'Found the submit handler crash on the login form.',
    })
    assertEquals(hits(answer).map(({ eid: _, id: __, ...h }) => h), [{
      kind: 'comment',
      target: 'old-0',
      snippet: 'The crash is in the submit handler of the login form.',
      source: 'meaning',
    }])
    assertEquals(
      worded(answer).split('\n').find((l) => l.startsWith('near'))
        ?.includes('· comment on old-0 (meaning) — The crash'),
      true,
    )
  } finally {
    await yak.close()
  }
})

test("a comment's neighbours leave out a run's receipt and the session's own comments", async () => {
  let yak = await open({ provider: 'hash' })
  try {
    let said = 'The crash is in the submit handler of the login form.'
    await stocked(yak, [
      ...['me', 'them'].map((eid) => ({
        entity: { eid },
        doc: { title: eid },
      })),
      {
        entity: { eid: 'receipt' },
        doc: { title: '#run — exited 0', body: said },
        comment: { target: 'old-0' },
        knock: { target: 'old-0' },
      },
    ])
    await call(yak, 'comment_new', { target: 'old-0', body: said }, 'me')
    let mine = await call(yak, 'comment_new', {
      target: 'old-1',
      body: said,
    }, 'me')
    assertEquals(hits(mine), [])
    assertEquals(hits(mine, 'related').some((h) => h.kind == 'comment'), false)
    // Another session's twin is a twin.
    let theirs = await call(yak, 'comment_new', {
      target: 'old-1',
      body: said,
    }, 'them')
    assertEquals(hits(theirs).length, 2)
    assertEquals(eids(theirs).includes('receipt'), false)
  } finally {
    await yak.close()
  }
})

test('a memory marked on words already said answers memories and what a person wrote', async () => {
  let yak = await open({ provider: 'hash' })
  try {
    let said = 'The login page crash on submit is fixed'
    await stocked(yak, [
      { entity: { eid: 'ada' }, person: {}, doc: { title: 'Ada' } },
      { entity: { eid: 'bot' }, doc: { title: 'a script' } },
      {
        entity: { eid: 'words' },
        comment: { target: 'old-0' },
        doc: { body: said },
      },
      ...['ada', 'bot'].map((by) => ({
        entity: { eid: `knock-${by}` },
        knock: { target: 'old-0' },
        doc: { body: `${said} exited 0` },
        $actor: { by },
      })),
    ])
    let answer = await call(yak, 'memory_save', { on: 'words' })
    assertEquals(eids(answer), ['old-2'])
    // A person's knock is a resource; a script's is a one-off notice.
    let related = eids(answer, 'related')
    assertEquals(related.includes('knock-ada'), true)
    assertEquals(related.includes('knock-bot'), false)
    // Marking it again makes nothing new.
    assertEquals(hits(await call(yak, 'memory_save', { on: 'words' })), [])
  } finally {
    await yak.close()
  }
})

test('a model out of reach leaves a twin found by its words', async () => {
  let yak = await open({ provider: 'box', model: 'm' })
  try {
    await yak.graph.apply([
      {
        entity: { eid: '$box' },
        provider: { name: 'box', api: 'ollama', base: 'http://127.0.0.1:9' },
      },
      { entity: { eid: '$m' }, model: { name: 'm' } },
      {
        entity: { eid: '$serves' },
        edge: { from: '$box', to: '$m' },
        serves: { name: 'm' },
      },
    ])
    await stocked(yak)
    let answer = await call(yak, 'task_new', {
      title: 'Fix the login page crash',
    })
    assertEquals(hits(answer).map((h) => [h.eid, h.source]), [
      ['old-0', 'text'],
    ])
  } finally {
    await yak.close()
  }
})
