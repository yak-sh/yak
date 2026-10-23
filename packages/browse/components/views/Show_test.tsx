// The full document face's section renderers — especially the meta line,
// where an absent field must paint nothing. A renderer is a component: every
// case mounts it through Preact (mount.ts) and asserts on the resulting DOM,
// never on a bare call's vnode tree.
import { test, tick, until } from '../../testing.ts'
import { test as preparedTest } from '@yaks/testing'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { assert, assertEquals, assertExists } from '@std/assert'
import {
  cache,
  config,
  deps,
  ent,
  landSub,
  problem,
  routeName,
  unsubscribe,
  useRoute,
} from '../../live.ts'
import { parse } from '@yaks/query'
import { extend, resolve, ux } from '../registry.ts'
import { Ux } from '@yaks/ux'
import { mount } from '../mount.ts'
import { Entity } from '../Entity.tsx'
import { Pip } from './Show.tsx'
import { views as docViews } from '@yaks/doc/views'
import { views as toolViews } from '@yaks/tools/views'
import { toolEid } from '@yaks/tools'
import { applicable } from '../registry.ts'
import { contributedViews } from '../inspect.tsx'
import type { Change, Ent } from '../../types.ts'

// Lay globals over the window for one case, as linkedom lacks what a Float
// reads (its size, ResizeObserver); the returned function puts them back.
let windowed = (globals: Record<string, unknown> = {}) => {
  let all = {
    innerWidth: 1000,
    innerHeight: 800,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    ...globals,
  }
  let prior = Object.keys(all).map((k) =>
    [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const
  )
  for (let [k, value] of Object.entries(all)) {
    Object.defineProperty(globalThis, k, { value, configurable: true })
  }
  return () => {
    for (let [k, d] of prior) {
      if (d) Object.defineProperty(globalThis, k, d)
      else delete (globalThis as Record<string, unknown>)[k]
    }
  }
}

test('task acceptance is a distinct Markdown section', () => {
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      doc: { eid: 'task', title: 'Ship it', body: 'Implementation notes' },
      task: { eid: 'task' },
      filed: { eid: 'task', priority: 1 },
      accept: { eid: 'task', body: '- exits zero' },
    },
  }
  let e = ent('task')
  let { root, free } = mount(h(resolve(e, 'Acceptance').Render, { e }))
  try {
    assertEquals(
      root.querySelector('.Show_AcceptanceTitle')?.textContent,
      'Acceptance',
    )
    assertEquals(
      root.querySelector('.Show_AcceptanceBody li')?.textContent,
      'exits zero',
    )
  } finally {
    free()
    cache.value = {}
  }
})

// Assembly and renderer selection are fixtures; this case checks the absent
// section's paint, not constructing a live replica entity.
let noCriteriaRow = {
  entity: { eid: 'no-criteria', num: 1 },
  doc: { eid: 'no-criteria', title: 'No criteria', body: 'Body only' },
}
let noCriteria: Ent = {
  ...noCriteriaRow,
  eid: 'no-criteria',
  num: 1,
  kind: 'doc',
  refs: [],
  kids: [],
}
let noAcceptance = resolve(noCriteria, 'Acceptance')
preparedTest(
  'a doc without accept renders no Acceptance section, not JSON',
  () => {
    assertEquals(noAcceptance.view, 'Acceptance')
    let { root, free } = mount(h(noAcceptance.Render, { e: noCriteria }))
    assertEquals(root.querySelector('.Json'), null)
    assertEquals(root.querySelector('.Show_Acceptance'), null)
    free()
  },
)

// This case checks Meta's paint, so build its document face and select its
// renderer once; assembling an Ent from the live replica is a separate seam.
let quietRow = {
  entity: { eid: 'doc', num: 1 },
  doc: { eid: 'doc', title: 'Quiet document', body: '' },
}
let quietDoc: Ent = {
  ...quietRow,
  eid: 'doc',
  num: 1,
  kind: 'doc',
  refs: [],
  kids: [],
}
let quietMeta = resolve(quietDoc, 'Meta').Render

preparedTest('document meta paints no tally when it has no comments', () => {
  let { root, free } = mount(h(quietMeta, { e: quietDoc, id: true }))
  assertEquals(root.querySelector('.Show_Comments'), null)
  free()
})

// T-33921: a row render reaches NO transport. The comment tally is the
// client's one aggregate, opened at boot beside the socket it rides; a tile
// only reads the shared map, with the local working-set count until the server
// answers. It used to open from inside commentCount's computed — a wire dial
// mid-diff, which in a process that named no server (a bench, a test) reached
// for one it was never given.
test('the meta row renders its tally without reaching live', () => {
  let host = config.host
  config.host = ''
  // Cold: whatever an earlier mount left open, the render below must face an
  // unopened tally and still open nothing.
  unsubscribe('agg:comments')
  let restore = useRoute(() => {
    throw new Error('a row render reached the transport')
  })
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      doc: { eid: 'task', title: 'Talked about', body: '' },
      task: { eid: 'task' },
      filed: { eid: 'task', priority: 1 },
    },
    c1: {
      entity: { eid: 'c1', num: 2 },
      comment: { eid: 'c1', target: 'task' },
    },
  }
  let e = ent('task')
  let { root, free } = mount(h(resolve(e, 'Meta').Render, { e, id: true }))
  try {
    assertEquals(root.querySelector('.Show_Comments')?.textContent, '1')
  } finally {
    free()
    useRoute(restore)
    config.host = host
    cache.value = {}
  }
})

preparedTest('empty document meta remains a first-class null', () => {
  let { root, free } = mount(h(quietMeta, { e: quietDoc }))
  assertEquals(root.innerHTML, '')
  free()
})

test('proposal meta distinguishes pending, cancelled, and approved', () => {
  let proposal = {
    entity: { eid: 'proposal', num: 1 },
    doc: { eid: 'proposal', title: 'A proposal', body: '' },
    proposed: { eid: 'proposal', at: '2026-08-10T12:00:00Z' },
  }

  cache.value = { proposal }
  let e = ent('proposal')
  let a = mount(h(resolve(e, 'Meta').Render, { e }))
  assertExists(a.root.querySelector('.Show_Proposal-proposed .Icon'))
  assertEquals(
    a.root.querySelector('.Show_Proposal')?.getAttribute('aria-label'),
    'proposed',
  )
  a.free()

  cache.value = {
    proposal: {
      ...proposal,
      task: { eid: 'proposal' },
      filed: { eid: 'proposal', priority: 1 },
      cancelled: { eid: 'proposal' },
    },
  }
  e = ent('proposal')
  let b = mount(h(resolve(e, 'Meta').Render, { e }))
  assertExists(b.root.querySelector('.Show_Proposal-cancelled .Icon'))
  assertEquals(
    b.root.querySelector('.Show_Proposal')?.getAttribute('aria-label'),
    'cancelled',
  )
  b.free()

  cache.value = {
    proposal: {
      ...proposal,
      decided: { eid: 'proposal', at: '2026-08-10T13:00:00Z' },
    },
  }
  e = ent('proposal')
  let c = mount(h(resolve(e, 'Meta').Render, { e }))
  assertExists(c.root.querySelector('.Show_Proposal-approved .Icon'))
  assertEquals(
    c.root.querySelector('.Show_Proposal')?.getAttribute('aria-label'),
    'approved',
  )
  c.free()
  cache.value = {}
})

test('a superseded entity is marked on its face with what replaced it', () => {
  cache.value = {
    old: {
      entity: { eid: 'old', num: 12 },
      doc: { eid: 'old', title: '8.5×8.5 square', body: '' },
    },
    cur: {
      entity: { eid: 'cur', num: 13 },
      doc: { eid: 'cur', title: '8×10 portrait', body: '' },
    },
  }
  deps.value = [{ parent: 'cur', type: 'supersedes', child: 'old' }]

  // The superseded end wears the mark — visible on its own face, pointing
  // to the current one; a bare doc with no other meta still renders it.
  let e = ent('old')
  let a = mount(h(resolve(e, 'Meta').Render, { e }))
  let mark = a.root.querySelector('.Show_Superseded')
  assertExists(mark)
  assertEquals(mark!.textContent?.includes('superseded by'), true)
  let successor = a.root.querySelector('.Show_Superseded .Inline')
  assertExists(successor)
  assertEquals(successor!.textContent, '8×10 portrait')
  a.free()

  // The current end is not marked — it did the replacing.
  let c = ent('cur')
  let b = mount(h(resolve(c, 'Meta').Render, { e: c }))
  assertEquals(b.root.querySelector('.Show_Superseded'), null)
  b.free()

  deps.value = []
  cache.value = {}
})

test('task meta carries both full facts and compact edge tallies', () => {
  let project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let person = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  let session = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  let now = new Date().toISOString()
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      doc: { eid: 'task', title: 'Everything', body: '' },
      task: { eid: 'task' },
      filed: {
        eid: 'task',
        priority: 1,
        project: project,
        assignee: person,
        domain: 'Eng',
      },
      claim: { eid: 'task', session: session },
      created: { eid: 'task', at: now, by: person },
    },
    [project]: {
      entity: { eid: project, num: 2 },
      doc: { eid: project, title: 'Task Graph', body: '' },
      project: { eid: project },
    },
    [person]: {
      entity: { eid: person, num: 3 },
      doc: { eid: person, title: 'Jeff', body: '' },
      person: { eid: person },
    },
    [session]: {
      entity: { eid: session, num: 4 },
      session: { eid: session, id: 'run' },
    },
    open: {
      entity: { eid: 'open', num: 5 },
      task: { eid: 'open' },
      filed: { eid: 'open', priority: 1 },
    },
    done: {
      entity: { eid: 'done', num: 6 },
      task: { eid: 'done' },
      filed: { eid: 'done', priority: 1 },
      completed: { eid: 'done' },
    },
    child: {
      entity: { eid: 'child', num: 7 },
      doc: { eid: 'child', title: 'Part', body: '' },
    },
    comment: {
      entity: { eid: 'comment', num: 8 },
      doc: { eid: 'comment', title: '', body: 'Watching' },
      comment: { eid: 'comment', target: 'task' },
    },
  }
  deps.value = [
    { parent: 'task', type: 'requires', child: 'open' },
    { parent: 'task', type: 'requires', child: 'done' },
    { parent: 'task', type: 'contains', child: 'child' },
    { parent: 'task', type: 'reads', child: 'done' },
  ]
  let e = ent('task')
  let { root, free } = mount(h(resolve(e, 'Meta').Render, { e, id: true }))
  try {
    assertEquals(
      root.querySelector('.Show_Meta')?.textContent.includes('Task Graph'),
      true,
    )
    assertEquals(root.querySelector('.Show_Domain')?.textContent, 'Eng')
    assertEquals(
      root.querySelector('.Show_Meta')?.textContent.includes('Jeff'),
      true,
    )
    let comments = root.querySelector('.Show_Comments')!
    assertEquals(comments.textContent.trim(), '1')
    assertEquals(
      comments.querySelector('svg')?.getAttribute('class'),
      'lucide lucide-message-circle Icon',
    )
    assertEquals(comments.getAttribute('data-tip'), '1 comment')
    assertEquals(
      root.querySelector('.Show_Deps-requires')?.textContent,
      '11',
    )
    assertEquals(
      root.querySelector('.Show_Deps-contains')?.textContent,
      '1',
    )
    assertEquals(root.querySelector('.Show_Deps-reads')?.textContent, '1')
    assertEquals(
      root.querySelector('.Show_Deps-requires')?.getAttribute('data-tip'),
      'requires 1 done · 1 open',
    )
    assertEquals(
      root.querySelector('.Show_Deps-contains svg')?.getAttribute('class'),
      'lucide lucide-box Icon',
    )
    assertEquals(
      root.querySelector('.Show_Deps-contains')?.getAttribute('aria-label'),
      'contains 1',
    )
    assertEquals(
      root.querySelector('.Show_Deps-reads svg')?.getAttribute('class'),
      'lucide lucide-book-open Icon',
    )
    assertEquals(root.querySelector('.Show_Done')?.textContent, '1')
    assertEquals(root.querySelector('.Show_Claim')?.textContent, '⚑ S-4')
    assertEquals(
      root.querySelector('.Show_Claim a')?.getAttribute('href'),
      '/S-4',
    )
    assertExists(root.querySelector('.Stamp'))
    assertEquals(root.querySelector('.Id')?.textContent, 'T-1')
  } finally {
    free()
    deps.value = []
    cache.value = {}
  }
})

test('mail Full section shows its envelope and delivery receipt', () => {
  cache.value = {
    mail: {
      entity: { eid: 'mail', num: 1 },
      doc: { eid: 'mail', title: 'Hello', body: '' },
      mail: {
        eid: 'mail',
        from: 'sender@x.test',
        to: 'desk@x.test',
      },
      // WHERE it went — the shared deliver.to (D-14945); `to` is the
      // address that reference resolved to.
      deliver: { eid: 'mail', to: 'P-2' },
      // The send outcome is the shared delivered facet now (D-14945).
      delivered: {
        eid: 'mail',
        at: '2026-07-30T12:00:00Z',
        via: 'sent@x.test',
      },
    },
  }
  let a = mount(h(resolve(ent('mail'), 'Mail').Render, { e: ent('mail') }))
  assertEquals(
    [...a.root.querySelectorAll('.Show_MailKey')].map((x) => x.textContent),
    ['from', 'requested', 'to', 'sent'],
  )
  assertEquals(
    [...a.root.querySelectorAll('.Show_MailVal')].slice(0, 3).map((x) =>
      x.textContent
    ),
    ['sender@x.test', 'P-2', 'desk@x.test'],
  )
  assertEquals(a.root.querySelector('.Stamp') != null, true)
  a.free()

  cache.value = {
    mail: {
      entity: { eid: 'mail', num: 1 },
      doc: { eid: 'mail', title: 'Hello', body: '' },
      mail: {
        eid: 'mail',
        to: 'desk@x.test',
        from: 'stranger@x.test',
        message_id: 'received@x.test',
        at: '2026-07-30T13:00:00Z',
        verified: false,
      },
    },
  }
  let b = mount(h(resolve(ent('mail'), 'Mail').Render, { e: ent('mail') }))
  assertEquals(
    [...b.root.querySelectorAll('.Show_MailKey')].map((x) => x.textContent),
    ['from', 'to', 'received', 'verified'],
  )
  assertEquals(
    b.root.querySelector('.Show_MailVal-unverified')?.textContent,
    'no',
  )
  b.free()
  cache.value = {}
})

test('document meta names its creator and editor after their ages', () => {
  let jeff = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let robin = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  let now = Date.now()
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'Changed document', body: '' },
      created: {
        eid: 'doc',
        at: new Date(now - 2 * 86_400_000).toISOString(),
        by: jeff,
      },
      updated: {
        eid: 'doc',
        at: new Date(now - 18 * 3_600_000).toISOString(),
        by: robin,
      },
    },
    [jeff]: {
      entity: { eid: jeff, num: 2 },
      doc: { eid: jeff, title: 'Jeff', body: '' },
      person: { eid: jeff },
    },
    [robin]: {
      entity: { eid: robin, num: 3 },
      doc: { eid: robin, title: 'Robin', body: '' },
      person: { eid: robin },
    },
  }
  let e = ent('doc')
  let { root, free } = mount(h(resolve(e, 'Meta').Render, { e }))
  try {
    assertEquals(
      root.querySelector('.Stamp')?.textContent,
      '2 days ago by Jeff· edited 18 hours ago by Robin',
    )
    assertEquals(
      [...root.querySelectorAll('.Stamp a')].map((a) => a.getAttribute('href')),
      ['/U-2', '/U-3'],
    )
  } finally {
    free()
    cache.value = {}
  }
})

test('meta names a creator it has not loaded by its handle', () => {
  let by = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  let at = new Date().toISOString()
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'Made by a process', body: '' },
      created: { eid: 'doc', at, by },
    },
  }
  let e = ent('doc')
  let { root, free } = mount(h(resolve(e, 'Meta').Render, { e }))
  try {
    assertEquals(root.querySelector('.Stamp a')?.textContent, '#bbbbbbbbbb')
  } finally {
    free()
    cache.value = {}
  }
})

test('the full face paints the body for a viewer with no actor', () => {
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'Read me', body: 'The body text' },
    },
  }
  let e = ent('doc')
  let { root, free } = mount(h(resolve(e, 'Full').Render, { e }))
  try {
    assertEquals(root.textContent?.includes('The body text'), true)
  } finally {
    free()
    cache.value = {}
  }
})

// A configured package's portable reading of a document (@yaks/doc's Title
// and Body) is laid over browse's own, as the web door lays every package's
// views; Full still types a document's title and body over where they stand.
let typedOver = await (async () => {
  let drop = extend(await contributedViews([{ views: docViews }]))
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'Typed', body: 'The body text' },
    },
  }
  let { root, free } = mount(h(Entity, { eid: 'doc', view: 'Full' }))
  let { Event } = root.ownerDocument.defaultView!
  let dbl = (el: Element | null) =>
    el?.dispatchEvent(new Event('dblclick', { bubbles: true }))
  let typed = (at: string) =>
    !!root.querySelector(`${at} .Edit`)?.hasAttribute('contenteditable')
  try {
    dbl(root.querySelector('.Show_Title .Edit'))
    await tick()
    let title = typed('.Show_Title')
    dbl(root.querySelector('.Show_Body'))
    await tick()
    return { title, body: typed('.Show_Body') }
  } finally {
    free()
    drop()
    cache.value = {}
  }
})()
preparedTest(
  "Full types over a document's title and body in place, with a package's reading laid over browse's",
  () => {
    assertEquals(typedOver, { title: true, body: true })
  },
)

// Every entity opens on the same Full page, each part drawn by its own
// renderer: a tool (no doc) by its name and description, and an entity with
// no text of its own by the facts it states.
let lands = await (async () => {
  let drop = extend(await contributedViews([{ views: toolViews }]))
  let tool = toolEid('graph_query')
  cache.value = {
    [tool]: {
      entity: { eid: tool, num: 0 },
      tool: {
        eid: tool,
        name: 'graph_query',
        description: 'Find **stored** records.',
      },
    },
    bare: {
      entity: { eid: 'bare', num: 0 },
      blocked: { eid: 'bare', on: 'a vendor' },
    },
  }
  let page = (eid: string) => {
    let { root, free } = mount(h(Entity, { eid, view: 'Full' }))
    try {
      return {
        first: applicable(ent(eid))[0],
        title: root.querySelector('.Show_Title')?.textContent,
        body: root.querySelector('.Show_Main')?.textContent ?? '',
        strong: root.querySelector('.Show_Main strong')?.textContent,
      }
    } finally {
      free()
    }
  }
  try {
    return { tool: page(tool), bare: page('bare') }
  } finally {
    drop()
    cache.value = {}
  }
})()
preparedTest(
  'a tool opens on Full: its name for a title, its description for a body',
  () => {
    let { first, title, body, strong } = lands.tool
    assertEquals({ first, title, strong }, {
      first: 'Full',
      title: 'graph_query',
      strong: 'stored',
    })
    assert(body.includes('Find stored records.'))
  },
)
preparedTest(
  'an entity with no text of its own opens on Full, saying what it states',
  () => {
    assertEquals(lands.bare.first, 'Full')
    assert(lands.bare.body.includes('a vendor'))
  },
)

// An edge row on Full says two lines: the entity's name, then what it is,
// its own way: a memory its kind and first line, a tool its first line.
let rows = await (async () => {
  let drop = extend(await contributedViews([{ views: toolViews }]))
  let tool = toolEid('graph_query')
  cache.value = {
    persona: {
      entity: { eid: 'persona', num: 1 },
      doc: { eid: 'persona', title: 'Coder', body: '' },
    },
    memo: {
      entity: { eid: 'memo', num: 2 },
      doc: {
        eid: 'memo',
        title: 'Signal over noise',
        body: '# Jeff, verbatim\nWhat the owner says is the signal.',
      },
      memory: { eid: 'memo' },
    },
    [tool]: {
      entity: { eid: tool, num: 0 },
      tool: {
        eid: tool,
        name: 'graph_query',
        description: 'Find stored records.\nReturns bundles.',
      },
    },
  }
  deps.value = [
    { parent: 'persona', type: 'contains', child: 'memo' },
    { parent: 'persona', type: 'contains', child: tool },
  ]
  let e = ent('persona')
  let { root, free } = mount(h(resolve(e, 'Dependencies').Render, { e }))
  try {
    return [...root.querySelectorAll('.Dependency')].map((row) => [
      row.querySelector('.Dependency_Line')?.textContent?.trim(),
      row.querySelector('.Dependency_Gist')?.textContent,
    ])
  } finally {
    free()
    drop()
    deps.value = []
    cache.value = {}
  }
})()
preparedTest(
  'an edge row says the name, then what it is in a smaller line',
  () => {
    assertEquals(rows, [
      ['contains Signal over noise', 'memory · Jeff, verbatim'],
      ['contains graph_query', 'tool · Find stored records.'],
    ])
  },
)

// Full offers a link of every relation the vocabulary declares, a goal's
// `satisfies` as much as a task's `requires`, backwards where the relation
// says how; typing narrows them, and the one picked asks for the far end.
let linking = await (async () => {
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      doc: { eid: 'task', title: 'Ship it', body: '' },
      task: { eid: 'task' },
    },
  }
  let e = ent('task')
  let unwindow = windowed()
  let { root, free } = mount(h(resolve(e, 'Relate').Render, { e }))
  let doc = root.ownerDocument
  let { Event } = doc.defaultView!
  let offered = () =>
    [...doc.querySelectorAll('.Relate_Row')].map((r) => r.textContent)
  let find = () => root.querySelector<HTMLInputElement>('.Relate_Find')!
  try {
    root.querySelector('.Relate_Verb')!
      .dispatchEvent(new Event('click', { bubbles: true }))
    await tick()
    let all = offered()
    find().value = 'satisf'
    find().dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    let narrowed = offered()
    find().dispatchEvent(
      Object.assign(new Event('keydown', { bubbles: true }), { key: 'Enter' }),
    )
    await tick()
    return {
      all: ['requires', 'required by', 'satisfies', 'contains', 'cites']
        .filter((s) => !all.includes(s)),
      narrowed,
      asks: [
        root.querySelector('.Relate_Verb')?.textContent,
        find().getAttribute('placeholder'),
        find().value,
      ],
    }
  } finally {
    free()
    unwindow()
    cache.value = {}
  }
})()
preparedTest(
  'Full offers a link of every declared relation, narrowed as it is typed',
  () => {
    assertEquals(linking, {
      all: [],
      narrowed: ['satisfies', 'satisfied by'],
      asks: ['satisfies', 'entity…', ''],
    })
  },
)

test('a view that throws fails in its own slot, and the page paints', async () => {
  let drop = extend([{
    view: 'Full.Body',
    match: parse('.doc.title=Throws'),
    Render: () => {
      throw new Error('boom')
    },
  }])
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'Throws', body: 'unseen' },
      accept: { eid: 'doc', body: '- still here' },
    },
  }
  let quiet = console.error
  console.error = () => {}
  let { root, free } = mount(h(Entity, { eid: 'doc', view: 'Full' }))
  try {
    // The boundary paints its failure on the render after the throw.
    await tick()
    assertEquals(
      root.querySelector('.Fault')?.textContent?.includes('boom'),
      true,
    )
    assertEquals(root.textContent?.includes('still here'), true)
  } finally {
    free()
    drop()
    console.error = quiet
    problem.value = ''
    cache.value = {}
  }
})

test('a board whose saved query cannot be read shows why', () => {
  cache.value = {
    b: {
      entity: { eid: 'b', num: 1 },
      doc: { eid: 'b', title: 'Old board' },
      board: { eid: 'b', query: '.task&.limit=nope' },
    },
  }
  let quiet = console.error
  console.error = () => {}
  let { root, free } = mount(h(Entity, { eid: 'b', view: 'List' }))
  try {
    assertEquals(root.querySelector('.Fault'), null)
    assertEquals(
      root.querySelector('.SubscriptionFailure')?.textContent
        ?.includes('.limit takes a whole number'),
      true,
    )
  } finally {
    free()
    console.error = quiet
    problem.value = ''
    cache.value = {}
  }
})

let hooked: Ent = {
  eid: 'task',
  num: 1,
  kind: 'task',
  refs: [],
  kids: [],
  doc: { eid: 'task', title: 'Hooked', body: '' },
  task: { eid: 'task', status: 'open' },
  filed: { eid: 'task', priority: 1 },
}
let hookedTitle = resolve(hooked, 'Card.Title').Render
let hookedMount = mount(h(hookedTitle, { e: hooked }))

preparedTest('a hook-using renderer mounts through the helper', () => {
  // The task title's Pip holds useState — a hook-using renderer only works
  // mounted through Preact. A bare call would throw here; the helper mounts it.
  let { root, free } = hookedMount
  assertExists(root.querySelector('.CardTitle'))
  assertEquals(root.querySelector('.Id')?.textContent, 'T-1')
  free()
})

test('comment dependencies lead with the entity commented on', () => {
  cache.value = {
    comment: {
      entity: { eid: 'comment', num: 2 },
      doc: { eid: 'comment', title: '', body: 'A note' },
      comment: { eid: 'comment', target: 'target' },
    },
    target: {
      entity: { eid: 'target', num: 1 },
      doc: { eid: 'target', title: 'The subject', body: '' },
    },
  }

  let e = ent('comment')
  let { root, free } = mount(h(resolve(e, 'Dependencies').Render, { e }))
  // The first edge sentence is the target, verbed 'on'.
  assertEquals(root.querySelector('.Dependency_Type')?.textContent, 'on')
  assertEquals(root.querySelector('.Inline_Title')?.textContent, 'The subject')
  free()
  cache.value = {}
})

test('claim chip loads its referenced session instead of painting a blank', async () => {
  cache.value = {
    claimed: {
      entity: { eid: 'claimed', num: 900 },
      claim: { eid: 'claimed', session: 'cold-claimant' },
    },
  }
  let sub = routeName('cold-claimant', 'doc.title,client.user_agent,session.id')
  let e = ent('claimed')
  let mounted = mount(h(resolve(e, 'Meta').Render, { e }))
  try {
    assertEquals(
      mounted.root.querySelector('.Show_Claim')?.textContent,
      '⚑ Loading…',
    )
    landSub({
      sub,
      replace: true,
      fields: [
        { comp: 'doc', prop: 'title', wake: true },
        { comp: 'session', prop: 'id', wake: true },
      ],
      changes: [
        { eid: 'cold-claimant', name: 'entity', comp: { num: 901 } },
        { eid: 'cold-claimant', name: 'session', comp: { id: 'native' } },
      ],
    })
    await tick()
    assertEquals(
      mounted.root.querySelector('.Show_Claim')?.textContent,
      '⚑ S-901',
    )
  } finally {
    mounted.free()
    unsubscribe(sub)
    cache.value = {}
  }
})

// Runs reads the claim the row carries; Tasks holds one typed membership.
test('Runs and Tasks ask only their typed memberships, not every reverse ref', () => {
  let target = 'dddd3707-0000-4000-8000-000000000001'
  let sent: { subscribe?: string; unsubscribe?: string }[] = []
  let restore = useRoute((f) => sent.push(f as typeof sent[number]))
  // A partial cache containing unrelated referrers is not either list.
  cache.value = {
    [target]: { entity: { eid: target, num: 1 }, project: { eid: target } },
    unrelated: { comment: { eid: 'unrelated', target } },
  }
  let free = () => {}
  try {
    let e = ent(target)
    ;({ free } = mount(h('div', {}, [
      h(resolve(e, 'Runs').Render, { e }),
      h(resolve(e, 'Tasks').Render, { e }),
    ])))
    assertEquals(sent.flatMap((f) => f.subscribe ?? []), [
      `.filed.project->${target}&.task&.task.status=open,wip&*`,
    ])
    free()
    free = () => {}
    assertEquals(sent.filter((f) => f.unsubscribe).length, 1)
  } finally {
    free()
    cache.value = {}
    useRoute(restore)
  }
})

test('the status pip picks a status through its Edit and writes marks', async () => {
  let { document } = parseHTML('<html><body><main></main></body></html>')
  let unwindow = windowed({ document })
  let sent: Change[] = []
  let restore = useRoute((frame) => {
    let write = frame as { apply?: Change[]; request?: Request }
    if (write.apply) sent.push(...write.apply)
    if (write.request) return Response.json([])
  })
  let eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  cache.value = {
    [eid]: {
      entity: { eid, num: 1 },
      doc: { eid, title: 'A task', body: '' },
      task: { eid },
    },
  }
  let root = document.querySelector('main')!
  try {
    render(h(Ux, { host: ux }, h(Pip, { e: ent(eid) })), root)
    root.querySelector<HTMLElement>('.Show_Pip')!.click()
    await tick()
    let tabs = [...document.querySelectorAll<HTMLElement>('.Prop_Tab')]
    assertEquals(
      tabs.length,
      document.querySelectorAll('.Prop_Tab .Dot').length,
    )
    tabs.find((t) => t.textContent == 'done')!.click()
    await until(() => sent.some((c) => c.name == 'completed'))
    assert(!sent.some((c) => c.name == 'task' && c.comp && 'status' in c.comp))
  } finally {
    render(null, root)
    useRoute(restore)
    cache.value = {}
    unwindow()
  }
})
