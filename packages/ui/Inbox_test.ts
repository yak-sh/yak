import { test } from '@yaks/testing'
import { assertStringIncludes } from '@std/assert'
import { renderToString } from 'preact-render-to-string'
import { print } from '@yaks/tui/print'
import { everforest, kits, rosepine, sheet, stylesheet } from './mod.ts'
import { specimens } from './Inbox.ts'

test('inbox specimens carry their words and controls in both themes and both doors', async () => {
  let node = specimens()[0][1]
  for (let theme of [everforest, rosepine]) {
    let composition = { kits, theme }
    let html = renderToString(node)
    let terminal = print(node, 120, sheet(composition))
    for (
      let text of [
        'Needs you',
        'blocking · decision',
        'Platform seven.',
        'Said',
        'Received',
      ]
    ) {
      assertStringIncludes(html, text)
      assertStringIncludes(terminal, text)
    }
    let css = await stylesheet(composition)
    assertStringIncludes(css, '.Inbox_Open:focus-visible')
    assertStringIncludes(css, '.Inbox_Preview')
  }
})
