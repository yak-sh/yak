import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { everforest } from './everforest.ts'
import { kits, sheet, skins, stylesheet } from './kit.ts'
import { page } from './routes.ts'

test('Ledger changes shape, not theme or tree, with four covered parts and kit fallback', async () => {
  let base = { kits, theme: everforest }
  let dressed = { ...base, skin: skins.ledger }
  let css = await stylesheet(dressed)
  assert(css.includes('border-width: 1px 1px 3px'))
  assert(css.includes('.Dot'))
  assertEquals(sheet(dressed).Button.bold, true)
  assertEquals(sheet(dressed).Dot, sheet(base).Dot)
  let html = await page('rosepine', 'light', 'ledger')
  assert(html.includes('color-scheme: light'))
  assert(html.includes('?theme=everforest&amp;scheme=light&amp;skin=ledger'))
  assert(html.includes('id="Button" data-skin="skin"'))
  assert(html.includes('id="Dot" data-skin="kit"'))
  assertEquals((html.match(/data-skin="skin"/g) ?? []).length, 4)
  assertEquals((html.match(/class="Catalog_Entry"/g) ?? []).length, 35)
  let back = await page('everforest', 'dark', 'base')
  assert(!back.includes('border-width: 1px 1px 3px'))
})
