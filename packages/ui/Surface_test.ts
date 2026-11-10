import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { block } from './el.ts'
import { Surface } from './Surface.ts'
import { sheet, sheets } from './kit.ts'
import { linen } from './linen.ts'
import { pencil } from './pencil.ts'
import type { Composition } from './theme.ts'

// No base kit, named skin entry or appearance CSS for this component.
let Receipt = block(Surface, 'Receipt', {
  Action: Surface.Press,
  Choices: Surface.Raised,
  Value: Surface.Well,
})
let composition: Composition = {
  theme: linen,
  skin: pencil,
  kits: {
    extra: {
      Receipt: {
        Component: Receipt,
        css: new URL('data:text/css,.Receipt { display: grid; gap: 1em }'),
        description: 'A receipt',
        sheet: () => ({ Receipt: { gap: true } }),
        specimens: () => [],
      },
    },
  },
}
let styles = await sheets(composition)
let css = styles.map(([, css]) => css).join('\n')
let { document } = parseHTML(
  `<html><head><style>${css}</style></head><body>${
    renderToString(
      h(
        Receipt,
        {},
        h(Receipt.Action, { type: 'button' }, 'Print'),
        h(Receipt.Choices, {}, 'Choices'),
        h(Receipt.Value, { value: '42' }),
      ),
    )
  }</body></html>`,
)
let rules = [...document.querySelector('style')!.sheet!.cssRules]
  .filter((rule) => rule.type == 1) as CSSStyleRule[]
// Read declarations through the emitted selector, so this fails when a new
// class falls outside the shared drawing rule. This does not render pixels.
let matching = (part: string, property: string, pseudo = '') => {
  let node = document.querySelector(part)!
  pseudo = pseudo.replaceAll("'", '"')
  return rules.filter((rule) =>
    !rule.selectorText.slice(0, pseudo ? -pseudo.length : undefined).includes(
      '::',
    ) &&
    !/:(hover|active|focus-visible|disabled)/.test(
      rule.selectorText.slice(0, pseudo ? -pseudo.length : undefined),
    ) &&
    rule.selectorText.endsWith(pseudo) &&
    rule.style.getPropertyValue(property) &&
    node.matches(
      pseudo ? rule.selectorText.slice(0, -pseudo.length) : rule.selectorText,
    )
  )
}

test('a component absent from the skin inherits its surface paint in a subset kit', () => {
  assertEquals(styles.map(([name]) => name), ['theme', 'Surface', 'Receipt'])
  assertEquals(pencil.Receipt, undefined)
  assert(matching('.Receipt', 'background').length)
  assert(matching('.Receipt', 'border', '::after').length)
  assert(matching('.Receipt_Action', 'background', '::before').length)
  assert(
    matching(
      '.Receipt_Action',
      'background',
      ":hover:not(:disabled, [aria-pressed='true'])",
    ).length,
  )
  assert(matching('.Receipt_Choices', 'box-shadow').length)
  assert(matching('.Receipt_Value', 'box-shadow').length)
  let tokens = rules.find((rule) =>
    rule.style.getPropertyValue('--raised-hatch') == 'var(--hatch)'
  )!
  assertEquals(tokens.style.getPropertyValue('--edge-filter'), 'var(--drawn)')
  assertEquals(tokens.style.getPropertyValue('--raised-hatch'), 'var(--hatch)')
  assert(sheet(composition).Surface_Press)
  assert(sheet(composition).Surface_Well)
})
