// List rows stay flat, and trades keep their icon beside the name and level.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { ALL, ledger, tradesOf } from '../trades.ts'
import { buildSync } from 'npm:esbuild@0.28.1'
import { JSDOM } from 'npm:jsdom@26.1.0'
import { fileURLToPath } from 'node:url'

// Preserve the shipped import order, flattening native nesting for JSDOM.
let css = buildSync({
  entryPoints: [fileURLToPath(new URL('./components.css', import.meta.url))],
  bundle: true,
  write: false,
  supported: { nesting: false },
}).outputFiles[0].text
let styled = (html: string) =>
  new JSDOM(
    `<html><head><style>${css}</style></head><body>${html}</body></html>`,
  )

test('trade icons share the name line through the shipped stylesheet cascade', () => {
  let { window } = styled('<div id=host></div>')
  try {
    let body = window.document.querySelector<HTMLElement>('#host')!
    let tab = {
      body,
      open: true,
      show: () => {},
      close: () => {},
      toggle: () => {},
    }
    ledger(tab, () => '').show(tradesOf([]))
    let rows = [...body.querySelectorAll('.Trades_Row')]
    assertEquals(rows.length, ALL.length)
    for (let row of rows) {
      let style = window.getComputedStyle(row)
      assertEquals(style.display, 'grid')
      assertEquals(style.gridTemplateColumns, '2.4rem minmax(0, 1fr) auto')
      let icon = row.firstElementChild!
      assertEquals(icon.tagName, 'I')
      assertEquals(icon.querySelectorAll('svg.Glyph').length, 1)
      assertEquals(window.getComputedStyle(icon).gridRow, 'span 2')
      assertEquals(row.children[1].tagName, 'B')
    }
  } finally {
    window.close()
  }
})

test('shared list rows have no card frame and selection keeps their geometry', () => {
  let { window } = styled(
    '<button class="Split_Row Menu_Row">Audio</button>' +
      '<button class="Split_Row Menu_Row Split_Row-on">Display</button>' +
      '<button class="Menu_Set Menu_Set-on">Sound is on</button>',
  )
  try {
    let rows = [...window.document.querySelectorAll('.Split_Row')]
    let styles = rows.map((row) => window.getComputedStyle(row))
    for (let style of styles) {
      assertEquals(style.display, 'flex')
      assertEquals(style.borderTopWidth, '0px')
      assertEquals(style.borderRadius, '0')
    }
    assertEquals(styles[0].backgroundColor, 'rgba(0, 0, 0, 0)')
    let control = window.getComputedStyle(
      window.document.querySelector('.Menu_Set')!,
    )
    assertEquals(control.backgroundColor, 'rgba(0, 0, 0, 0)')
    assertEquals(control.borderRadius, '0')
    assertEquals(control.boxShadow, '')
    assertEquals(styles[0].padding, styles[1].padding)
    assertEquals(styles[0].width, styles[1].width)
  } finally {
    window.close()
  }
})
