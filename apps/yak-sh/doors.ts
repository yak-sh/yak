// The bands of turns below the story: the drawing at the top of the page
// again, over the same graph, with a small window over it for each beat. As
// the reader scrolls past each, its interface makes its own change to the
// graph (the browser, an agent over MCP, a terminal) and the drawing shows it,
// a wire running from the window to what it changed. The doors band gives
// each interface one change; the rules band shows what rules and effects make
// of a write, the declarations that did it beside each beat, and the outbox
// an effect handed a letter to.
import { type FunctionComponent, h } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Markdown } from '@yaks/markdown'
import { half, type Layout, mount } from '@yaks/diagram'
import type { Bundle } from '@yaks/graph'
import { placeOf, SHEET, STORY } from './figure.ts'
import type { Ctx } from './views.ts'
import { text, useHeard, useReached, useTold } from './told.ts'
import { clicked, opener } from './editor.ts'
import { beatsOf, SITE } from './site.ts'
import { fate, since, Toast } from './bands.ts'

/** Each door's window: what its title bar says and the sign its line wears.
 * The outbox is where the mail effect hands a letter, standing in for a mail
 * service. */
export const WINDOWS: Record<string, { name: string; sign: string }> = {
  web: { name: 'browser · 127.0.0.1:8787', sign: '▸ ' },
  mcp: { name: 'agent · /mcp', sign: 'agent ▸ ' },
  sh: { name: 'terminal', sign: '$ ' },
  outbox: { name: 'outbox · mail in this tab, sent nowhere', sign: '✉ ' },
}

/** What the rules band draws: the story, and the letters its questions sent. */
export const MAILED =
  '.task|.comment|.edge|.person|.persona|.mail.target.decision *'

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

/** A rule or effect as the vocabulary that declares it writes it: its name,
 * what it is and whose it is, and what it matches or is triggered by. */
let Declared = (
  { name, from, def }: {
    name: string
    from: string
    def: Record<string, unknown>
  },
) => {
  let said = Object.entries(def)
    .filter(([k]) => k != 'description' && k != 'option')
    .map(([k, v], i, all) =>
      `    ${JSON.stringify(k)}: ${JSON.stringify(v)}${
        i < all.length - 1 ? ',' : ''
      }`
    )
  return h('div', { class: 'Declared', 'data-declared': name }, [
    h('div', { class: 'Declared_Bar' }, [
      h('b', null, def.rule ? 'rule' : 'effect'),
      ` ${from == 'shop' ? "this app's" : `${from}'s`} vocab.json`,
    ]),
    h(
      'pre',
      null,
      [`  ${JSON.stringify(name)}: {`, ...said, '  }'].join('\n'),
    ),
    h('p', null, String(def.description ?? '')),
  ])
}

let band = (
  { query, no, caption }: { query: string; no: string; caption: string },
): FunctionComponent<Ctx & { e: Bundle }> =>
(ctx) => {
  let { e, yak, turns } = ctx
  let key = e.entity.eid
  useTold(turns.listen)
  useTold(yak.outbox.listen)
  useTold((l) => yak.watch('*', l))
  let { head, beats } = beatsOf(text(e, 'doc', 'body'))
  // Drawn in page order, so a band reached runs the bands above it first.
  turns.band(key, beats)
  // How far down the beats the reader is, measured each frame they scroll,
  // and each beat passed runs; where nothing measures, as in a test, every
  // window that has run is open.
  let list = useRef<HTMLOListElement>(null)
  let upto = useReached(
    list,
    beats.length - 1,
    (k) => turns.reach(key, k + 1),
  )
  // The same drawing as the top of the page, in its places.
  let sheet = useRef<HTMLDivElement>(null)
  let [layout, setLayout] = useState<Layout>()
  useEffect(() => {
    let m = mount(sheet.current!, {
      graph: yak.graph,
      query,
      ...SHEET,
      at: placeOf,
      title: 'The graph in this tab',
      drawn: setLayout,
    })
    return () => m.stop()
  }, [])
  // The letter an outbox beat follows, by its subject.
  let letter = (subject: string) =>
    yak.rows().find((r) => r.mail && text(r, 'doc', 'title') == subject)
  let open = beats.flatMap((b, i) => {
    let d = turns.done(key, i)
    if (!d || i > upto) return []
    let eid = b.kind == 'outbox' ? letter(b.line)?.entity.eid : d.eid
    let tries = b.kind == 'outbox'
      ? yak.outbox.tries().filter((t) => t.subject == b.line)
      : []
    // What its window prints: what came back, or the letter's tries.
    let out = b.kind == 'outbox'
      ? tries.map((t) => `${since(t, tries[0])}  ${fate(t)}`)
      : d.out
    return [{ b, d, i, eid, out }]
  })
  let last = open.at(-1)
  // What the open window changed is marked in the drawing, as each render
  // and each drawing commits, before the page paints.
  useLayoutEffect(() => {
    let el = sheet.current
    if (!el) return
    for (let g of el.querySelectorAll('.is-told')) {
      g.classList.remove('is-told')
    }
    let eid = last?.eid
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
  let path = layout && last?.eid
    ? wire(layout, open.length - 1, last.eid)
    : undefined
  // The letter the open outbox window follows, once it was sent.
  let sent = last?.b.kind == 'outbox' ? letter(last.b.line) : undefined
  let declared = (last?.b.shows ?? []).flatMap((name) => {
    let d = yak.declared(name)
    return d?.def ? [{ name, from: d.from, def: d.def }] : []
  })
  return h('section', { class: 'Band Doors', 'data-eid': key }, [
    h('div', { class: 'Doors_Text' }, [
      h('div', { class: 'Band_Text' }, [
        h('h2', null, text(e, 'doc', 'title')),
        h(Markdown, { source: head }),
      ]),
      h(
        'ol',
        { class: 'Beats', ref: list, 'aria-label': 'Each turn, in order' },
        beats.map((b, i) =>
          h('li', {
            class: turns.done(key, i) && i <= upto ? 'on' : undefined,
            'data-door': b.kind,
            key: i,
          }, [
            h('span', { class: 'Dot' }),
            h('b', null, b.title),
            h(Markdown, { source: b.prose }),
            b.kind == 'outbox'
              ? null
              : h('code', null, WINDOWS[b.kind]?.sign + b.line),
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
          open.map(({ b, d, i, out }) =>
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
                ...out.map((line) =>
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
      declared.length
        ? h('div', { class: 'Declares' }, declared.map((d) => h(Declared, d)))
        : null,
      h('figcaption', null, [h('span', { class: 'No' }, no), caption]),
    ]),
    sent?.delivered
      ? h(Toast, {
        to: text(sent, 'mail', 'to'),
        title: text(sent, 'doc', 'title'),
        key: sent.entity.eid,
      })
      : null,
  ])
}

export let Doors = band({
  query: STORY,
  no: 'Fig. 3',
  caption: 'The graph drawn above. Each window is an interface writing to it.',
})

export let Rules = band({
  query: MAILED,
  no: 'Fig. 4',
  caption:
    'The graph drawn above, with its letters. Under it, the rule or effect each turn ran, as its vocabulary declares it.',
})
