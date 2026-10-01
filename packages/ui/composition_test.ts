import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { test } from '@yaks/testing'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { print } from '@yaks/tui/print'
// deno-lint-ignore no-control-regex -- read the terminal's words
let plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
import { el } from './el.ts'
import { Guide, Page, stopsOf } from './guide.ts'
import { gather, kits, sheet, stylesheet } from './kit.ts'
import { everforest } from './everforest.ts'
import type { Composition, Kit } from './theme.ts'

let css = (text: string) => new URL(`data:text/css,${encodeURIComponent(text)}`)
let Extra = el('span', 'Extra')
let external: Kit = {
  Extra: {
    Component: Extra,
    css: css('.Extra { color: red }'),
    description: 'A part brought by another package.',
    specimens: () => [['ordinary', h(Extra, {}, 'outside')]],
    sheet: (c) => ({ Extra: { fg: c.positive } }),
  },
}
let c: Composition = {
  kits: { ...kits, external },
  theme: everforest,
  skin: { Extra: { css: css('.Extra { color: blue }') } },
}

test('external parts carry their own CSS; a partial skin replaces only named parts', async () => {
  let out = await stylesheet(c)
  assert(out.indexOf('--bg:') < out.indexOf('.Extra'))
  assert(out.includes('.Button'))
  assert(out.includes('.Extra { color: blue }'))
  assert(!out.includes('.Extra { color: red }'))
  assertEquals(sheet(c).Extra.fg, everforest.colors.positive)
  let terminal = {
    ...c,
    skin: {
      Extra: {
        css: css(''),
        sheet: () => ({ Extra: { bold: true } }),
      },
    },
  }
  assertEquals(sheet(terminal).Extra, { bold: true })
  assertEquals(sheet(terminal).Dot, sheet({ kits, theme: everforest }).Dot)
})

test('the same guide renders external UI and UX specimens and skin coverage in both places', () => {
  let dressed: Composition = {
    ...c,
    ux: {
      external: {
        description: 'Behaviours',
        components: {
          Select: {
            description: 'Controlled choice',
            specimens: () => [['choice', h(Extra, {}, 'selected')]],
          },
        },
      },
    },
  }
  let node = h(Guide, { composition: dressed })
  let html = renderToString(node)
  assert(html.includes('id="ui/external/Extra" data-skin="skin"'))
  assert(html.includes('id="Button" data-skin="kit"'))
  assert(html.includes('Controlled choice'))
  let text = plain(print(node, 100, sheet(dressed)))
  assert(text.includes('outside'))
  assert(text.includes('selected'))
})

test('installed facets gather all four contribution kinds and reject ambiguous names', () => {
  let ux = { tools: { description: 'tools', components: {} } }
  let all = gather([{ kits, themes: { everforest } }, {
    kits: { external },
    ux,
    skins: { custom: c.skin! },
  }])
  assertEquals(Object.keys(all.kits!), ['base', 'external'])
  assertEquals(all.ux, ux)
  assertEquals(all.skins!.custom, c.skin)
  assertThrows(() => gather([{ kits }, { kits }]), Error, 'duplicate UI kits')
  assertThrows(
    () => sheet({ ...c, kits: { a: external, b: external } }),
    Error,
    'duplicate UI part',
  )
})

test('missing external CSS is a composition failure, not an undressed page', async () => {
  await assertRejects(() =>
    stylesheet({
      ...c,
      skin: {
        Extra: { css: new URL('file:///definitely-absent-ui.css') },
      },
    })
  )
})

test('UI and UX with the same names retain distinct specimens and navigation', () => {
  let dressed: Composition = {
    ...c,
    ux: {
      base: {
        description: 'behaviours',
        components: {
          Edit: {
            description: 'UX editor',
            specimens: () => [['behaviour', h(Extra, {}, 'UX EDIT')]],
          },
          Stack: {
            description: 'UX stack',
            specimens: () => [['behaviour', h(Extra, {}, 'UX STACK')]],
          },
        },
      },
    },
  }
  let html = renderToString(h(Guide, { composition: dressed }))
  assert(html.includes('id="Edit"'))
  assert(html.includes('id="ux/base/Edit"'))
  assert(html.includes('UX EDIT'))
  assert(stopsOf(dressed).includes('ux/base/Stack'))
  let ui = renderToString(h(Page, { stop: 'Edit', composition: dressed }))
  assert(!ui.includes('UX EDIT'))
  let ux = renderToString(
    h(Page, { stop: 'ux/base/Edit', composition: dressed }),
  )
  assert(ux.includes('UX EDIT'))
  let reserved = renderToString(
    h(Guide, { composition: { ...c, kits: { ...kits, Controls: external } } }),
  )
  assert(reserved.includes('id="ui/Controls/Extra"'))
  assert(reserved.includes('id="Button"'))
})
