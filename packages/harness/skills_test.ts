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
    entity: { eid: 'unavailable-computer' },
    machine: { address: 'missing://computer' },
  }, {
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
  // A model's calls already exist when the tool executes. Keep admission
  // setup outside the action these cases measure, with a fresh call per load.
  let calls: Bundle[] = Array.from({ length: 3 }, (_, i) => ({
    entity: { eid: crypto.randomUUID() },
    call: { id: 'skill-' + i },
    entry: { session: 'session' },
  }))
  await h.g.apply(calls)
  let load = async (skill = 'checking') => {
    let call = calls.shift()!

    let result = await tools[0].run({ skill }, {
      session: 'session',
      call,
      entries: [call],
    })
    return { call, result }
  }
  // The tool catalogue is installed before a running session makes requests.
  // Prime that setup with its own call; measured loads still use fresh calls.
  await catalogue()
  await load()
  return { ...h, tools, catalogue, load }
}
let exact = await fixture()
let edits = await fixture()
let removed = await fixture()
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
  } finally {
    scoped.close()
  }
})

// Capture graph-runner integrations with their complete stored receipts; cases
// below check each result separately from catalogue generation.
let scopedLoad = await scoped.load()
test('scoped skill loading returns only the selected repository instructions', () => {
  let { result } = scopedLoad
  assert(result.includes('Exact graph instructions'))
  assert(result.includes('.claude/skills/checking'))
  assert(!result.includes('Wrong instructions'))
})

test('native skills discover descriptions and load attributed graph instructions without a machine', async () => {
  try {
    let catalogue = await exact.catalogue()
    assert(catalogue.includes('Check observable behavior'))
    assert(!catalogue.includes('Exact graph instructions'))
  } finally {
    exact.close()
  }
})

let exactLoad = await exact.load()
test('native skill loading attributes graph instructions without a machine', async () => {
  try {
    let { call, result } = exactLoad
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

// Both fixtures have already served the initial catalogue and instructions.
// Edits occur between requests; the next request must not reuse those values.
await edits.g.apply([{
  entity: { eid: 'checking' },
  doc: { body: 'Changed description' },
  content: { body: 'Changed instructions' },
}])
await removed.g.apply([{ entity: { eid: 'checking' }, skill: null }])

test('graph skill edits reach the next native catalogue', async () => {
  assert((await edits.catalogue()).includes('Changed description'))
})
let editedLoad = await edits.load()
test('graph skill edits reach the next native instruction load', () => {
  assert(editedLoad.result.includes('Changed instructions'))
})
test('graph skill removals reach the next native catalogue', async () => {
  assertEquals(await removed.catalogue(), '')
})
let removedLoad = await removed.load()
test('graph skill removals refuse the next native instruction load', () => {
  assert(removedLoad.result.includes('No skill named checking'))
})

let manualLoad = await manual.load()
test('user-only graph skills stay hidden and refuse model loading', async () => {
  try {
    assertEquals(await manual.catalogue(), '')
    let { result } = manualLoad
    assert(result.includes('user invocation only'))
    assert(!result.includes('Exact graph instructions'))
  } finally {
    manual.close()
  }
})

let ambiguousLoad = await ambiguous.load()
test('ambiguous graph skill names refuse rather than loading another repository', () => {
  try {
    let { result } = ambiguousLoad
    assert(result.includes('more than one repository'))
    assert(!result.includes('Different instructions'))
  } finally {
    ambiguous.close()
  }
})
