// The Browse App, its history and native events in a terminal.
import './doc.ts'
import '../testing.ts'
import '../domain-host.tsx'
import { equal, ok, test } from '@yaks/testing'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { TElement } from '@yaks/tui'
import { interaction } from '@yaks/tui/interaction'
import { terminalHistory } from '@yaks/tui/history'
import { installViewport } from '@yaks/ui'
import { App } from '../components/App.tsx'
import { Ux } from '@yaks/ux'
import { extend, ux } from '../components/registry.ts'
import { bindHistory } from '../history.ts'
import { cache, owner } from '../live.ts'
import { start } from '../terminal-route.ts'
import { inspectViews, views } from '@yaks/inspect/views'
import { contributedViews, InspectPage } from '../components/inspect.tsx'

let eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
test('terminal CLI routes ids, map and queries to Browse pages', () => {
  equal(start('', true), '/?map')
  equal(start('T-3', true), '/T-3?v=Debug')
  equal(start('.task .count', true), '/?q=.task%20.count')
  equal(start('.doc.title~=Hello', true), '/?q=.doc.title~%3DHello')
})
test('the shared Browse App paints its sidebar and home; its search field goes to a query page', async () => {
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  let port = terminalHistory({ path: '/', state: null })
  cache.value = {
    [eid]: {
      entity: { eid, num: 1 },
      task: { eid },
      doc: { eid, title: 'One task', body: 'Words' },
    },
  }
  owner.value = undefined
  bindHistory(port)
  installViewport(({ children, ...props }) => h('div', props, children))
  let keys = interaction(root, () => {})
  try {
    await act(() =>
      render(h(Ux, { host: { ...ux, Float: undefined } }, h(App, {})), target)
    )
    ok(root.textContent.includes('Favorites'))
    ok(root.textContent.includes('Sessions'))
    let field = root.querySelector('input')!
    ok(field)
    keys.focus(field)
    await act(() => {
      keys.press({ name: 'char', text: '.task .count' })
    })
    await act(() => {
      keys.press({ name: 'enter' })
    })
    equal(port.read().path, '/?q=.task%20.count')
    port.back()
    equal(port.read().path, '/')
  } finally {
    render(null, target)
    cache.value = {}
  }
})

test('configured Inspect facet renders a query through its host adapter, not raw Render', async () => {
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  extend(await contributedViews([{ views, inspectViews }]))
  try {
    await act(() =>
      render(
        h(Ux, { host: ux }, h(InspectPage, { query: '.task .count' })),
        target,
      )
    )
    ok(root.textContent.includes('.task .count'))
  } finally {
    render(null, target)
  }
})
