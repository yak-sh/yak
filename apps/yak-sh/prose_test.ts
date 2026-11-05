// The page's words, with each mention of yaks.app a link to it.
import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { type ComponentChild, h, render } from 'preact'
import { Prose, words } from './prose.ts'

let { document } = parseHTML('<main></main>')
// What a node reads as, each link written [words](href target rel) and code
// in backticks.
let read = (n: Node): string => {
  if (n.nodeType == 3) return n.textContent!
  let el = n as Element
  let inner = [...el.childNodes].map(read).join('')
  if (el.localName == 'code') return `\`${inner}\``
  if (el.localName != 'a') return inner
  let [href, target, rel] = ['href', 'target', 'rel'].map((a) =>
    el.getAttribute(a)
  )
  return `[${inner}](${href} ${target} ${rel})`
}
let drawn = (node: ComponentChild) => {
  Object.assign(globalThis, { document })
  let root = document.querySelector('main')!
  render(node, root as unknown as Element)
  return read(root as unknown as Node)
}
let link = '[yaks.app](https://yaks.app _blank noopener)'

test('yaks.app is linked as a word of its own, never inside a longer name or in code', () => {
  let cases: [string, string][] = [
    ['On yaks.app, it runs.', `On ${link}, it runs.`],
    ["yaks.app's graph", `${link}'s graph`],
    ['It runs on yaks.app.', `It runs on ${link}.`],
    ['yourname.yaks.app/recipes', 'yourname.yaks.app/recipes'],
    ['yaks.application', 'yaks.application'],
  ]
  equal(
    cases.map(([line]) => drawn(h('p', null, words(line)))),
    cases.map(([, said]) => said),
  )
  equal(
    drawn(h(Prose, { source: 'Run `yak auth yaks.app` on **yaks.app**.' })),
    `Run \`yak auth yaks.app\` on ${link}.`,
  )
})
