import { test } from '@yaks/testing'
import { faked, until } from '../testing.ts'
import { assertEquals } from '@std/assert'
import { act } from 'preact/test-utils'
import type { Bundle, Comp } from '@yaks/graph'
import { cache, config } from '../live.ts'
import { host, reader } from '../host_testing.ts'
import {
  allSessionsKey,
  allSessionsPath,
  allSessionsQuery,
} from '../tray_query.ts'
import { fields } from './fields.tsx'
import { filterField, FilterInput } from './Filter.tsx'
import { QueryList } from './views/List.tsx'
import { Navigation, toggleNavigation } from './Navigation.tsx'
import { Tray } from './Tray.tsx'
import { mount } from './mount.ts'
import { SessionRelated } from './views/SessionManage.tsx'
import { useSessions } from './useSessions.ts'
import { leaseEid } from '../../effects/lease.ts'

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

test('All sessions reuses the paged list and accepts words and query filters, newest first', async () => {
  let prior = config.host
  config.host = 'browser.test'
  cache.value = {}
  let read = reader(sessions, {
    computed: { 'session.status': (b) => (b.session as Comp)?.status },
  })
  let wire = host((ask) => ({ bundles: read(ask.subscribe) }))
  let mounted = mount(
    <>
      <FilterInput eid={allSessionsKey} />
      <QueryList eid={allSessionsKey} query={allSessionsQuery} />
    </>,
  )
  let titles = () =>
    [...mounted.root.querySelectorAll('.SessionRow_Title')].map((e) =>
      e.textContent
    )
  try {
    await until(() => titles().length == 10)
    assertEquals(
      titles(),
      sessions.slice(0, 10).map((b) => (b.doc as Comp).title),
    )
    await act(() => fields.set(filterField(allSessionsKey), 'Needle'))
    await until(() => titles().length == 7)
    assertEquals(
      titles(),
      sessions.filter((_, i) => i % 2).map((b) => (b.doc as Comp).title),
    )
    await act(() =>
      fields.set(filterField(allSessionsKey), '.session.status=settled')
    )
    await until(() => titles().length == 8)
    assertEquals(
      titles(),
      sessions.filter((_, i) => !(i % 2)).map((b) => (b.doc as Comp).title),
    )
  } finally {
    mounted.free()
    fields.set(filterField(allSessionsKey), '')
    wire.free()
    cache.value = {}
    config.host = prior
  }
})

test('tray and sidebar both expose All sessions even with no personal sessions', () => {
  using _ = faked({ addEventListener: () => {}, removeEventListener: () => {} })
  let prior = config.host
  config.host = 'browser.test'
  cache.value = {}
  let wire = host(() => ({ bundles: [] }))
  toggleNavigation(true)
  let mounted = mount(
    <>
      <Navigation />
      <Tray />
    </>,
  )
  try {
    assertEquals(
      [...mounted.root.querySelectorAll('a')].filter((a) =>
        a.textContent == 'All sessions'
      ).map((a) => a.getAttribute('href')),
      [allSessionsPath, allSessionsPath],
    )
  } finally {
    mounted.free()
    toggleNavigation(false)
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
