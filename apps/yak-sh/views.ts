// How the page draws itself from its graph: the site's layout is a column of
// panes, and each pane shows a section doc in the view it names. Every view
// reads the rows the graph last committed, so a write from the prompt redraws
// what it changed.
import { type ComponentChild, type FunctionComponent, h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { parse } from '@yaks/query/core'
import { define } from '@yaks/render'
import { Markdown } from '@yaks/markdown'
import { ink, mount, type Mounted, progress, type Tip } from '@yaks/diagram'
import type { Bundle } from '@yaks/graph'
import type { EntityProps } from '@yaks/preact'
import type { Yak } from './yak.ts'
import type { Line, Term } from './term.ts'
import { type Figure, into, PLACES, SHEET, WIDER } from './figure.ts'
import { INSTALL, proseOf, scriptOf } from './site.ts'
import { Copy, parts } from './parts.ts'
import { Doors, Stack } from './bands.ts'
import { text, useHeard, useTold } from './told.ts'
import { clicked, Editor, opener } from './editor.ts'
import { human } from '@yaks/id'

/** What every view is given beside its bundle. */
export type Ctx = {
  yak: Yak
  term: Term
  Entity: FunctionComponent<EntityProps>
  /** The drawing's query, and what the last write did. */
  figure: Figure
}

// ------------------------------------------------------------------ the page

let Page: FunctionComponent<Ctx & { e: Bundle }> = (ctx) => {
  let { yak, Entity } = ctx
  useTold((l) => yak.watch('*', l))
  let root = text(ctx.e, 'layout', 'root')
  let panes = yak.rows()
    .filter((b) => text(b, 'pane', 'parent') == root)
    .sort((a, b) =>
      Number(text(a, 'pane', 'order')) - Number(text(b, 'pane', 'order'))
    )
  // The hero and the steps after it share one story: the words on the left,
  // and the drawing and the prompt beside them.
  let parts: ComponentChild[] = [h(Nav, { key: 'nav' })]
  let story: { hero?: string; steps: string[] } | undefined
  let flush = () => {
    if (story) {
      parts.push(
        h(Story, { ...ctx, ...story, key: story.hero ?? story.steps[0] }),
      )
    }
    story = undefined
  }
  for (let p of panes) {
    let content = text(p, 'pane', 'content')
    let view = text(p, 'pane', 'view')
    if (view == 'Hero') {
      flush()
      story = { hero: content, steps: [] }
      continue
    }
    if (view == 'Step') {
      ;(story ??= { steps: [] }).steps.push(content)
      continue
    }
    flush()
    parts.push(h(Entity, { ...ctx, eid: content, view, key: content }))
  }
  flush()
  parts.push(h(Editor, { ...ctx, key: 'editor' }))
  return h('div', { class: 'Site' }, parts)
}

let Nav = () =>
  h('nav', { class: 'Nav' }, [
    h('a', { class: 'Nav_Mark', href: './' }, [
      h('span', { class: 'Nav_Dot' }),
      'yak.sh',
    ]),
    h('span', { class: 'Nav_Links' }, [
      h('a', { href: '#install' }, 'Install'),
      h('a', { href: '#yaks-app' }, 'yaks.app'),
      h('a', { href: 'https://jsr.io/@yaks' }, 'Packages'),
      h('a', { href: 'https://github.com/yak-sh/yak' }, 'GitHub'),
    ]),
  ])

let Hero: FunctionComponent<Ctx & { e: Bundle }> = ({ e }) =>
  h('header', { class: 'Hero', 'data-eid': e.entity.eid }, [
    h('p', { class: 'Kicker' }, [
      h('span', { class: 'Kicker_Dot' }),
      'yak and the @yaks packages · open source',
    ]),
    h('h1', null, text(e, 'doc', 'title')),
    h(
      'div',
      { class: 'Lead' },
      h(Markdown, { source: proseOf(text(e, 'doc', 'body')) }),
    ),
    h(Copy, { line: INSTALL }),
    h(
      'p',
      { class: 'Hint' },
      'Scroll, and each step below runs in the graph in this tab while the drawing beside it adds what it wrote.',
    ),
  ])

// ------------------------------------------------------------------ the story

/** What the story's parts share: each step's element, and the drawing's
 * painter, which the scroll calls. */
type Pen = {
  steps: (HTMLElement | null)[]
  paint?: () => void
}

let Story: FunctionComponent<Ctx & { hero?: string; steps: string[] }> = (
  ctx,
) => {
  let { yak, term, figure, Entity, hero, steps } = ctx
  let pen = useRef<Pen>({ steps: [] }).current
  let bodies = () =>
    steps.map((eid) => text(yak.row(eid) ?? { entity: { eid } }, 'doc', 'body'))
  // How far the reader is into each step, measured each frame they scroll:
  // a step's commands run once it is reached, and the drawing follows.
  useEffect(() => {
    if (typeof requestAnimationFrame == 'undefined') return
    let frame = 0
    let measure = () => {
      frame = 0
      let p = pen.steps.map((el) => {
        if (!el) return 0
        let r = el.getBoundingClientRect()
        return into(r.top, r.height, innerHeight)
      })
      figure.scroll(p)
      pen.steps.forEach((el, i) => el?.classList.toggle('is-on', p[i] > 0))
      term.reach(bodies(), p.reduce((k, x, i) => x > 0 ? i + 1 : k, 0))
      pen.paint?.()
    }
    let soon = () => frame ||= requestAnimationFrame(measure)
    addEventListener('scroll', soon, { passive: true })
    addEventListener('resize', soon)
    soon()
    return () => {
      removeEventListener('scroll', soon)
      removeEventListener('resize', soon)
      cancelAnimationFrame(frame)
    }
  }, [steps.join()])
  return h('section', { class: 'Plot' }, [
    h('div', { class: 'Plot_Words' }, [
      hero ? h(Entity, { ...ctx, eid: hero, view: 'Hero', key: hero }) : null,
      h(
        'ol',
        { class: 'Steps' },
        steps.map((eid, i) =>
          h(Entity, {
            ...ctx,
            eid,
            view: 'Step',
            key: eid,
            n: i + 1,
            at: (el: HTMLElement | null) => void (pen.steps[i] = el),
          })
        ),
      ),
    ]),
    h('div', { class: 'Plot_Side' }, [
      h(Figure, { ...ctx, pen }),
      h(Prompt, ctx),
    ]),
  ])
}

let Step: FunctionComponent<
  Ctx & { e: Bundle; n: number; at: (el: HTMLElement | null) => void }
> = ({ e, n, at }) => {
  let body = text(e, 'doc', 'body')
  let { sh, mcp } = scriptOf(body)
  return h('li', { class: 'Step', ref: at, 'data-eid': e.entity.eid }, [
    h('span', { class: 'Step_No' }, String(n)),
    h('h2', null, text(e, 'doc', 'title')),
    h(Markdown, { source: proseOf(body) }),
    h('ul', { class: 'Step_Lines' }, [
      ...sh.map((line) => h('li', null, h('code', null, line))),
      ...mcp.map(({ tool, args }) =>
        h(
          'li',
          { class: 'is-agent' },
          h('code', null, `${tool} ${JSON.stringify(args)}`),
        )
      ),
    ]),
  ])
}

let sign: Record<Line['kind'], string> = {
  in: '$ ',
  agent: 'agent ▸ ',
  out: '',
  fault: '',
}

// A printed line with each short id the graph knows as a button that opens
// that entity.
let linked = (
  line: string,
  ids: Map<string, string>,
  open: (eid: string) => void,
) =>
  line.split(/\b([A-Z]+-\d+)\b/).map((part, i) => {
    let eid = i % 2 ? ids.get(part) : undefined
    return eid
      ? h('button', {
        type: 'button',
        class: 'Prompt_Id',
        onClick: () => open(eid),
      }, part)
      : part
  })

let Prompt: FunctionComponent<Ctx> = (ctx) => {
  let { term, yak } = ctx
  useTold(term.listen)
  let id = human(yak.vocab)
  let ids = new Map(
    yak.rows().filter((b) => b.entity.num != null)
      .map((b) => [id(b), b.entity.eid]),
  )
  let open = opener(ctx)
  let [line, set] = useState('')
  // Where the arrows have walked to in the history: its length is the line
  // being written.
  let back = useRef(0)
  let screen = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let el = screen.current
    if (el) el.scrollTop = el.scrollHeight
  })
  let walk = (by: number) => {
    let past = term.history()
    back.current = Math.max(0, Math.min(past.length, back.current + by))
    set(past[back.current] ?? '')
  }
  return h('div', { class: 'Prompt' }, [
    h('div', { class: 'Prompt_Bar' }, [
      h('i', null),
      h('i', null),
      h('i', null),
      h('span', null, 'yak, in this tab'),
    ]),
    h('div', { class: 'Prompt_Screen', ref: screen }, [
      ...term.lines().map((l) =>
        h('div', { class: `Prompt_Line is-${l.kind}` }, [
          h('span', { class: 'Prompt_Sign' }, sign[l.kind]),
          ...(l.kind == 'in' ? [l.text] : linked(l.text, ids, open)),
        ])
      ),
      term.typing()
        ? h('div', { class: 'Prompt_Line is-in' }, [
          h('span', { class: 'Prompt_Sign' }, '$ '),
          term.typing(),
          h('b', { class: 'Caret' }),
        ])
        : null,
    ]),
    h('form', {
      class: 'Prompt_Form',
      onSubmit: (ev: Event) => {
        ev.preventDefault()
        if (!line.trim()) return
        term.enter(line)
        back.current = term.history().length + 1
        set('')
      },
    }, [
      h('span', { class: 'Prompt_Sign' }, '$ yak '),
      h('input', {
        value: line,
        'aria-label': 'Type a yak command',
        placeholder: "task new 'Book the band'",
        autocomplete: 'off',
        spellcheck: false,
        onInput: (ev: Event) =>
          set((ev.currentTarget as HTMLInputElement).value),
        onKeyDown: (ev: KeyboardEvent) => {
          if (ev.key != 'ArrowUp' && ev.key != 'ArrowDown') return
          ev.preventDefault()
          walk(ev.key == 'ArrowUp' ? -1 : 1)
        },
      }),
    ]),
  ])
}

// The leader: a line from the step being drawn to the pen drawing it, across
// the gutter between them, in the window's own coordinates.
let lead = (
  from: HTMLElement,
  to: { x: number; y: number },
  gutter: number,
) => {
  let bubble = (from.querySelector('.Step_No') ?? from).getBoundingClientRect()
  let side = from.getBoundingClientRect()
  if (matchMedia('(max-width: 899px)').matches) {
    let sx = bubble.left + bubble.width / 2, sy = bubble.top - 4
    let mid = Math.max(gutter + 10, Math.min(sy - 12, gutter + 24))
    return { d: `M${sx},${sy}V${mid}H${to.x}V${to.y}`, sx, sy }
  }
  let sx = side.right + 10, sy = bubble.top + bubble.height / 2
  let gx = Math.max(sx + 8, gutter - 16)
  return { d: `M${sx},${sy}H${gx}V${to.y}H${to.x}`, sx, sy }
}

let Figure: FunctionComponent<Ctx & { pen: Pen }> = (ctx) => {
  let { yak, term, figure, pen } = ctx
  useTold((l) => yak.watch('*', l))
  let sheet = useRef<HTMLDivElement>(null)
  let leader = useRef<SVGSVGElement>(null)
  let drawing = useRef<Mounted>()
  let [asked, setAsked] = useState(figure.query())
  let [fault, setFault] = useState('')
  useEffect(() => {
    let el = sheet.current
    if (!el) return
    let frame = 0
    // Ink the drawing as far as the reader has come, point the leader from
    // the step to the pen, and keep going while a stage draws itself in.
    let paint = () => {
      frame = 0
      let layout = drawing.current?.layout
      let svg = el.querySelector('svg')
      if (!layout || !svg) return
      let now = performance.now()
      let at = ink(
        svg as never,
        layout,
        progress(layout, (s) => figure.reached(s, now)),
      )
      el.classList.toggle('is-started', figure.into(1) > 0)
      point(svg, at)
      if (figure.busy(now) && typeof requestAnimationFrame != 'undefined') {
        frame ||= requestAnimationFrame(paint)
      }
    }
    let point = (svg: SVGSVGElement, at: Tip | undefined) => {
      let line = leader.current
      let step = at && pen.steps[at.stage - 1]
      let m = svg.getScreenCTM?.()
      if (!line || !step || !m || !at) return line?.classList.remove('is-on')
      let to = { x: m.a * at.x + m.e, y: m.d * at.y + m.f }
      let box = svg.getBoundingClientRect()
      let gutter = matchMedia('(max-width: 899px)').matches
        ? box.bottom
        : box.left
      let { d, sx, sy } = lead(step, to, gutter)
      line.querySelector('path')?.setAttribute('d', d)
      let dot = line.querySelector('circle')
      dot?.setAttribute('cx', String(sx))
      dot?.setAttribute('cy', String(sy))
      line.classList.add('is-on')
    }
    pen.paint = paint
    let m = mount(el, {
      graph: yak.graph,
      query: figure.query(),
      ...SHEET,
      stage: term.stage,
      at: ({ label }) => PLACES[label],
      title: 'The graph in this tab',
      drawn: (layout) => {
        figure.saw(layout, performance.now())
        paint()
      },
    })
    drawing.current = m
    return () => {
      m.stop()
      if (frame) cancelAnimationFrame(frame)
      pen.paint = undefined
    }
  }, [])
  // An entity clicked in the drawing, or chosen with Enter, opens.
  useHeard(sheet, ['click', 'keydown'], (ev) => {
    let eid = sheet.current && clicked(ev, sheet.current)
    let key = (ev as KeyboardEvent).key
    if (!eid || ev.type == 'keydown' && key != 'Enter' && key != ' ') return
    ev.preventDefault()
    opener(ctx)(eid)
  })
  let ask = (q: string) => {
    setAsked(q)
    drawing.current?.query(q, figure.ask(q)).then(() => setFault('')).catch((
      e,
    ) => setFault(e.message))
  }
  return h('figure', { class: 'Figure' }, [
    h('div', { class: 'Figure_Bar' }, [
      h('span', null, [h('b', null, 'fig. 1'), ' · the graph in this tab']),
      h('span', { class: 'Figure_State' }, `${yak.rows().length} entities`),
    ]),
    h('div', { class: 'Figure_Sheet', ref: sheet }),
    h(
      'p',
      { class: 'Figure_Hint' },
      'Scroll down: each command runs in this tab, and the pen draws what it writes.',
    ),
    h('form', {
      class: 'Figure_Query',
      onSubmit: (ev: Event) => {
        ev.preventDefault()
        ask(asked)
      },
    }, [
      h('label', null, 'Showing'),
      h('input', {
        value: asked,
        'aria-label': 'The query the drawing shows',
        spellcheck: false,
        onInput: (ev: Event) =>
          setAsked((ev.currentTarget as HTMLInputElement).value),
      }),
    ]),
    h(
      'p',
      { class: 'Figure_Wider' },
      WIDER.map(([name, q]) =>
        h('button', {
          type: 'button',
          class: q == asked ? 'is-on' : '',
          onClick: () => ask(q),
        }, name)
      ),
    ),
    fault ? h('p', { class: 'Figure_Fault' }, fault) : null,
    h('svg', { class: 'Leader', ref: leader, 'aria-hidden': 'true' }, [
      h('path', { class: 'Leader_Line' }),
      h('circle', { class: 'Leader_Dot', r: 3 }),
    ]),
  ])
}

// ------------------------------------------------------------------ the end

let doc = parse('.doc')
export let views = define([
  { view: 'Page', match: parse('.layout'), Render: Page },
  { view: 'Hero', match: doc, Render: Hero },
  { view: 'Step', match: doc, Render: Step },
  { view: 'Stack', match: doc, Render: Stack },
  { view: 'Doors', match: doc, Render: Doors },
  ...parts.map((p) => ({ ...p, match: doc })),
] as never)
