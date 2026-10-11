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
import { render as portable } from '@yaks/preact'
import { define, type Renderer } from '@yaks/render'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { bindHistory } from '../history.ts'
import { cache, owner } from '../live.ts'
import { start } from '../terminal-route.ts'
import { views as docViews } from '@yaks/doc/views'
import { inspectViews } from '@yaks/inspect/views'
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

// Mount the configured host once, as the app does before reading a query.
extend(await contributedViews([{ inspectViews }]))
let inspectRoot = new TElement('root')
let inspectTarget = inspectRoot as unknown as Parameters<typeof render>[1]
await act(() =>
  render(
    h(Ux, { host: ux }, h(InspectPage, { query: '.task .count' })),
    inspectTarget,
  )
)
test('configured Inspect facet renders a query through its host adapter, not raw Render', () => {
  try {
    ok(inspectRoot.textContent.includes('.task .count'))
  } finally {
    render(null, inspectTarget)
  }
})

let docRenderers = (await contributedViews([{ views: docViews }]))
  .filter((r): r is Renderer => !('Render' in r))
let preparedDocs = define(docRenderers, {
  vocab: loadVocab(docDoc),
})
// Prepare the contributed body once; this test exercises its terminal mount.
let drawing = portable(
  preparedDocs,
  {
    entity: { eid, num: 1 },
    doc: { title: 'Reading', body: 'Read **carefully**' },
  },
  'Body',
  preparedDocs.vocab!,
)
test('the terminal draws a prepared contributed Markdown body', () => {
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  try {
    render(drawing, target)
    ok(root.textContent.includes('Read carefully'))
    ok(root.querySelector('strong'))
  } finally {
    render(null, target)
  }
})
