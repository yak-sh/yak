import { test } from '@yaks/testing'
import { faked, until } from '../testing.ts'
import { assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { cache, config } from '../live.ts'
import { host, reader } from '../host_testing.ts'
import { allSessionsPath, allSessionsQuery } from '../tray_query.ts'
import { fields } from './fields.tsx'
import { filterField, FilterInput } from './Filter.tsx'
import { QueryList } from './views/List.tsx'
import { Navigation } from './Navigation.tsx'
import { Tray } from './Tray.tsx'
import { mount } from './mount.ts'
import { SessionRelated } from './views/SessionManage.tsx'
import { useSessions } from './useSessions.ts'
import { contribute } from './inspect.tsx'
import * as sessionFacet from '@yaks/session/views'
import { leaseEid } from '../../effects/lease.ts'

// Resolve the package's lazy views once, before timing its consumers.
let facet = { ...sessionFacet, inspectViews: await sessionFacet.inspectViews() }

let list = 'destination:sessions'
let sessions: Bundle[] = Array.from({ length: 15 }, (_, i) => ({
  entity: {
    eid: `eeee6386-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    num: i + 1,
  },
  session: {
    id: `session-${i}`,
    operator: false,
    status: i % 2 ? 'pending' : 'settled',
  },
  created: { at: new Date(Date.UTC(2026, 8, 15 - i)).toISOString() },
  doc: { title: `${i % 2 ? 'Needle' : 'History'} ${i}`, body: '' },
}))

// Seed and paint the fixture before timing its filtering acts.
let summary = await summaries()
let prior = config.host
config.host = 'browser.test'
cache.value = {}
let read = reader(sessions, {
  computed: { 'session.status': (b) => (b.session as Comp)?.status },
})
let wire = host((ask) => ({ bundles: read(ask.subscribe) }))
let drop = await contribute([facet])
let mounted = mount(
  <>
    <FilterInput eid={list} />
    <QueryList eid={list} query={allSessionsQuery} edges={false} />
  </>,
)
let titles = () =>
  [...mounted.root.querySelectorAll('.Tile_Title')].map((e) => e.textContent)
await until(() => titles().length == 10)

test('All sessions reuses the paged list and accepts words and query filters, newest first', async () => {
  try {
    assertEquals(summary.subs, [
      'active just now',
      'active just now',
    ])
    assertEquals(summary.dots, [
      'Dot Dot-half Dot-active',
      'Dot Dot-half Dot-active',
    ])
    assertEquals(summary.statuses, ['settled', 'pending'])
    assertEquals(summary.anchors, true)
    assertEquals(
      titles(),
      sessions.slice(0, 10).map((b) => (b.doc as Comp).title),
    )
    fields.set(filterField(list), 'Needle')
    await until(() => titles().length == 7)
    assertEquals(
      titles(),
      sessions.filter((_, i) => i % 2).map((b) => (b.doc as Comp).title),
    )
    fields.set(filterField(list), '.session.status=settled')
    await until(() => titles().length == 8)
    assertEquals(
      titles(),
      sessions.filter((_, i) => !(i % 2)).map((b) => (b.doc as Comp).title),
    )
  } finally {
    mounted.free()
    drop()
    fields.set(filterField(list), '')
    wire.free()
    cache.value = {}
    config.host = prior
  }
})

test('the sidebar and the tray both lead to every session, even with none of your own', () => {
  using _ = faked({ addEventListener: () => {}, removeEventListener: () => {} })
  let prior = config.host
  config.host = 'browser.test'
  cache.value = {}
  let wire = host(() => ({ bundles: [] }))
  let mounted = mount(
    <>
      <Navigation />
      <Tray />
    </>,
  )
  try {
    assertEquals(
      [...mounted.root.querySelectorAll('a')].filter((a) =>
        ['Sessions', 'All sessions'].includes(a.textContent!)
      ).map((a) => a.getAttribute('href')),
      [allSessionsPath, allSessionsPath],
    )
  } finally {
    mounted.free()
    wire.free()
    cache.value = {}
    config.host = prior
  }
})

test('a session exposes its spawned children through SessionRelated', async () => {
  let prior = config.host
  config.host = 'browser.test'
  cache.value = {}
  let parent = sessions[0].entity.eid
  let child = { ...sessions[1], spawned: { parent } }
  let read = reader([child])
  let wire = host((ask) => ({ bundles: read(ask.subscribe) }))
  let mounted = mount(<SessionRelated eid={parent} />)
  try {
    await until(() =>
      mounted.root.querySelector('.SessionManage_Gist')?.textContent ==
        'children · 1'
    )
    assertEquals(
      mounted.root.textContent?.includes(
        'Needle 1',
      ),
      true,
    )
  } finally {
    mounted.free()
    wire.free()
    cache.value = {}
    config.host = prior
  }
})

test('personal lists prioritize live roots and drop expired leases without graph writes', async () => {
  let prior = config.host
  config.host = 'browser.test'
  cache.value = {}
  let old = sessions[13].entity.eid
  let process = sessions[14].entity.eid
  let rows = sessions.map((s, i) => ({
    ...s,
    session: { ...(s.session as Comp), operator: true },
    ...(i == 14 ? { process: { pid: 123 } } : {}),
  }))
  let read = reader([...rows, {
    entity: { eid: leaseEid(`@yaks/session/run/${old}`), num: 100 },
    lease: {
      holder: 'worker',
      until: new Date(Date.now() + 200).toISOString(),
    },
  }], { computed: { 'session.status': (b) => (b.session as Comp)?.status } })
  let wire = host((ask) => ({ bundles: read(ask.subscribe) }))
  let Selection = () => (
    <output>{useSessions().rows.map(([eid]) => eid).join(',')}</output>
  )
  let mounted = mount(<Selection />)
  let selected = () =>
    mounted.root.querySelector('output')?.textContent?.split(',')
  try {
    await until(() => selected()?.[0] == old)
    assertEquals(selected(), [
      old,
      process,
      ...sessions.slice(0, 6).map((s) => s.entity.eid),
    ])
    await until(() => selected()?.[0] == process)
    assertEquals(selected(), [
      process,
      ...sessions.slice(0, 7).map((s) => s.entity.eid),
    ])
  } finally {
    mounted.free()
    wire.free()
    cache.value = {}
    config.host = prior
  }
})

async function summaries() {
  let prior = config.host
  config.host = 'browser.test'
  cache.value = {}
  let s = sessions[0].entity.eid
  let other = sessions[1].entity.eid
  let task = 'task-for-session'
  let at = new Date().toISOString()
  let read = reader(
    [
      { ...sessions[0], doc: undefined },
      { ...sessions[1], doc: undefined },
      {
        entity: { eid: 'tool-result' },
        entry: { session: other, seq: 0 },
        result: {},
        content: { body: 'This is tool output, not the conversation' },
      },
      {
        entity: { eid: task },
        task: {},
        doc: { title: 'Make Sessions useful' },
        claim: { session: s },
      },
      {
        entity: { eid: 'input' },
        entry: { session: other, seq: 1 },
        content: { body: 'Review the project direction' },
        created: { at },
      },
      {
        entity: { eid: 'last' },
        entry: { session: s, seq: 42 },
        content: { body: 'done' },
        output: {},
        created: { at },
      },
    ].map((b) =>
      Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined))
    ) as Bundle[],
    {
      computed: { 'session.status': (b) => (b.session as Comp)?.status },
    },
  )
  let wire = host((ask) => ({ bundles: read(ask.subscribe) }))
  let drop = await contribute([facet])
  let mounted = mount(
    <QueryList eid='sessions-summary' query={allSessionsQuery} />,
  )
  try {
    await until(() =>
      mounted.root.textContent?.includes('Make Sessions useful') &&
      mounted.root.textContent.includes('Review the project direction') &&
      mounted.root.textContent.includes('active just now')
    )
    return {
      subs: [...mounted.root.querySelectorAll('.Tile_Sub')].map((e) =>
        e.textContent
      ),
      dots: [...mounted.root.querySelectorAll('.Tile .Dot')].map((e) =>
        e.className
      ),
      statuses: [...mounted.root.querySelectorAll('.Tile .Dot')].map((e) =>
        e.getAttribute('title')
      ),
      anchors: [...mounted.root.querySelectorAll('.Tile')].every((e) =>
        e.tagName == 'A'
      ),
    }
  } finally {
    mounted.free()
    drop()
    wire.free()
    cache.value = {}
    config.host = prior
  }
}
