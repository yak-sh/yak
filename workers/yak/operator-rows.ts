// The chat page's lines drawn as HTML from what its socket sends
// (operator-draw.ts `Lines`): in the browser, as `_talk.js` (client-assets.ts),
// which the page puts in place by id (public/redraw.js); and in the Builder
// object for a page that opened its socket before lines were sent as data.
import { Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { drawLines, type Line, type Lines } from './operator-draw.ts'

/** A drawn line of a transcript: what it shows, under the id it is put by. */
export type Row = { id: string; html: string }

/** A line drawn as HTML. */
export let drawn = ({ id, node }: Pick<Line, 'id' | 'node'>): Row => ({
  id,
  html: renderToString(h(Fragment, null, node)),
})

/** Each line sent, drawn as HTML. */
export let rowsOf = (sent: Lines): Row[] => drawLines(sent).map(drawn)

// The aside beside the lines, drawn the same way (operator-aside.ts).
export {
  asideHtml,
  glanceHtml,
  helperHtml,
  lasted,
  ordered,
  turnHtml,
} from './operator-aside.ts'

export { menus, tips } from '@yaks/ui/parts'

// A human id as @yaks/id writes one: a series' letters, a dash, a number.
let ID = /\b[A-Z]+-\d+\b/g

// The ids in `node`'s words made links to `url`, each with `{id}` replaced
// by it, opening in a tab of their own. Words already in a link stay.
let linked = (node: Node, url: string) => {
  for (let child of [...node.childNodes]) {
    if (child.nodeName == 'A') continue
    if (child.nodeType != 3) {
      linked(child, url)
      continue
    }
    let text = child.textContent ?? ''
    let found = [...text.matchAll(ID)]
    if (!found.length) continue
    let doc = child.ownerDocument!
    let parts: Node[] = []
    let at = 0
    for (let m of found) {
      parts.push(doc.createTextNode(text.slice(at, m.index)))
      let a = doc.createElement('a')
      a.setAttribute('href', url.replaceAll('{id}', encodeURIComponent(m[0])))
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener')
      a.textContent = m[0]
      parts.push(a)
      at = m.index + m[0].length
    }
    parts.push(doc.createTextNode(text.slice(at)))
    ;(child as ChildNode).replaceWith(...parts)
  }
}

/**
 * Each id in the Operator's replies under `root` (T-123) made a link to where
 * the person's server says it opens: `url`, with `{id}` where the id goes. A
 * `root` inside a reply links what it holds. The page learns `url` from the
 * server's row (`mentions{url}`) and knows nothing else about the ids.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { parseHTML } from 'linkedom'
 * import { mention } from './operator-rows.ts'
 * let { document } = parseHTML(
 *   '<div><div class="Transcript_Reply"><p>See T-12 and <code>D-4</code>, not <a href="/x">T-9</a>.</p></div><p>T-7</p></div>',
 * )
 * mention(document, 'https://tasks.example/{id}')
 * mention(document, 'https://tasks.example/{id}')
 * equal(
 *   [...document.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
 *   [
 *     ['T-12', 'https://tasks.example/T-12'],
 *     ['D-4', 'https://tasks.example/D-4'],
 *     ['T-9', '/x'],
 *   ],
 * )
 * ```
 */
export let mention = (root: ParentNode, url: string) => {
  let reply = (root as Element).closest?.('.Transcript_Reply')
  if (reply) return linked(root as Node, url)
  for (let r of root.querySelectorAll('.Transcript_Reply')) linked(r, url)
}
