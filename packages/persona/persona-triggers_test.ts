// Persona link births must owe durable work, not every edge in the graph;
// the claimed runs still write the checkout's instruction files.
import { equal, test, until } from '@yaks/testing'
import { effects, moves } from './effects.ts'
import { personaFiles } from './files.ts'
import type { Graph } from '@yaks/graph'
import type { Event } from '@yaks/effects'
import { link, owing, world } from './testing.ts'

let fixture = () => owing('persona_files')

test('only persona relations owe persona files, including a tag added to an existing edge', async () => {
  let { g, queued, clear } = fixture()
  await g.apply([
    { entity: { eid: 'persona' }, persona: {} },
    { entity: { eid: 'document' }, doc: { body: 'instructions' } },
  ])
  await clear()
  await g.apply([{
    entity: { eid: 'plain' },
    edge: { from: 'persona', to: 'document' },
  }, link('persona', 'references', 'document')])
  equal(await queued(), [])
  for (let relation of ['contains', 'reads']) {
    await g.apply([link('persona', relation, 'document')])
    equal((await queued()).length, 1)
    await clear()
  }
  await g.apply([{ entity: { eid: 'plain' }, contains: {} }])
  equal((await queued()).length, 1)
})

test('created contains and reads links rewrite persona files through the effects pool', async () => {
  let root = await Deno.makeTempDir({ prefix: 'persona-links-' })
  let stopping = new AbortController()
  let { g, fx, queued, errors } = fixture()
  fx.handle(effects(
    {
      graph: g,
      config: { db: `${root}/graph.db` },
      stopping: stopping.signal,
    },
    { files: true },
    { after: 0 },
  ))
  try {
    await g.apply([
      { entity: { eid: 'project' }, project: {}, repo: { repository: 'repo' } },
      { entity: { eid: 'repo' }, repository: { common: `${root}/.git` } },
      {
        entity: { eid: 'checkout' },
        worktree: { repository: 'repo', path: root, gitdir: `${root}/.git` },
      },
      {
        entity: { eid: 'persona' },
        persona: { home: 'project' },
        doc: { title: 'Common', body: 'base instructions' },
      },
      {
        entity: { eid: 'included' },
        doc: { title: 'Included', body: 'new rule' },
      },
      {
        entity: { eid: 'mentioned' },
        doc: { title: 'Reference document', body: 'not included' },
      },
      link('project', 'contains', 'persona'),
    ])
    let file = `${root}/.tasks/AGENTS.md`
    let text = async () => {
      try {
        return await Deno.readTextFile(file)
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error
        return ''
      }
    }
    await fx.work(g)
    equal(errors, [])
    await until(async () => (await text()).includes('base instructions'), {
      timeout: 5_000,
      label: 'initial persona files',
    })
    equal(await queued(), [])
    await g.apply([link('persona', 'contains', 'included')])
    equal((await queued()).length, 1)
    await fx.work(g)
    equal(errors, [])
    await until(async () => (await text()).includes('new rule'), {
      timeout: 5_000,
      label: 'included document in persona files',
    })
    await g.apply([link('persona', 'reads', 'mentioned')])
    equal((await queued()).length, 1)
    await fx.work(g)
    equal(errors, [])
    await until(async () => (await text()).includes('Reference document'), {
      timeout: 5_000,
      label: 'read document in persona files',
    })
    equal((await text()).includes('not included'), false)
    equal(errors, [])
  } finally {
    stopping.abort()
    await fx.stop()
    await Deno.remove(root, { recursive: true })
  }
})

let checkout = [
  { entity: { eid: 'project' }, project: {}, repo: { repository: 'repo' } },
  { entity: { eid: 'repo' }, repository: { common: '/code/.git' } },
  {
    entity: { eid: 'tree' },
    worktree: { repository: 'repo', path: '/code', gitdir: '/code/.git' },
  },
  {
    entity: { eid: 'persona' },
    persona: { home: 'project' },
    doc: { title: 'Common', body: 'base instructions' },
  },
  link('project', 'contains', 'persona'),
]

// Put `archived` on an entity, or take it off, as the pool would tell the
// effect, and whether that starts a pass. `said` is what the last pass said:
// the persona of the project with the checkout.
let archive = async (g: Graph, said: Set<string>, eid: string, on: boolean) => {
  await g.apply([{ entity: { eid }, archived: on ? {} : null }])
  let event = {
    kind: on ? 'created' : 'removed',
    name: 'archived',
    entity: { eid },
  }
  return moves(event as Event, g.storage, said)
}

let paths = async (g: Graph) => (await personaFiles(g)).files.map((f) => f.path)

test('archiving a project takes its persona files away', async () => {
  let g = world()
  await g.apply(checkout)
  equal(await archive(g, new Set(['persona']), 'project', true), true)
  equal(await paths(g), [])
})

test('restoring a project brings its persona files back', async () => {
  let g = world()
  await g.apply([...checkout, { entity: { eid: 'project' }, archived: {} }])
  equal(await paths(g), [])
  equal(await archive(g, new Set(), 'project', false), true)
  equal(await paths(g), ['/code/.tasks/AGENTS.md'])
})

test('archiving what holds no checkout starts no pass', async () => {
  let g = world()
  await g.apply([
    ...checkout,
    { entity: { eid: 'bare' }, project: {} },
    { entity: { eid: 'note' }, doc: { title: 'Note', body: '' } },
  ])
  let said = new Set(['persona'])
  equal(await archive(g, said, 'bare', true), false)
  equal(await archive(g, said, 'note', true), false)
})

test('putting an entity away, or bringing it back, owes persona files', async () => {
  let { g, queued } = fixture()
  await g.apply([{ entity: { eid: 'project' }, project: {} }])
  for (let [archived, owed] of [[{}, 1], [null, 2]] as const) {
    await g.apply([{ entity: { eid: 'project' }, archived }])
    equal((await queued()).length, owed)
  }
})
