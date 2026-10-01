import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { mount } from '../tui/testing.ts'
import { terminalGuide } from './tui.ts'

test('terminal guide switches skins and themes without losing its place', async () => {
  let guide = terminalGuide()
  let app = await mount(guide.App, 100, 35, guide.sheet())
  try {
    assert(app.text().includes('s skin (base)'))
    assertEquals(guide.sheet().Button.bold, undefined)
    await app.send('s')
    assert(app.text().includes('s skin (ledger)'))
    assertEquals(guide.sheet().Button.bold, true)
    let color = guide.sheet().Button.fg
    await app.send('t')
    assert(guide.sheet().Button.fg != color)
    assertEquals(guide.sheet().Button.bold, true)
    await app.send('s')
    assert(app.text().includes('s skin (base)'))
    assertEquals(guide.sheet().Button.bold, undefined)
  } finally {
    app.free()
  }
})
