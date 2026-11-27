import { equal, test } from '@yaks/testing'
import { renderToString } from 'preact-render-to-string'
import { createElement as h } from 'react'
import { parseHTML } from 'linkedom'
import { bindShared } from './shared-browser.ts'
import { type SharedView, sharedView } from './shared-view.ts'
import { type Shared, SHARED_APPS, sharedRows } from './account-rows.ts'
import { graph } from './page-graph_fixture_test.ts'

let ADA = 'person-ada'
let view: SharedView = { person: ADA, apex: 'yaks.app' }
let app = (slug: string, space = 'bea'): Shared => ({
  eid: `app-${slug}`,
  slug,
  title: slug,
  space,
})

// The Shared with you view as the server draws it from `apps`, kept drawn
// from a graph holding them.
let bound = (apps: Shared[]) => {
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'shared', 'data-shared-view': JSON.stringify(view) },
      sharedView(view, apps),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  let root = document.querySelector<HTMLElement>('[data-view]')!
  let g = graph((b) => Promise.resolve(b))
  g.set(SHARED_APPS, sharedRows(ADA, apps))
  bindShared(root, g)
  // Each app by the address it opens at.
  let shown = () => [
    ...new Set(
      [...root.querySelectorAll('a[href^="https://"]')].map((a) =>
        a.getAttribute('href')!.split('/').slice(0, 4).join('/') + '/'
      ),
    ),
  ]
  return { root, g, shown }
}

test('an app someone shares shows at once, at the address it lives at', () => {
  let { g, shown } = bound([app('notes')])
  equal(shown(), ['https://bea.yaks.app/notes/'])
  g.set(SHARED_APPS, sharedRows(ADA, [app('notes'), app('lists', 'cy')]))
  equal(shown(), [
    'https://bea.yaks.app/notes/',
    'https://cy.yaks.app/lists/',
  ])
})

test('the last app taken away leaves the page saying nothing is shared', () => {
  let { root, g } = bound([app('notes')])
  g.set(SHARED_APPS, [])
  equal(
    root.querySelector('.Empty_Title')?.textContent,
    'Nothing shared with you yet',
  )
})
