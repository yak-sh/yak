import { parse } from '@yaks/query'
import { mount } from '../mount.ts'
import { InspectFull } from './InspectFull.tsx'
// The InspectFull inspector exposes every component and gives its editing controls
// the same component vocabulary as its stored rows.
import { test } from '@yaks/testing'
import '../../testing.ts'
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { parseHTML } from 'linkedom'
import { compTone } from '../comp.ts'
import { cache, ent, useRoute } from '../../live.ts'
import { applicable, registry, ux } from '../registry.ts'
import { Ux } from '@yaks/ux'

// Each case imports Entity.tsx — the whole component registry — and mounts a
// InspectFull view through preact; the first pays that registry import (and hljs to
// render the Markdown/JSON tabs), the rest the mount.
test('raw formats are nested under InspectFull', async () => {
  await import('../Entity.tsx')
  let { InspectFullTabs } = await import('./InspectFull.tsx')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let e = {
    eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    num: 1,
    kind: 'doc',
    refs: [],
    kids: [],
    doc: {
      eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Nested',
      body: 'source',
    },
  }
  try {
    assertEquals(applicable(e).includes('Markdown'), false)
    assertEquals(applicable(e).includes('JSON'), false)
    render(
      h(
        InspectFullTabs,
        { e, head: h('i', {}, 'summary') },
        h('i', {}, 'components'),
      ),
      root,
    )
    assertEquals(
      root.querySelector('[data-formats-head]')?.textContent,
      'summary',
    )
    let tabs = [
      ...root.querySelectorAll<HTMLButtonElement>(
        '[data-formats] .Tabs_Tab',
      ),
    ]
    assertEquals(tabs.map((tab) => tab.getAttribute('aria-label')), [
      'Components',
      'Markdown',
      'JSON',
    ])
    tabs[1].click()
    await Promise.resolve()
    assertEquals(
      root.querySelector('.Md')?.textContent.includes('source'),
      true,
    )
    tabs[2].click()
    await Promise.resolve()
    assertEquals(
      root.querySelector('.Json')?.textContent.includes('Nested'),
      true,
    )
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

test('addable components keep their component tones', async () => {
  await import('../Entity.tsx')
  let { AddComp } = await import('./InspectFull.tsx')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let e = {
    eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    num: 1,
    kind: 'entity',
    refs: [],
    kids: [],
  }
  try {
    render(h(AddComp, { e }), root)
    root.querySelector<HTMLButtonElement>('[data-add-component]')!.click()
    await Promise.resolve()
    let labels = [
      ...root.querySelectorAll('[data-add-choice] .Chip'),
    ]
    assertEquals(labels.length > 1, true)
    for (let label of labels) {
      assertEquals(
        label.classList.contains(
          `Chip-${compTone(label.textContent!)}`,
        ),
        true,
      )
    }
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

test('a reference reads as one association row, eid and all', async () => {
  await import('../Entity.tsx')
  let { InspectFull } = await import('./InspectFull.tsx')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let owner = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  let job = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  cache.value = {
    [owner]: {
      entity: { eid: owner, num: 7 },
      doc: { eid: owner, title: 'Owner', body: '' },
    },
    [job]: {
      entity: { eid: job, num: 8 },
      doc: { eid: job, title: 'Job', body: '' },
      task: { eid: job, status: 'open' },
      filed: { eid: job, priority: 1, assignee: owner },
    },
  }
  let root = document.querySelector('main')!
  // InspectFull holds a backlink query even when only its reference cells matter.
  // This complete cache fixture needs no server; intercept the transport, not
  // the query, so the real resolver and hook lifetime still run.
  let priorRoute = useRoute(() => {})
  try {
    act(() =>
      render(h(Ux, { host: ux }, h(InspectFull, { e: ent(job) })), root)
    )
    let keys = [...root.querySelectorAll('[data-raw-properties] .Pairs_Key')]
      .map((k) => k.textContent)
    assertEquals(keys.filter((k) => k == 'filed.assignee').length, 1)
    // The row carries the target and the eid it stored.
    let ids = [...root.querySelectorAll('.Value-id')].map((v) => v.textContent)
    assertEquals(ids.includes(owner), true)
    assertEquals(root.textContent.includes('Owner'), true)
  } finally {
    act(() => render(null, root))
    useRoute(priorRoute)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

test('project backlinks omit attribution and cap associations', async () => {
  await import('../Entity.tsx')
  let { ProjectInspectFull } = await import('./InspectFull.tsx')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  cache.value = {
    [project]: {
      entity: { eid: project, num: 19 },
      doc: { eid: project, title: 'Task Graph', body: '' },
      project: { eid: project },
    },
  }
  for (let n = 1; n <= 5; n++) {
    let eid = `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`
    cache.value = {
      ...cache.value,
      [eid]: {
        entity: { eid, num: n },
        doc: { eid, title: `Task ${n}`, body: '' },
        task: { eid, status: 'open' },
        filed: { eid, priority: n, project: project },
      },
    }
  }
  for (let n = 1; n <= 2; n++) {
    let eid = `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`
    cache.value = {
      ...cache.value,
      [eid]: {
        entity: { eid, num: n + 20 },
        doc: { eid, title: `Action ${n}`, body: '' },
        created: { eid, by: project },
      },
    }
  }
  for (let n = 1; n <= 4; n++) {
    let eid = `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`
    cache.value = {
      ...cache.value,
      [eid]: {
        entity: { eid, num: n + 30 },
        session: { eid, id: `session-${n}`, actor: project },
      },
    }
  }
  let root = document.querySelector('main')!
  // The seeded graph is the whole backlink set, not a live owner's cache.
  let priorRoute = useRoute(() => {})
  try {
    act(() =>
      render(
        h(Ux, { host: ux }, h(ProjectInspectFull, { e: ent(project) })),
        root,
      )
    )
    assertEquals(root.textContent.includes('created.by'), false)
    assertEquals(root.textContent.includes('Action 1'), false)
    assertEquals(root.textContent.includes('Task 5'), true)
    assertEquals(root.textContent.includes('Task 2'), false)
    let more = [...root.querySelectorAll<HTMLAnchorElement>(
      '[data-more-links]',
    )]
    // Reverse-index traversal need not follow fixture insertion order. Check
    // each group's cap and query together, independent of group order.
    assertEquals(
      more.map((node) => [node.getAttribute('href'), node.textContent])
        .sort(([a], [b]) => a!.localeCompare(b!)),
      [
        ['/inspect?q=.filed.project%3DP-19', '← filed.project+2 more tasks'],
        [
          '/inspect?q=.session.actor%3DP-19',
          '← session.actor+1 more sessions',
        ],
      ],
    )
  } finally {
    act(() => render(null, root))
    useRoute(priorRoute)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

test('Inspect.Full combines the entity reading, raw properties and registered links', async () => {
  let { Entity } = await import('../Entity.tsx')
  let { icons } = await import('../Card.tsx')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let who = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  cache.value = {
    [eid]: {
      entity: { eid, num: 51 },
      doc: { eid, title: 'Read this entity', body: '**Its words in full**' },
      task: { eid },
      filed: { eid, assignee: who, priority: 2 },
      created: { eid, at: '2026-10-01T00:00:00Z', by: who },
      unknown: { nested: { keep: true }, absent: null, empty: '' },
    },
    [who]: {
      entity: { eid: who, num: 52 },
      doc: { eid: who, title: 'The author' },
    },
  }
  let asks: string[] = []
  let priorRoute = useRoute((body) => {
    if (body && typeof body == 'object' && 'subscribe' in body) {
      asks.push(String(body.subscribe))
    }
  })
  try {
    assertEquals(applicable(ent(eid)).includes('Inspect.Full'), true)
    assertEquals(applicable(ent(eid)).includes('Debug'), false)
    assertEquals(icons['Inspect.Full'], 'scan-search')
    act(() =>
      render(
        h(Ux, { host: ux }, h(Entity, { eid, view: 'Inspect.Full' })),
        root,
      )
    )
    assertEquals(
      root.querySelector('.Head_Title')?.textContent.includes(
        'Read this entity',
      ),
      true,
    )
    assertEquals(root.querySelector('.Head_Kind')?.textContent, 'task')
    assertEquals(
      root.querySelector('.Head_Facts')?.textContent.includes('The author'),
      true,
    )
    assertEquals(
      root.querySelector('[data-body] strong')?.textContent,
      'Its words in full',
    )
    assertEquals(
      root.querySelector('[data-facts]')?.textContent.includes('filed'),
      true,
    )
    let raw = root.querySelector('[data-raw-properties]')!.textContent
    for (
      let value of [
        'eid',
        eid,
        'num',
        '51',
        'unknown.nested',
        '{"keep":true}',
        'unknown.absent',
        'null',
        'unknown.empty',
        '""',
      ]
    ) {
      assertEquals(raw.includes(value), true, value)
    }
    assertEquals(root.textContent.includes('History'), true)
    assertEquals(asks.some((q) => q.includes(`._change.target=${eid}`)), true)
    assertEquals(asks.some((q) => q.includes(`.refs=${eid}`)), true)
  } finally {
    act(() => render(null, root))
    useRoute(priorRoute)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

test('Inspect.Full reference cells honor the referenced entity renderer', () => {
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      task: { eid: 'task' },
      filed: { eid: 'task', project: 'project' },
    },
    project: {
      entity: { eid: 'project', num: 2 },
      project: { eid: 'project' },
      doc: { eid: 'project', title: 'Plain doc title' },
    },
  }
  let prior = registry.renderers
  registry.renderers = [
    {
      view: 'Inspect.Reference.Inline',
      match: parse('.project'),
      Render: () => <span>Specific project identity</span>,
    },
    ...prior,
  ]
  let mounted = mount(<InspectFull e={ent('task')} />)
  try {
    assertEquals(
      mounted.root.querySelector('[data-raw-properties]')?.textContent
        ?.includes('Specific project identity'),
      true,
    )
  } finally {
    mounted.free()
    registry.renderers = prior
    cache.value = {}
  }
})
