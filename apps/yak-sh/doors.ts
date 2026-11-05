// The bands of turns below the story: the drawing at the top of the page
// again, over the same graph, with a window beside it for each beat, drawn as
// its interface (windows.ts). As the reader scrolls past each, its interface
// makes its own change to the graph (the browser, an agent over MCP, a
// terminal) and its window opens in its slot and stays, the drawing showing
// what it changed, a wire running from the latest window to it. The doors band gives
// each interface one change; the rules band shows what rules and effects make
// of a write, the declarations that did it beside each beat, and the outbox
// an effect handed a letter to.
import { type FunctionComponent, h } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Prose, words } from './prose.ts'
import { type Layout, mount, rim } from '@yaks/diagram'
import type { Bundle } from '@yaks/graph'
import { human } from '@yaks/id'
import { SHEET, STORY } from './figure.ts'
import type { Ctx } from './views.ts'
import { text, useHeard, useReached, useTold } from './told.ts'
import { clicked, opener } from './editor.ts'
import { beatsOf, SITE } from './site.ts'
import { Look, SIGNS } from './windows.ts'
import { fate, since, Toast } from './bands.ts'

/** What the rules band draws: the story, and the letters its questions sent. */
export const MAILED =
  '.task|.comment|.edge|.person|.persona|.mail.target.decision *'

/** The desk the windows sit on, in the drawing's own units: a column of
 * them left of the drawing, one slot for each beat of the band, with a space
 * between for the wire. */
export const DESK = { column: 380, space: 40, gap: 16 }

/** Where slot `i` of `n` sits on the desk's height, as `[top, height]`. */
let slot = (height: number, n: number, i: number) => {
  let tall = (height - DESK.gap * (n - 1)) / n
  return [i * (tall + DESK.gap), tall]
}

/** Where a window's wire leaves its slot and where it meets what the write
 * changed: a shape's near side, in the desk's units. */
export let wire = (layout: Layout, n: number, i: number, eid: string) => {
  let node = layout.nodes.find((n) => n.eid == eid)
  if (!node) return
  let [dx] = rim(node.shape, !!node.state, -1, 0)
  let [top, tall] = slot(layout.height, n, i)
  let x0 = DESK.column, y0 = top + tall / 2
  let x1 = DESK.column + DESK.space + node.x + dx, y1 = node.y
  let mid = DESK.column + DESK.space / 2
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
      title: 'The graph in this tab',
      drawn: setLayout,
    })
    return () => m.stop()
  }, [])
  // The letter an outbox beat follows, by its subject, and the persona a
  // session beat wears, by its short id.
  let letter = (subject: string) =>
    yak.rows().find((r) => r.mail && text(r, 'doc', 'title') == subject)
  let id = human(yak.vocab)
  let numbered = (short: string) =>
    yak.rows().find((r) => id(r) == short)?.entity.eid
  let find = (eid: string) => yak.rows().find((r) => r.entity.eid == eid)
  let short = (eid: string) => {
    let r = find(eid)
    return r ? id(r) : eid
  }
  let open = beats.flatMap((b, i) => {
    let d = turns.done(key, i)
    if (!d || i > upto) return []
    let eid = b.kind == 'outbox'
      ? letter(b.line)?.entity.eid
      : b.kind == 'session'
      ? numbered(b.line)
      : d.eid
    let tries = b.kind == 'outbox'
      ? yak.outbox.tries().filter((t) => t.subject == b.line)
      : []
    // What its window prints: what came back, or the letter's tries.
    let out = b.kind == 'outbox'
      ? tries.map((t) => `${since(t, tries[0])}  ${fate(t)}`)
      : d.out
    let row = eid ? find(eid) : undefined
    return [{ b, d, i, eid, out, row }]
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
    ? wire(layout, beats.length, last.i, last.eid)
    : undefined
  let desk = layout && {
    width: DESK.column + DESK.space + layout.width,
    height: layout.height,
  }
  // The letter the open outbox window follows, once it was sent.
  let sent = last?.b.kind == 'outbox' ? letter(last.b.line) : undefined
  let declared = (last?.b.shows ?? []).flatMap((name) => {
    let d = yak.declared(name)
    return d?.def ? [{ name, from: d.from, def: d.def }] : []
  })
  return h('section', { class: 'Band Doors', 'data-eid': key }, [
    h('div', { class: 'Doors_Text' }, [
      h('div', { class: 'Band_Text' }, [
        h('h2', null, words(text(e, 'doc', 'title'))),
        h(Prose, { source: head }),
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
            h('b', null, words(b.title)),
            h(Prose, { source: b.prose }),
            b.kind == 'outbox'
              ? null
              : h('code', null, (SIGNS[b.kind] ?? '') + b.line),
          ])
        ),
      ),
    ]),
    h('figure', { class: 'Doors_Figure', ref: figure }, [
      h('div', {
        class: 'Doors_Desk',
        style: desk
          ? `--desk: ${desk.width} / ${desk.height}; --drawing: ${
            layout!.width
          } / ${layout!.height}; --column: ${
            DESK.column / desk.width * 100
          }%; --sheet: ${
            layout!.width / desk.width * 100
          }%; --slots: ${beats.length}; --gap: ${DESK.gap / desk.height * 100}%`
          : undefined,
      }, [
        h('div', { class: 'Doors_Sheet' }, [
          h('div', { class: 'Doors_Drawing', ref: sheet }),
        ]),
        path
          ? h('svg', {
            class: 'Doors_Wire',
            viewBox: `0 0 ${desk!.width} ${desk!.height}`,
            'aria-hidden': 'true',
          }, h('path', { d: path, key: path, pathLength: 1 }))
          : null,
        h(
          'div',
          { class: 'Windows' },
          open.map(({ b, d, i, out, row }) =>
            h(Look, {
              kind: b.kind,
              line: b.line,
              out,
              fault: d.fault,
              row,
              find,
              id: short,
              class: i == last?.i ? 'is-last' : undefined,
              style: `--slot: ${i + 1}`,
              key: i,
            })
          ),
        ),
      ]),
      declared.length
        ? h('div', { class: 'Declares' }, declared.map((d) => h(Declared, d)))
        : null,
      h('figcaption', null, [
        h('span', { class: 'No' }, no),
        ...words(caption),
      ]),
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

export let Memory = band({
  query: MAILED,
  no: 'Fig. 5',
  caption:
    'The graph drawn above. The last window is what a new session wearing your agent’s persona is given.',
})

export let Rules = band({
  query: MAILED,
  no: 'Fig. 4',
  caption:
    'The graph drawn above, with its letters. Under it, the rule or effect each turn ran, as its vocabulary declares it.',
})
