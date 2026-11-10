import { test } from '@yaks/testing'
import { assertStringIncludes } from '@std/assert'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { print } from '@yaks/tui/print'
import { everforest, kits, rosepine, sheet, stylesheet } from './mod.ts'
import { specimens as rows } from './Rows.ts'
import { specimens as sections } from './Section.ts'
import { specimens as toolbars } from './Toolbar.ts'
import { specimens as tabs } from './Tabs.ts'

test('compact sections and split rows carry words and controls in both themes and both doors', async () => {
  let node = h(
    'section',
    {},
    toolbars()[0][1],
    tabs()[0][1],
    sections()[0][1],
    rows()[0][1],
  )
  for (let theme of [everforest, rosepine]) {
    let composition = { kits, theme }
    let html = renderToString(node)
    let terminal = print(node, 120, sheet(composition))
    for (
      let text of [
        'Available',
        'An item',
        'More about this item.',
        'Refresh',
        'Selected',
        '2 more',
      ]
    ) {
      assertStringIncludes(html, text)
      assertStringIncludes(terminal, text)
    }
    let css = await stylesheet(composition)
    assertStringIncludes(css, '.Rows_Detail-inset')
  }
})
