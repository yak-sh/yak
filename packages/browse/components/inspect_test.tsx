import { test, until } from '@yaks/testing'
import '../testing.ts'
import { h } from 'preact'
import { type Bundle, Disclosure, disclosureAt } from '@yaks/ux'
import { parse } from '@yaks/query'
import { cache } from '../live.ts'
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

test('an entity an inspector view links to opens on its own page, not Debug', async () => {
  extend([{
    view: 'Full',
    match: parse('.trace'),
    Render: () => h('p', { 'data-page': 'trace' }, 'where the time went'),
  }])
  cache.value = {
    t: {
      entity: { eid: 't', num: 7 },
      trace: { op: 'effect', name: 'session_run' },
    },
  }
  let mounted = mount(h(Page, { at: inspectIo.link('t') }))
  try {
    await until(() => mounted.root.querySelector('[data-page=trace]'), {
      label: "the trace's own page",
    })
  } finally {
    mounted.free()
    cache.value = {}
  }
})
