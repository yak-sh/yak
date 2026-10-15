import { test, until } from '@yaks/testing'
import '../testing.ts'
import { h } from 'preact'
import { type Bundle, Disclosure, disclosureAt } from '@yaks/ux'
import { parse } from '@yaks/query'
import { cache, clearResolved, type Comps } from '../live.ts'
import { host } from '../host_testing.ts'
import { inspectIo } from './inspect.tsx'
import { extend } from './registry.ts'
import { Page } from './App.tsx'
import { mount } from './mount.ts'

test("a view's own page state, set through the inspector's io, redraws it", async () => {
  let eid = disclosureAt('inspect-test')
  let View = () =>
    h(Disclosure, {
      e: inspectIo.state(eid) ?? { entity: { eid } },
      onChange: (b: Bundle) => inspectIo.set([b]),
      summary: 'more',
    }, 'the rest')
  let mounted = mount(h(View, {}))
  try {
    ;(mounted.root.querySelector('button') as HTMLElement).click()
    await until(() => mounted.root.textContent!.includes('the rest'), {
      label: 'opened',
    })
  } finally {
    mounted.free()
  }
})

// The page an inspector view's link to `b` opens, held until it is `b`'s own.
// `b` is the cache's row and the wire's bundle at once.
let opens = async (b: Comps & Bundle) => {
  let eid = b.entity.eid
  cache.value = { [eid]: b }
  clearResolved()
  let wire = host(() => ({ bundles: [b] }))
  let mounted = mount(h(Page, { at: inspectIo.link(eid) }))
  try {
    await until(() => mounted.root.querySelector('[data-page=own]'), {
      label: `${eid}'s own page`,
    })
  } finally {
    mounted.free()
    wire.free()
    clearResolved()
    cache.value = {}
  }
}

test('an entity an inspector view links to opens on its own page, not Debug', async () => {
  let own = () => h('p', { 'data-page': 'own' }, 'its own page')
  extend([
    { view: 'Full', match: parse('.trace'), Render: own },
    { view: 'Full', match: parse('.effect'), Render: own },
  ])
  await opens({
    entity: { eid: 't', num: 7 },
    trace: { op: 'effect', name: 'session_run' },
  })
  // One with no number is addressed by its short eid, as a vocabulary
  // entity is.
  await opens({
    entity: { eid: '64ce287e-9f00-4000-8000-000000000001' },
    effect: {},
  })
})
