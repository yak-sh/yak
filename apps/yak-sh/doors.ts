// The doors band, below the story: the drawing at the top of the page again,
// the same query over the same graph, with a small window over it for each
// interface. As the reader scrolls past each one, that interface makes its own
// change to the graph (the browser, an agent over MCP, a terminal), and the
// drawing shows it, a wire running from the window to what it changed.
import { type FunctionComponent, h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Markdown } from '@yaks/markdown'
import { half, type Layout, mount } from '@yaks/diagram'
import type { Bundle } from '@yaks/graph'
import { PLACES, SHEET, STORY } from './figure.ts'
import type { Ctx } from './views.ts'
import { text, useHeard, useReached, useTold } from './told.ts'
import { clicked, opener } from './editor.ts'
import { beatsOf, SITE } from './site.ts'

/** Each door's window: what its title bar says and the sign its line wears. */
export const WINDOWS: Record<string, { name: string; sign: string }> = {
  web: { name: 'browser · 127.0.0.1:8787', sign: '▸ ' },
  mcp: { name: 'agent · /mcp', sign: 'agent ▸ ' },
  sh: { name: 'terminal', sign: '$ ' },
}

/** Where the windows sit on the drawing, as fractions of it: a part of the
 * sheet the story leaves empty, the open window under the bars of the ones
 * before it. */
const DOCK = { x: .02, y: .38, width: .32, bar: .045 }

/** Where a window's wire leaves it and where it meets what the write
 * changed: a shape's near side, in the drawing's own units. */
export let wire = (layout: Layout, stacked: number, eid: string) => {
  let node = layout.nodes.find((n) => n.eid == eid)
  if (!node) return
  let [w] = half(node.shape, !!node.state)
  let x0 = layout.width * (DOCK.x + DOCK.width)
  let y0 = layout.height * (DOCK.y + DOCK.bar * (stacked + .5))
  let x1 = node.x - w, y1 = node.y
  let mid = (x0 + x1) / 2
  return `M${x0.toFixed(1)},${y0.toFixed(1)}H${mid.toFixed(1)}V${
    y1.toFixed(1)
  }H${x1.toFixed(1)}`
}

export let Doors: FunctionComponent<Ctx & { e: Bundle }> = (ctx) => {
  let { e, yak, turns } = ctx
  useTold(turns.listen)
  let { head, beats } = beatsOf(text(e, 'doc', 'body'))
  let latest = useRef(beats)
  latest.current = beats
  // How far down the beats the reader is, measured each frame they scroll,
  // and each beat passed runs; where nothing measures, as in a test, every
  // window that has run is open.
  let list = useRef<HTMLOListElement>(null)
  let upto = useReached(
    list,
    beats.length - 1,
    (k) => turns.reach(latest.current, k + 1),
  )
  // The same drawing as the top of the page: the story's query, its places.
  let sheet = useRef<HTMLDivElement>(null)
  let [layout, setLayout] = useState<Layout>()
  useEffect(() => {
    let m = mount(sheet.current!, {
      graph: yak.graph,
      query: STORY,
      ...SHEET,
      at: ({ label }) => PLACES[label],
      title: 'The graph in this tab',
      drawn: setLayout,
    })
    return () => m.stop()
  }, [])
  let open = beats.flatMap((b, i) => {
    let d = turns.done(i)
    return d && i <= upto ? [{ b, d, i }] : []
  })
  let last = open.at(-1)
  // What the open window changed is marked in the drawing.
  useEffect(() => {
    let el = sheet.current
    if (!el) return
    for (let g of el.querySelectorAll('.is-told')) {
      g.classList.remove('is-told')
    }
    let eid = last?.d.eid
    if (eid) el.querySelector(`[data-key="${eid}"]`)?.classList.add('is-told')
  })
  // An entity clicked opens; the agent's window opens the agent, the
  // browser's the page, and the terminal's goes to the prompt.
  let figure = useRef<HTMLElement>(null)
  useHeard(figure, ['click'], (ev) => {
    let picked = sheet.current && clicked(ev, sheet.current)
    if (picked) return opener(ctx)(picked)
    let door = (ev.target as Element | null)?.closest?.('.Window')
      ?.getAttribute('data-door')
    if (door == 'mcp') return opener(ctx)(yak.agent)
    if (door == 'web') return opener(ctx)(SITE)
    if (door != 'sh') return
    let input = sheet.current?.ownerDocument.querySelector<HTMLInputElement>(
      '.Prompt_Form input',
    )
    input?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    input?.focus({ preventScroll: true })
  })
  let path = layout && last?.d.eid
    ? wire(layout, open.length - 1, last.d.eid)
    : undefined
  return h('section', { class: 'Band Doors', 'data-eid': e.entity.eid }, [
    h('div', { class: 'Doors_Text' }, [
      h('div', { class: 'Band_Text' }, [
        h('h2', null, text(e, 'doc', 'title')),
        h(Markdown, { source: head }),
      ]),
      h(
        'ol',
        { class: 'Beats', ref: list, 'aria-label': 'Each interface, in turn' },
        beats.map((b, i) =>
          h('li', {
            class: turns.done(i) && i <= upto ? 'on' : undefined,
            'data-door': b.kind,
            key: i,
          }, [
            h('span', { class: 'Dot' }),
            h('b', null, b.title),
            h(Markdown, { source: b.prose }),
            h('code', null, WINDOWS[b.kind]?.sign + b.line),
          ])
        ),
      ),
    ]),
    h('figure', { class: 'Doors_Figure', ref: figure }, [
      h('div', {
        class: 'Doors_Sheet',
        style: layout
          ? `aspect-ratio: ${layout.width} / ${layout.height}`
          : undefined,
      }, [
        h('div', { class: 'Doors_Drawing', ref: sheet }),
        path
          ? h('svg', {
            class: 'Doors_Wire',
            viewBox: `0 0 ${layout!.width} ${layout!.height}`,
            'aria-hidden': 'true',
          }, h('path', { d: path, key: path, pathLength: 1 }))
          : null,
        h(
          'div',
          { class: 'Windows' },
          open.map(({ b, d, i }) =>
            h('div', {
              class: `Window${i == last?.i ? ' is-open' : ''}`,
              'data-door': b.kind,
              key: i,
            }, [
              h('div', { class: 'Window_Bar' }, [
                h('i', null),
                h('i', null),
                h('i', null),
                h('span', null, WINDOWS[b.kind]?.name ?? b.kind),
              ]),
              h('div', { class: 'Window_Screen' }, [
                h('div', { class: 'Window_Line is-in' }, [
                  h('span', { class: 'Prompt_Sign' }, WINDOWS[b.kind]?.sign),
                  b.line,
                ]),
                ...d.out.map((line) =>
                  h(
                    'div',
                    { class: `Window_Line${d.fault ? ' is-fault' : ''}` },
                    line,
                  )
                ),
              ]),
            ])
          ),
        ),
      ]),
      h('figcaption', null, [
        h('span', { class: 'No' }, 'Fig. 3'),
        'The graph drawn above. Each window is an interface writing to it.',
      ]),
    ]),
  ])
}
