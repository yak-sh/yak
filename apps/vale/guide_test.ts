import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Guide } from '@yaks/ui/guide'
import { sheet, stylesheet } from '@yaks/ui'
import { guideComposition } from './guide-composition.ts'

test('Vale guide composes base and its own UI/UX with skin coverage and fallback', async () => {
  let c = guideComposition()
  let html = renderToString(h(Guide, { composition: c }))
  assert(html.includes('id="Button" data-skin="skin"'))
  assert(html.includes('id="Dot" data-skin="kit"'))
  assert(html.includes('id="ui/vale/ValeMeter"'))
  assert(html.includes('id="ux/base/Edit"'))
  assert(html.includes('id="ux/vale/List"'))
  let css = await stylesheet(c)
  assert(css.includes('--text: var(--book-ink)'))
  assert(css.includes('.ValeMeter'))
  assert(css.includes('.Panes'))
  assertEquals(sheet(c).Button.fg, c.theme.colors.accent)
  assertEquals(guideComposition('everforest', 'base').skin, undefined)
  assert(guideComposition('rosepine').theme != c.theme)
})
