import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { createElement as h } from 'react'
import { renderToStaticMarkup as renderToString } from 'react-dom/server'
import { Copy } from './Copy.ts'
import { kit, skins, stylesheet } from './kit.ts'
import { linen } from './linen.ts'

// A copyable as each skin draws it, and the declarations its rules give a
// property of what a selector picks (in order; no cascade by specificity).
let drawn = await Promise.all(
  Object.entries(skins).map(async ([name, skin]) => {
    let css = await stylesheet({
      kits: { base: { Copy: kit.Copy, Icon: kit.Icon, Button: kit.Button } },
      theme: linen,
      skin,
    })
    let { document } = parseHTML(
      `<html><head><style>${css}</style></head><body>${
        renderToString(h(Copy, { what: 'the link' }, 'https://yaks.app/agent'))
      }</body></html>`,
    )
    let rules = [...document.querySelector('style')!.sheet!.cssRules]
      .filter((rule) => rule.type == 1) as CSSStyleRule[]
    let said = (selector: string, property: string) =>
      rules.filter((rule) =>
        !rule.selectorText.includes('::') &&
        rule.style.getPropertyValue(property) &&
        document.querySelector(selector)!.matches(rule.selectorText)
      ).map((rule) => rule.style.getPropertyValue(property))
    return { name, document, said }
  }),
)

test('a copyable is in the mono face with a copy button in every skin', () => {
  for (let { name, document, said } of drawn) {
    assertEquals(said('.Copy_Text', 'font-family').at(-1), 'var(--mono)', name)
    let go = document.querySelector('button.Copy_Go')!
    assertEquals(go.getAttribute('aria-label'), 'Copy the link', name)
    assertEquals(go.querySelectorAll('svg.Icon').length, 2, name)
  }
})

test("a copyable shows its copy glyph, and a check once it's copied", () => {
  for (let { name, document, said } of drawn) {
    let hidden = (icon: string) => said(icon, 'display').includes('none')
    assert(!hidden('.Copy_Icon:not(.Copy_Icon-done)'), name)
    assert(hidden('.Copy_Icon-done'), name)
    document.querySelector('.Copy')!.classList.add('Copy-copied')
    assert(hidden('.Copy_Icon:not(.Copy_Icon-done)'), name)
    assert(!hidden('.Copy_Icon-done'), name)
  }
})
