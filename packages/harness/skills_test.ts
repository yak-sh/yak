// Native skills read graph instructions without asking a machine for files.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, derivedEid, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { skillItems, skillTools } from './skills.ts'
import { harness } from './testing.ts'

let schema = await harness()
let vocab = schema.g.vocab
schema.close()
let fixture = async () => {
  let g = graph({ vocab, storage: ram(vocab) })
  let h = { g, close: () => {} }
  await h.g.apply([{
    entity: { eid: 'unavailable-machine' },
    workspace: { machine: 'unavailable-computer', root: '/unavailable' },
  }, {
    entity: { eid: 'session' },
    session: {},
    home: { workspace: 'unavailable-machine' },
  }, {
    entity: { eid: 'checking' },
    skill: {},
    doc: { title: 'checking', body: 'Check observable behavior' },
    content: { body: 'Exact graph instructions\n' },
  }])
  let tools = skillTools(h.g)
  let catalogue = async () =>
    (await skillItems(h.g, { session: 'session', tools }))
      .map((item) => 'text' in item ? item.text : '').join('\n')
  let load = async (skill = 'checking') => {
    let call: Bundle = {
      entity: { eid: crypto.randomUUID() },
      call: { id: skill },
      entry: { session: 'session' },
    }
    await h.g.apply([call])
    let result = await tools[0].run({ skill }, {
      session: 'session',
      call,
      entries: [call],
    })
    return { call, result }
  }
  return { ...h, tools, catalogue, load }
}
let exact = await fixture()
let edits = await fixture()
let manual = await fixture()
await manual.g.apply([{
  entity: { eid: 'checking' },
  skill: { invoke: 'user' },
}])
let ambiguous = await fixture()
await ambiguous.g.apply([{
  entity: { eid: 'duplicate' },
  skill: {},
  doc: { title: 'checking', body: 'Another repository' },
  content: { body: 'Different instructions' },
}])

let scoped = await fixture()
await scoped.g.apply([
  { entity: { eid: 'repository' }, repository: { common: '/repo/.git' } },
  {
    entity: { eid: 'project' },
    project: {},
    repo: { repository: 'repository' },
  },
  { entity: { eid: 'session' }, filed: { project: 'project' } },
  {
    entity: { eid: '$location' },
    file: {
      repository: 'repository',
      path: '.claude/skills/checking/SKILL.md',
    },
  },
  {
    entity: { eid: '$link' },
    edge: { from: 'checking', to: '$location' },
    references: {},
  },
  {
    entity: { eid: 'other' },
    skill: {},
    doc: { title: 'checking', body: 'Unrelated repository' },
    content: { body: 'Wrong instructions' },
  },
])

test('native session project scopes matching skill titles to its repository', async () => {
  try {
    let catalogue = await scoped.catalogue()
    assert(catalogue.includes('Check observable behavior'))
    assert(!catalogue.includes('Unrelated repository'))
    let { result } = await scoped.load()
    assert(result.includes('Exact graph instructions'))
    assert(result.includes('.claude/skills/checking'))
    assert(!result.includes('Wrong instructions'))
  } finally {
    scoped.close()
  }
})

test('native skills discover descriptions and load attributed graph instructions without a machine', async () => {
  try {
    let catalogue = await exact.catalogue()
    assert(catalogue.includes('Check observable behavior'))
    assert(!catalogue.includes('Exact graph instructions'))
    let { call, result } = await exact.load()
    assert(result.includes('Exact graph instructions\n'))
    let [inner] = await exact.g.get([
      derivedEid(`harness graph tool ${call.entity.eid}`),
    ])
    assertEquals((inner.created as Comp).by, 'session')
    assertEquals(
      await skillItems(exact.g, {
        session: 'session',
        tools: [],
      }),
      [],
    )
  } finally {
    exact.close()
  }
})

test('graph skill edits and removals reach the next native request', async () => {
  try {
    await edits.g.apply([{
      entity: { eid: 'checking' },
      doc: { body: 'Changed description' },
      content: { body: 'Changed instructions' },
    }])
    assert((await edits.catalogue()).includes('Changed description'))
    assert((await edits.load()).result.includes('Changed instructions'))
    await edits.g.apply([{ entity: { eid: 'checking' }, skill: null }])
    assertEquals(await edits.catalogue(), '')
    assert((await edits.load()).result.includes('No skill named checking'))
  } finally {
    edits.close()
  }
})

test('user-only graph skills stay hidden and refuse model loading', async () => {
  try {
    assertEquals(await manual.catalogue(), '')
    let { result } = await manual.load()
    assert(result.includes('user invocation only'))
    assert(!result.includes('Exact graph instructions'))
  } finally {
    manual.close()
  }
})

test('ambiguous graph skill names refuse rather than loading another repository', async () => {
  try {
    let { result } = await ambiguous.load()
    assert(result.includes('more than one repository'))
    assert(!result.includes('Different instructions'))
  } finally {
    ambiguous.close()
  }
})
