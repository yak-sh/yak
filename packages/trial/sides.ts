/**
 * How a side of a pair is drawn, through @yaks/render: the `Side` view of an
 * attempt (`writing{output}`) as its parts, of an image (`artifact{address,
 * media_type}`) as itself over a link to it, and of prose (`doc{title, body}`) as its title over
 * its paragraphs. The renderers build with the caller's `h`, so the tap page
 * (./page.ts) mounts them in the browser and a test reads them in plain text.
 *
 * What the page is handed of a side is {@link shown}: the components these
 * views draw, and nothing that says who or what made it.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { render } from '@yaks/text'
 * import { side, sides, vocab } from '@yaks/trial/sides'
 *
 * let pitch = { entity: { eid: 'a' }, writing: { output: { headline: 'Hi' } } }
 * equal(render(sides, pitch, 'Side', vocab(), side(['headline'])), '## Hi')
 * ```
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { parse } from '@yaks/query/core'
import {
  define,
  type H,
  type Registry,
  type RenderContext,
  rendering,
  resolve,
} from '@yaks/render'
import { loadVocab, type Vocab } from '@yaks/vocab'
import { docs as blobDocs, keywords as blobKeywords } from '@yaks/blob/vocab'
import { docs as docDocs } from '@yaks/doc/vocab'
import { docs as trialDocs } from './vocab.ts'

/** The components a side is drawn from, in the order its views prefer them. */
export let SHOWN = ['writing', 'artifact', 'doc']

/** A side as the page is handed it: an attempt's parts and no more of its
 * `writing`, and of any other entity the components {@link SHOWN} names. */
export let shown = (b: Bundle): Bundle => {
  let out: Bundle = { entity: { eid: b.entity.eid } }
  for (let name of SHOWN) {
    if (!b[name]) continue
    out[name] = name == 'writing'
      ? { output: (b.writing as { output?: unknown }).output ?? {} }
      : b[name]
  }
  return out
}

/** What the views read off their caller: the parts of an attempt, in order,
 * of which the first two show and the rest fold. */
export type SideContext = { parts: string[] }

/** The context for a round whose attempts return `parts`. */
export let side = (parts: string[]): SideContext => ({ parts })

let get = (b: Bundle, name: string) =>
  (b[name] ?? {}) as Record<string, unknown>
let text = (v: unknown) => typeof v == 'string' ? v : ''

/** The `Side` view of an attempt, an image and a document. */
export let sides: Registry = define([
  {
    view: 'Side',
    match: parse('.writing'),
    render: (b, h, ctx) => {
      let { parts } = ctx as RenderContext<unknown> & SideContext
      let output = get(b, 'writing').output as Record<string, unknown> ?? {}
      let [head, lead, ...rest] = (parts ?? Object.keys(output)).map((p) =>
        text(output[p])
      )
      let more = rest.filter((t) => t)
      return h(
        'div',
        { class: 'shown' },
        h('h2', null, head),
        lead ? h('p', { class: 'lead' }, lead) : null,
        more.length
          ? h(
            'details',
            { class: 'more' },
            h('summary', null, 'Read the rest'),
            ...more.map((t) => h('p', null, t)),
          )
          : null,
      )
    },
  },
  {
    view: 'Side',
    match: parse('.artifact'),
    render: (b, h) => {
      let { address, media_type } = get(b, 'artifact')
      let title = text(get(b, 'doc').title)
      let src = `/blob/${text(address)}`
      // The link is what a terminal shows of it.
      return h(
        'figure',
        { class: 'shown' },
        text(media_type).startsWith('image/')
          ? h('img', { src, alt: title, loading: 'lazy' })
          : null,
        h('figcaption', null, h('a', { href: src }, title || src)),
      )
    },
  },
  {
    view: 'Side',
    match: parse('.doc'),
    render: (b, h) => {
      let { title, body } = get(b, 'doc')
      return h(
        'div',
        { class: 'shown' },
        text(title) ? h('h2', null, text(title)) : null,
        ...text(body).split(/\n\s*\n/).filter((p) => p.trim()).map((p) =>
          h('p', null, p.trim())
        ),
      )
    },
  },
  // Anything else is shown by its eid, which is all it has to show.
  {
    view: 'Side',
    match: true,
    render: (b, h) => h('p', { class: 'shown' }, b.entity.eid),
  },
])

/** The vocabulary the views are selected against: the components they draw. */
export let vocab = (): Vocab =>
  loadVocab([...trialDocs, ...docDocs, ...blobDocs], blobKeywords)

let loaded: Vocab | undefined

/** A side drawn with the host's `h`, for a round whose attempts return
 * `parts`. */
export let draw = <Node>(
  b: Bundle,
  h: H<Node>,
  parts: string[],
): Node | null => {
  let v = loaded ??= vocab()
  let ctx = { ...side(parts), readOnly: true, vocab: v } as
    & RenderContext<Node>
    & SideContext
  let selected = resolve(sides, b, 'Side', v, ctx)
  return selected ? rendering(selected, ctx)?.(b, h, ctx) ?? null : null
}
