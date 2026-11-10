import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { test } from '@yaks/testing'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { print } from '@yaks/tui/print'
// deno-lint-ignore no-control-regex -- read the terminal's words
let plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
import { el } from './el.ts'
import { sheet as surfaces } from './Surface.ts'
import { Guide, Page, stopsOf, Worn } from './guide.ts'
import {
  gather,
  kits,
  native,
  parts,
  sheet,
  sheets,
  stylesheet,
} from './kit.ts'
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

test("each part's native entries paint over the theme's colours; a skin replaces only the parts it names", () => {
  let parts = {
    ...kits,
    external: {
      Extra: {
        ...external.Extra,
        native: (c) => ({ Extra: { color: c.positive } }),
      },
    } as Kit,
  }
  let phone = native({ kits: parts, theme: everforest })
  assertEquals(phone.Extra, { color: everforest.colors.positive })
  assertEquals(phone['Button-go'].backgroundColor, everforest.colors.accent)
  let skinned = native({
    kits: parts,
    theme: everforest,
    skin: { Button: { native: () => ({ Button: { color: 'ink' } }) } },
  })
  assertEquals(skinned.Button, { color: 'ink' })
  assertEquals(skinned['Button-go'], undefined)
  assertEquals(skinned.Card, phone.Card)
})

test("a skin's over lays its CSS on the part's rendering, the kit's or its own", async () => {
  let over = (skin: Composition['skin']) =>
    stylesheet({ kits: { external }, theme: everforest, skin })
  let kit = await over({ Extra: { over: css('.Extra { font-weight: 500 }') } })
  assert(kit.indexOf('color: red') < kit.indexOf('font-weight: 500'))
  let own = await over({
    Extra: {
      css: css('.Extra { color: blue }'),
      over: css('.Extra { font-weight: 500 }'),
    },
  })
  assert(!own.includes('color: red'))
  assert(own.indexOf('color: blue') < own.indexOf('font-weight: 500'))
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

test("a host's guide shows the parts it wears, in the kit's groups and its skin", () => {
  let html = renderToString(
    h(Worn, { parts: ['Button', 'Extra'], composition: c }),
  )
  assert(html.includes('id="Controls"'))
  assert(html.includes('id="Button" data-skin="kit"'))
  assert(html.includes('id="ui/external/Extra" data-skin="skin"'))
  assert(!html.includes('id="Field"'), 'a part it does not wear')
  assert(!html.includes('id="Marks"'), 'a group it wears nothing of')
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
          Disclosure: {
            description: 'UX disclosure',
            specimens: () => [['behaviour', h(Extra, {}, 'UX DISCLOSURE')]],
          },
        },
      },
    },
  }
  let html = renderToString(h(Guide, { composition: dressed }))
  assert(html.includes('id="Edit"'))
  assert(html.includes('id="ux/base/Edit"'))
  assert(html.includes('UX EDIT'))
  assert(stopsOf(dressed).includes('ux/base/Disclosure'))
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

test('inlined external styles retain their own relative asset and import addresses', async () => {
  let dir = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(
      `${dir}/part.css`,
      '@import "theme.css"; .Extra {background:url(icons/mark.svg)}',
    )
    let outside = {
      ...external,
      Extra: { ...external.Extra, css: new URL(`file://${dir}/part.css`) },
    }
    let css = await stylesheet({ kits: { outside }, theme: everforest })
    assert(css.includes(`@import "file://${dir}/theme.css"`))
    assert(css.includes(`url("file://${dir}/icons/mark.svg")`))
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

let shared = (name: string): Kit => ({
  Grid: {
    ...external.Extra,
    css: css(`.${name} { color: red }`),
    sheet: () => ({ [name]: { bold: true } }),
    native: () => ({ [name]: { color: 'red' } }),
    specimens: () => [['grid', h(Extra, {}, name)]],
  },
})
let collision: Composition = {
  kits: { first: shared('First'), second: shared('Second') },
  theme: everforest,
}

test('shared part names retain both kits in browser, terminal, native and guide output', async () => {
  let all = parts(collision)
  assertEquals(all['first/Grid'], collision.kits.first.Grid)
  assertEquals(all['second/Grid'], collision.kits.second.Grid)
  assertEquals(parts(c).Extra, external.Extra)
  let css = await sheets(collision)
  assertEquals(css.map(([name]) => name), [
    'theme',
    'Surface',
    'first/Grid',
    'second/Grid',
  ])
  assert(css[2][1].includes('.First'))
  assert(css[3][1].includes('.Second'))
  assertEquals(sheet(collision), {
    ...surfaces(everforest.colors),
    First: { bold: true },
    Second: { bold: true },
  })
  assertEquals(native(collision), {
    First: { color: 'red' },
    Second: { color: 'red' },
  })
  let html = renderToString(h(Guide, { composition: collision }))
  for (let kit of ['first', 'second']) {
    assert(stopsOf(collision).includes(`ui/${kit}/Grid`))
    assert(html.includes(`id="ui/${kit}/Grid"`))
  }
  assert(html.includes('First'))
  assert(html.includes('Second'))
})

test('scoped skins target one shared name and override bare skin entries in every renderer', async () => {
  let dressed: Composition = {
    ...collision,
    skin: {
      Grid: {
        css: css('.Legacy { color: blue }'),
        sheet: () => ({ Legacy: { inverse: true } }),
        native: () => ({ Legacy: { color: 'blue' } }),
      },
      'second/Grid': {
        css: css('.Scoped { color: green }'),
        sheet: () => ({ Scoped: { dim: true } }),
        native: () => ({ Scoped: { color: 'green' } }),
      },
    },
  }
  let dressedCss = await sheets(dressed)
  assert(dressedCss[2][1].includes('.Legacy'))
  assert(dressedCss[3][1].includes('.Scoped'))
  assertEquals(sheet(dressed), {
    ...surfaces(everforest.colors),
    Legacy: { inverse: true },
    Scoped: { dim: true },
  })
  assertEquals(native(dressed), {
    Legacy: { color: 'blue' },
    Scoped: { color: 'green' },
  })
  let targeted = {
    ...dressed,
    skin: { 'second/Grid': dressed.skin!['second/Grid'] },
  }
  let html = renderToString(h(Guide, { composition: targeted }))
  assert(html.includes('id="ui/first/Grid" data-skin="kit"'))
  assert(html.includes('id="ui/second/Grid" data-skin="skin"'))
  let worn = renderToString(
    h(Worn, { parts: ['second/Grid'], composition: targeted }),
  )
  assert(!worn.includes('id="ui/first/Grid"'))
  assert(worn.includes('id="ui/second/Grid"'))
  // Scoped names also work before another kit contributes the same part name.
  let unique = { ...targeted, kits: { second: collision.kits.second } }
  assertEquals(sheet(unique), {
    ...surfaces(everforest.colors),
    Scoped: { dim: true },
  })
  assertEquals(parts(unique).Grid, collision.kits.second.Grid)
})

test('a published alias keeps the same skin rendering as its part', async () => {
  let dressed: Composition = {
    kits,
    theme: everforest,
    skin: { Cards: { css: css('.Cards { color: blue }') } },
  }
  let out = await sheets(dressed)
  assertEquals(
    out.find(([name]) => name == 'Cards')?.[1],
    '.Cards { color: blue }',
  )
  assertEquals(
    out.find(([name]) => name == 'Grid')?.[1],
    '.Cards { color: blue }',
  )
})
