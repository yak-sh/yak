// How a bug and an error read wherever one is drawn by name: its title, a row
// in a list, a link, a card's bar, and a lone one's page in a terminal. These
// are portable renderers through the host's hyperscript, so `yak bug list`
// prints the same rows a browser lists. A message reads as its headline; the
// whole of it is on the page (./inspect.ts), one press away.
import { parse } from '@yaks/query'
import { define, type H, type RenderContext } from '@yaks/render'
import type { Shown } from '@yaks/render/views'
import type { Bundle } from '@yaks/graph'
import { comp, type Frame, str } from './model.ts'
import { count, headline, moment, sha, thrown } from './brief.ts'
import { tags } from './spread.ts'
import { frameAt, openBugs, pip, said, standing, where } from './reading.ts'

export { occurrences, openBugs, relatedTraces } from './reading.ts'

/** The page a browsing app's sidebar offers: the open bugs, worst first. */
export let destinations = [
  { key: 'bugs', name: 'Bugs', icon: 'bug', query: openBugs },
]

type Ctx<Node> = RenderContext<Node> & Partial<Shown<Node>>
let shown = <Node>(ctx: RenderContext<Node>) => ctx as Ctx<Node>
let when = <Node>(s: Ctx<Node>, at: unknown) => s.when?.(str(at)) ?? str(at)

let line = <Node>(h: H<Node>, cls: string | undefined, text: string): Node =>
  h('span', { class: cls, title: text }, headline(text))

// A tile as the kit lays one out (packages/ui/Tile.ts): an icon beside its
// words, the title line (id, title, count) over a sub.
let tile = <Node>(
  h: H<Node>,
  href: string | undefined,
  parts: {
    icon?: Node
    line: (Node | string | null)[]
    sub?: (Node | string | null | undefined)[]
  },
): Node =>
  h(
    'a',
    { class: 'Tile', href },
    parts.icon ? [h('span', { class: 'Tile_Icon' }, parts.icon), ' '] : null,
    h(
      'span',
      { class: 'Tile_Text' },
      h('span', { class: 'Tile_Line' }, ...parts.line),
      parts.sub?.some(Boolean)
        ? [' ', h('span', { class: 'Tile_Sub' }, ...dotted(parts.sub))]
        : null,
    ),
  )

// What is there, a dot between each.
let dotted = <T>(parts: (T | string | null | undefined)[]): (T | string)[] =>
  parts.filter((p): p is T | string => !!p)
    .flatMap((p, i) => i ? [' · ', p] : [p])

let dot = <Node>(h: H<Node>, e: Bundle): Node =>
  h('span', {
    class: ['Dot', ...pip(e).map((m) => `Dot-${m}`)].join(' '),
    title: standing(e),
  })

let bugTile = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = shown(ctx), bug = comp(e, 'bug')
  return tile(h, s.link?.(e.entity.eid), {
    icon: dot(h, e),
    line: [
      h('span', { class: 'Tile_Id' }, s.id?.(e) ?? ''),
      ' ',
      line(h, 'Tile_Title', said(e)),
      ' ',
      h('span', { class: 'Tile_Count' }, count(Number(bug.hits ?? 0), 'hit')),
    ],
    sub: [
      where(e),
      bug.last ? `last ${when(s, bug.last)}` : '',
      bug.first ? `since ${when(s, bug.first)}` : '',
    ],
  })
}

let errorTile = <Node>(
  e: Bundle,
  h: H<Node>,
  ctx: RenderContext<Node>,
): Node => {
  let s = shown(ctx), error = comp(e, 'error')
  return tile(h, s.link?.(e.entity.eid), {
    line: [
      h('span', { class: 'Tile_Id' }, s.id?.(e) ?? ''),
      ' ',
      line(h, 'Tile_Title', said(e)),
    ],
    sub: [
      when(s, error.at),
      ...tags(e).map(([k, v]) => `${k} ${v}`),
      error.commit ? sha(str(error.commit)) : '',
    ],
  })
}

// An occurrence among its bug's others: when to the second, where it ran,
// and what it was running, since its message is its bug's.
let occurrence = <Node>(
  e: Bundle,
  h: H<Node>,
  ctx: RenderContext<Node>,
): Node => {
  let s = shown(ctx), error = comp(e, 'error'), d = comp(e, 'during')
  // A reference this host holds, by name; one it does not is only a hash.
  let ref = (k: string) => {
    let held = d[k] ? s.get?.(str(d[k])) : undefined
    return held ? s.show?.(held, 'Title') : null
  }
  let at = str(error.at)
  return tile(h, s.link?.(e.entity.eid), {
    line: [
      h('span', { class: 'Tile_Title', title: when(s, at) }, moment(at)),
      ' ',
      ref('process') ? h('span', { class: 'Tile_Note' }, ref('process')) : null,
      ' ',
      error.commit
        ? h(
          'span',
          { class: 'Tile_Kind', title: str(error.commit) },
          sha(str(error.commit)),
        )
        : null,
    ],
    sub: [ref('entity'), ...tags(e).map(([k, v]) => `${k} ${v}`)],
  })
}

let bar = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node =>
  h(
    'span',
    { class: 'CardTitle' },
    ctx.render?.('Id') ?? h('span', { class: 'Id' }, shown(ctx).id?.(e) ?? ''),
    ' ',
    line(h, 'CardTitle_Text', said(e)),
  )

let inline = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node =>
  h(
    'a',
    { href: shown(ctx).link?.(e.entity.eid), title: said(e) },
    headline(said(e)),
  )

// A lone bug or error in a terminal (`yak bug resolve B-7`): what it says,
// where, how often and since when. The browser's page is ./inspect.ts.
let page = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = shown(ctx), bug = comp(e, 'bug'), error = comp(e, 'error')
  let { type, message } = thrown(headline(said(e)))
  let facts = e.bug
    ? [
      standing(e),
      count(Number(bug.hits ?? 0), 'hit'),
      bug.last ? `last ${when(s, bug.last)}` : '',
      bug.first ? `since ${when(s, bug.first)}` : '',
    ]
    : [
      when(s, error.at),
      str(error.level),
      str(error.environment),
      error.commit ? sha(str(error.commit)) : '',
      ...tags(e).map(([k, v]) => `${k} ${v}`),
    ]
  let frames = (comp(e, 'exception').frames ?? []) as Frame[]
  return h(
    'article',
    null,
    h(
      'header',
      { class: 'Head' },
      h(
        'h1',
        { class: 'Head_Title' },
        message,
        ' ',
        h('span', { class: 'Head_Id' }, s.id?.(e) ?? ''),
        type ? [' ', h('span', { class: 'Head_Kind' }, type)] : null,
      ),
      e.bug ? h('p', { class: 'Head_Sub' }, where(e)) : null,
      h(
        'p',
        { class: 'Head_Facts' },
        facts.filter(Boolean).join(' · '),
      ),
    ),
    said(e) != headline(said(e))
      ? h('p', null, h('span', { class: 'Value Value-text' }, said(e)))
      : null,
    frames.length
      ? h(
        'ol',
        null,
        frames.map((f) =>
          h('li', null, f.app ? '● ' : '  ', h('code', null, frameAt(f)))
        ),
      )
      : null,
  )
}

/** Draws a bug or an error by name. */
export let views = define([
  {
    view: 'Title',
    match: parse('.bug .doc.title'),
    render: (e, h) => line(h, undefined, said(e)),
  },
  {
    view: 'Title',
    match: parse('.error'),
    render: (e, h) => line(h, undefined, said(e)),
  },
  ...['Tile', 'List.Tile'].flatMap((view) => [
    { view, match: parse('.bug'), render: bugTile },
    { view, match: parse('.error'), render: errorTile },
  ]),
  { view: 'Bug.List.Tile', match: parse('.error'), render: occurrence },
  ...['.bug', '.error'].flatMap((q) => [
    { view: 'Card.Title', match: parse(q), render: bar },
    { view: 'Inline', match: parse(q), render: inline },
    { view: 'Page', match: parse(q), render: page },
  ]),
])

export { inspectViews } from './inspect.ts'
