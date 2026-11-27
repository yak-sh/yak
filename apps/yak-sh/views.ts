// How the page draws itself from its graph: the site's layout is a column of
// panes, and each pane shows a section doc in the view it names. Every view
// reads the rows the graph last committed, so a write from the prompt redraws
// what it changed.
import {
  createElement as h,
  type FunctionComponent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { parse } from '@yaks/query/core'
import { define } from '@yaks/render'
import { Prose, words } from './prose.ts'
import {
  ink,
  mount,
  type Mounted,
  progress,
  type Tip,
  zoom,
  zoomed,
} from '@yaks/diagram'
import type { Bundle } from '@yaks/graph'
import type { EntityProps } from '@yaks/react'
import type { Yak } from './yak.ts'
import type { Line, Term } from './term.ts'
import { type Figure, SHEET, WIDER } from './figure.ts'
import { INSTALL, proseOf, scriptOf, shown } from './site.ts'
import { Logo } from './idle.ts'
import { Copy, parts } from './parts.ts'
import { Stack } from './bands.ts'
import { Setup } from './setup.ts'
import { Doors, Memory, Rules } from './doors.ts'
import type { Turns } from './turns.ts'
import { BUFFER, played, text, useHeard, useTold } from './told.ts'
import { clicked, Editor, opener } from './editor.ts'
import { human } from '@yaks/id'

/** What every view is given beside its bundle. */
export type Ctx = {
  yak: Yak
  term: Term
  Entity: FunctionComponent<EntityProps>
  /** The drawing's query, and what the last write did. */
  figure: Figure
  /** Each interface's turn in the doors band. */
  turns: Turns
}

// ------------------------------------------------------------------ the page

let Page: FunctionComponent<Ctx & { e: Bundle }> = (ctx) => {
  let { yak, Entity } = ctx
  useTold((l) => yak.watch('*', l))
  useEffect(() => {
    let viewport = globalThis.visualViewport
    let focused = () => {
      if (!viewport || viewport.scale != 1) return
      let el = document.activeElement
      if (!el?.matches('input, textarea')) return
      let box = el.getBoundingClientRect()
      if (box.bottom > viewport.offsetTop + viewport.height - 8) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }
    viewport?.addEventListener('resize', focused)
    return () => viewport?.removeEventListener('resize', focused)
  }, [])
  let root = text(ctx.e, 'layout', 'root')
  let panes = yak.rows()
    .filter((b) => text(b, 'pane', 'parent') == root)
    .sort((a, b) =>
      Number(text(a, 'pane', 'order')) - Number(text(b, 'pane', 'order'))
    )
  // The hero and the steps after it share one story: the words on the left,
  // and the drawing and the prompt beside them.
  let parts: ReactNode[] = [h(Nav, { key: 'nav' })]
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
  return h('div', { className: 'Site' }, parts)
}

let Nav = () =>
  h('nav', { className: 'Nav' }, [
    h('a', { className: 'Nav_Mark Nav_Link', href: './' }, [
      h(Logo, {
        className: 'Nav_Logo',
        sizes: '(max-width: 480px) 72px, 15vw',
        width: 200,
        height: 200,
      }),
      'yak.sh',
    ]),
    h('span', { className: 'Nav_Links' }, [
      h('a', { className: 'Nav_Link', href: '#install' }, 'Install'),
      h('a', { className: 'Nav_Link', href: '#yaks-app' }, 'Hosting'),
      ...words('yaks.app', 'Nav_Link'),
      h(
        'a',
        { className: 'Nav_Link', href: 'https://jsr.io/@yaks' },
        'Packages',
      ),
      h(
        'a',
        { className: 'Nav_Link', href: 'https://github.com/yak-sh/yak' },
        'GitHub',
      ),
    ]),
  ])

let Hero: FunctionComponent<Ctx & { e: Bundle }> = ({ e }) =>
  h('header', { className: 'Hero', 'data-eid': e.entity.eid }, [
    h('p', { className: 'Kicker' }, [
      h('span', { className: 'Kicker_Dot' }),
      'yak and the @yaks packages · open source',
    ]),
    h('h1', null, words(text(e, 'doc', 'title'))),
    h(
      'div',
      { className: 'Lead' },
      h(Prose, { source: proseOf(text(e, 'doc', 'body')) }),
    ),
    h(Copy, { line: INSTALL }),
    h(
      'p',
      { className: 'Hint' },
      'Scroll to run each step in this tab and see what it adds to the graph.',
    ),
  ])

// ------------------------------------------------------------------ the story

/** What the story's parts share: each step's element, the drawing and
 * prompt beside them, and the drawing's painter, which the scroll calls. */
type Pen = {
  steps: (HTMLElement | null)[]
  side?: HTMLElement | null
  paint?: () => void
}

let narrow = '(max-width: 899px)'
let panels = ['Graph', 'Terminal', 'Query'] as const

let Story: FunctionComponent<Ctx & { hero?: string; steps: string[] }> = (
  ctx,
) => {
  let { yak, term, figure, Entity, hero, steps } = ctx
  let pen = useRef<Pen>({ steps: [] }).current
  let [panel, show] = useState<typeof panels[number]>('Graph')
  let bodies = () =>
    steps.map((eid) => text(yak.row(eid) ?? { entity: { eid } }, 'doc', 'body'))
  // How far the reader has played each command, measured each frame they
  // scroll: the commands share out the scrolling (told.ts `allot`), each
  // runs as its share starts, and is typed while what it wrote draws in.
  useEffect(() => {
    if (typeof requestAnimationFrame == 'undefined') return
    let frame = 0
    let measure = () => {
      frame = 0
      let lines = pen.steps.map((el) => [
        ...el?.querySelectorAll('.Step_Lines > li') ?? [],
      ])
      let p = played(
        lines.flat().map((li) => li.getBoundingClientRect().top),
        innerHeight,
        covered(pen.side),
      )
      figure.scroll(p)
      term.scroll(p)
      let from = 0
      let started = lines.map((l) =>
        p.slice(from, from += l.length).filter((x) => x > 0).length
      )
      pen.steps.forEach((el, i) =>
        el?.classList.toggle('is-on', started[i] > 0)
      )
      let n = started.findLastIndex((m) => m > 0) + 1
      term.reach(bodies(), n, started[n - 1])
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
  return h('section', { className: 'Plot' }, [
    h('div', { className: 'Plot_Words' }, [
      hero ? h(Entity, { ...ctx, eid: hero, view: 'Hero', key: hero }) : null,
      h(
        'ol',
        { className: 'Steps' },
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
    h('div', {
      className: 'Plot_Side',
      'data-panel': panel,
      ref: (el: HTMLElement | null) => void (pen.side = el),
    }, [
      h(
        'div',
        { className: 'Plot_Panels', role: 'group', 'aria-label': 'Live demo' },
        panels.map((name) =>
          h('button', {
            className: 'Plot_Panel',
            type: 'button',
            'data-panel': name,
            'aria-pressed': panel == name,
            onClick: () => show(name),
          }, name)
        ),
      ),
      h(Figure, {
        ...ctx,
        pen,
        shown: () => {
          show('Graph')
          pen.side?.querySelector<HTMLButtonElement>(
            '.Plot_Panel[data-panel="Graph"]',
          )
            ?.focus({ preventScroll: true })
        },
      }),
      h(Prompt, ctx),
    ]),
  ])
}

// Where a command's stretch ends, stacked: the drawing and the prompt sit
// over the top of the window, so a command is live below them; side by
// side, the whole window less its buffer.
let covered = (side?: HTMLElement | null) => {
  if (!side || !matchMedia(narrow).matches) return undefined
  let below = side.getBoundingClientRect().bottom + innerHeight * BUFFER
  return Math.min(below, innerHeight * .8)
}

let Step: FunctionComponent<
  Ctx & { e: Bundle; n: number; at: (el: HTMLElement | null) => void }
> = ({ e, n, at }) => {
  let body = text(e, 'doc', 'body')
  return h('li', { className: 'Step', ref: at, 'data-eid': e.entity.eid }, [
    h('span', { className: 'Step_No' }, String(n)),
    h('h2', { className: 'Step_Title' }, words(text(e, 'doc', 'title'))),
    h(Prose, { source: proseOf(body) }),
    h(
      'ul',
      { className: 'Step_Lines' },
      scriptOf(body).map((c) =>
        h('li', {
          className: [c.kind == 'mcp' ? 'is-agent' : undefined, 'Step_Line']
            .filter(
              Boolean,
            ).join(' '),
        }, [
          c.note ? h('span', { className: 'Step_Note' }, `# ${c.note}`) : null,
          h('code', { className: 'Step_Command' }, shown(c)),
        ])
      ),
    ),
  ])
}

let sign: Record<Line['kind'], string> = {
  in: '$ ',
  agent: 'agent → ',
  out: '',
  fault: '',
  note: '',
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
        className: 'Prompt_Id',
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
  let follow = useRef(true)
  let lines = term.lines()
  let typing = term.typing()
  useLayoutEffect(() => {
    let el = screen.current
    if (el && follow.current) el.scrollTop = el.scrollHeight
  }, [lines.length, typing])
  useLayoutEffect(() => {
    let el = screen.current
    let opened = () => {
      if (el && follow.current) el.scrollTop = el.scrollHeight
    }
    if (!el || typeof ResizeObserver == 'undefined') return
    let observer = new ResizeObserver(opened)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  let walk = (by: number) => {
    let past = term.history()
    back.current = Math.max(0, Math.min(past.length, back.current + by))
    set(past[back.current] ?? '')
  }
  return h('div', { className: 'Prompt' }, [
    h('div', { className: 'Prompt_Bar' }, [
      h('i', { className: 'Prompt_Dot' }),
      h('i', { className: 'Prompt_Dot' }),
      h('i', { className: 'Prompt_Dot' }),
      h('span', { className: 'Prompt_Title' }, 'yak, in this tab'),
    ]),
    h('div', {
      className: 'Prompt_Screen',
      ref: screen,
      onScroll: (ev: Event) => {
        let el = ev.currentTarget as HTMLDivElement
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4
      },
    }, [
      ...lines.map((l) =>
        h('div', { className: `Prompt_Line is-${l.kind}` }, [
          h('span', { className: 'Prompt_Sign' }, sign[l.kind]),
          ...(l.kind == 'in' ? [l.text] : linked(l.text, ids, open)),
        ])
      ),
      typing
        ? h('div', { className: 'Prompt_Line is-in' }, [
          h('span', { className: 'Prompt_Sign' }, '$ '),
          typing,
          h('b', { className: 'Caret' }),
        ])
        : null,
    ]),
    h('form', {
      className: 'Prompt_Form',
      onSubmit: (ev: Event) => {
        ev.preventDefault()
        if (!line.trim()) return
        follow.current = true
        term.enter(line)
        back.current = term.history().length + 1
        set('')
      },
    }, [
      h('span', { className: 'Prompt_Sign' }, '$ yak '),
      h('input', {
        className: 'Prompt_Input',
        value: line,
        'aria-label': 'Type a yak command',
        placeholder: 'Type a command',
        autocomplete: 'off',
        autocapitalize: 'none',
        enterKeyHint: 'go',
        spellCheck: false,
        onInput: (ev: Event) =>
          set((ev.currentTarget as HTMLInputElement).value),
        onKeyDown: (ev: KeyboardEvent) => {
          if (ev.key != 'ArrowUp' && ev.key != 'ArrowDown') return
          ev.preventDefault()
          walk(ev.key == 'ArrowUp' ? -1 : 1)
        },
      }),
      h('button', { className: 'Prompt_Run', type: 'submit' }, 'Run'),
    ]),
  ])
}

// Where an element's words end on the page: the last line they wrap to.
let ending = (el: Element) => {
  let range = el.ownerDocument.createRange()
  range.selectNodeContents(el)
  let rects = range.getClientRects()
  return rects[rects.length - 1] ?? el.getBoundingClientRect()
}

// The leader: a line from the command whose write the pen is drawing to the
// pen, across the gutter between them, in the window's own coordinates.
let lead = (
  from: Element,
  to: { x: number; y: number },
  gutter: number,
) => {
  let end = ending(from)
  let sx = end.right + 8, sy = end.top + end.height / 2
  let gx = Math.max(sx + 8, gutter - 16)
  return { d: `M${sx},${sy}H${gx}V${to.y}H${to.x}`, sx, sy }
}

let Figure: FunctionComponent<Ctx & { pen: Pen; shown: () => void }> = (
  ctx,
) => {
  let { yak, term, figure, pen } = ctx
  useTold((l) => yak.watch('*', l))
  let sheet = useRef<HTMLDivElement>(null)
  let leader = useRef<SVGSVGElement>(null)
  let drawing = useRef<Mounted>()
  let [asked, setAsked] = useState(figure.query())
  let [fault, setFault] = useState('')
  let [closer, setCloser] = useState(false)
  useEffect(() => {
    let el = sheet.current
    if (!el) return
    let frame = 0
    // Ink the drawing as far as the reader has come, point the leader from
    // the command to the pen, and keep going while a stage draws itself in.
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
      point(svg, at)
      if (figure.busy(now) && typeof requestAnimationFrame != 'undefined') {
        frame ||= requestAnimationFrame(paint)
      }
    }
    // The leader runs from the command that made what the pen is drawing,
    // which is lit while it does.
    let point = (svg: SVGSVGElement, at: Tip | undefined) => {
      let line = leader.current
      let made = at && figure.madeBy(at.key)
      let step = made && pen.steps[made.step - 1]
      let said = made && step?.querySelectorAll('.Step_Lines > li')[made.line]
      for (let lit of svg.ownerDocument.querySelectorAll('.is-led')) {
        if (lit != said) lit.classList.remove('is-led')
      }
      let words = said?.querySelector('code')
      if (words) said!.classList.add('is-led')
      if (globalThis.matchMedia?.(narrow).matches) {
        return line?.classList.remove('is-on')
      }
      let m = svg.getScreenCTM?.()
      if (!line || !step || !words || !m || !at) {
        return line?.classList.remove('is-on')
      }
      let to = { x: m.a * at.x + m.e, y: m.d * at.y + m.f }
      let box = svg.getBoundingClientRect()
      let { d, sx, sy } = lead(words, to, box.left)
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
      ...globalThis.matchMedia?.(narrow).matches
        ? { width: 520, height: 260 }
        : {},
      stage: term.stage,
      title: 'The graph in this tab',
      // The leader follows what the reader zoomed or panned to.
      viewed: (view) => {
        let layout = drawing.current?.layout
        setCloser(!!layout && zoomed(layout, view))
        paint()
      },
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
    drawing.current?.query(q, figure.ask(q)).then(() => {
      setFault('')
      ctx.shown()
    }).catch((e) => setFault(e.message))
  }
  let scale = (by: number) => {
    let m = drawing.current
    if (!m?.layout || !m.view) return
    m.show(zoom(m.layout, m.view, by, [.5, .5]))
  }
  return h('figure', { className: 'Figure' }, [
    h('div', { className: 'Figure_Bar' }, [
      h('span', { className: 'Figure_Head' }, [
        h('b', { className: 'Figure_Label' }, 'fig. 1'),
        ' · the graph in this tab',
      ]),
      h('span', { className: 'Figure_State' }, `${yak.rows().length} entities`),
      h('div', { className: 'Figure_Zoom' }, [
        h('button', {
          type: 'button',
          className: 'Figure_Scale',
          'aria-label': 'Zoom out',
          disabled: !closer,
          onClick: () => scale(1 / 1.7),
        }, '−'),
        h('button', {
          type: 'button',
          className: 'Figure_Scale',
          'aria-label': 'Zoom in',
          onClick: () => scale(1.7),
        }, '+'),
      ]),
    ]),
    h('div', { className: 'Figure_Sheet', ref: sheet }),
    h('form', {
      className: 'Figure_Query',
      onSubmit: (ev: Event) => {
        ev.preventDefault()
        ask(asked)
      },
    }, [
      h('label', null, 'Showing'),
      h('input', {
        className: 'Figure_Input',
        value: asked,
        autocapitalize: 'none',
        autocomplete: 'off',
        enterKeyHint: 'go',
        'aria-label': 'The query the drawing shows',
        spellCheck: false,
        onInput: (ev: Event) =>
          setAsked((ev.currentTarget as HTMLInputElement).value),
      }),
      h('button', { className: 'Figure_Show', type: 'submit' }, 'Show'),
    ]),
    h(
      'p',
      { className: 'Figure_Wider' },
      WIDER.map(([name, q]) =>
        h('button', {
          type: 'button',
          className: [q == asked ? 'is-on' : '', 'Figure_Choice'].filter(
            Boolean,
          )
            .join(' '),
          onClick: () => ask(q),
        }, name)
      ),
    ),
    fault ? h('p', { className: 'Figure_Fault' }, fault) : null,
    h('svg', { className: 'Leader', ref: leader, 'aria-hidden': 'true' }, [
      h('path', { className: 'Leader_Line' }),
      h('circle', { className: 'Leader_Dot', r: 3 }),
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
  { view: 'Rules', match: doc, Render: Rules },
  { view: 'Memory', match: doc, Render: Memory },
  { view: 'Setup', match: doc, Render: Setup },
  ...parts.map((p) => ({ ...p, match: doc })),
] as never)
