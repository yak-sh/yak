// Render the configured doc Body and the raw Markdown tab with their shipped
// stylesheet. The source-tab declarations must not match the reading view.
import { test } from '@yaks/testing'
import '../../testing.ts'
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { views } from '@yaks/doc/views'
import { contributedViews } from '../inspect.tsx'
import { cache, ent } from '../../live.ts'
import { extend, registry, renderView } from '../registry.ts'
import { mount } from '../mount.ts'
import '../Entity.tsx'
import { Md } from './Md.tsx'

let css = await Deno.readTextFile(new URL('../../styles.css', import.meta.url))

test('configured doc Body wraps while the Markdown source tab remains preformatted', async () => {
  let eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let prior = registry.renderers
  extend(await contributedViews([{ views }]))
  cache.value = {
    [eid]: {
      entity: { eid, num: 1 },
      doc: {
        eid,
        title: 'Wrapping',
        body: 'Words in a paragraph. '.repeat(40),
      },
    },
  }
  let mounted = mount(
    h('div', {}, renderView(ent(eid), 'Body'), h(Md, { e: ent(eid) })),
  )
  try {
    let style = document.createElement('style')
    // linkedom's older CSS parser cannot parse nested CSS. These are all
    // leaf rules declaring white-space, with the shipped selectors unchanged.
    style.textContent = [
      ...css.matchAll(/([^{}]+)\{([^{}]*white-space:[^{}]*)\}/g),
    ]
      .map((m) => `${m[1]}{${m[2]}}`).join('\n')
    mounted.root.append(style)
    // linkedom parses CSS but does not lay it out. Match the real declarations
    // on each view and its ancestors; Chrome verifies computed style/layout
    // separately on the scratch server.
    let whitespace = (node: Element | null): string => {
      if (!node) return 'normal'
      let value = ''
      for (let rule of Array.from(style.sheet!.cssRules)) {
        let styled = rule as CSSStyleRule
        if (styled.selectorText && node.matches(styled.selectorText)) {
          value = styled.style.getPropertyValue('white-space') || value
        }
      }
      return value || whitespace(node.parentElement)
    }
    let paragraph = mounted.root.querySelector('div.Md p')!
    let source = mounted.root.querySelector('pre.Md')!
    assertEquals(!!paragraph, true)
    assertEquals(!!source, true)
    assertEquals(whitespace(paragraph), 'normal')
    assertEquals(whitespace(source.querySelector('code')), 'pre')
    assertEquals(
      source.textContent!.includes('---\nid: D-1\ntitle: Wrapping'),
      true,
    )
  } finally {
    mounted.free()
    registry.renderers = prior
    cache.value = {}
  }
})
