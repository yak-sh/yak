// The views every entity has, whatever it is made of: a `Tile` that stands for
// it in a list, a `Page` that shows it whole, the `Facts` its components state,
// and a `Comment` for an entity aimed at another. Portable @yaks/render
// renderers — they build with the caller's `h`, so a terminal prints them
// through @yaks/text and a browser mounts them through @yaks/preact.
//
// Inline parts are separated by a space of their own: a browser lays them out
// with CSS and ignores it, and a terminal has nothing else to go by.
//
// Every match here is the catch-all (`true`) or one component, so a package
// that knows its own components better wins by specificity: @yaks/doc's
// `Title` and `Body`, @yaks/task's `Status`. A view nobody registered renders
// nothing, which is how a page with no body shows no body.
//
// What a view cannot know from one bundle arrives in the context, as a
// {@link Shown}: how an id reads, where a link goes, what a referenced entity
// is called, how a time reads — and the other entities a page gathers (its
// relations and its comments), drawn through `show` so they go through the
// same registry as everything else.

import type { Bundle } from '@yaks/graph'
import { parse } from '@yaks/query'
import {
  type Child,
  define,
  type H,
  type Registry,
  type RenderContext,
} from '@yaks/render'

/** One group of related entities on a page: `requires`, `requires this`. */
export type Related = { title: string; items: Bundle[] }

/** What the caller supplies so a view can show an entity among others. */
export type Shown<Node> = {
  /** the id a person reads: `T-9` */
  id: (b: Bundle) => string
  /** the kind it displays as: `task` */
  kind: (b: Bundle) => string
  /** what to call an entity a property names, by eid */
  name: (eid: string) => string
  /** where a link to an entity goes, by eid; absent where nothing links */
  link?: (eid: string) => string | undefined
  /** how a moment reads */
  when: (at: string) => string
  /** another entity, drawn through the same registry */
  show: (b: Bundle, view: string) => Node | null
  /** the relation an edge states: `contains` */
  relation?: (b: Bundle) => string | undefined
  /** the groups of entities related to this one, for `Page` */
  relations?: Related[]
  /** the comments aimed at this one, oldest first, for `Page` */
  comments?: Bundle[]
}

type Ctx<Node> = RenderContext<Node> & Shown<Node>

// The context a renderer is handed carries the caller's fields unchecked; this
// is where they are read back as what the caller promised.
let shown = <Node>(ctx: RenderContext<Node>) => ctx as Ctx<Node>

// Components a page states elsewhere, and the edge an entity may itself be.
let SHOWN = new Set(['entity', 'doc', 'comment', 'edge'])
let EID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
let AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

// One stated value: an entity named by a property is a link to it, a moment
// reads as the caller says, and anything structured is its JSON.
let value = <Node>(h: H<Node>, s: Ctx<Node>, v: unknown): Child<Node> => {
  if (typeof v == 'string' && EID.test(v)) {
    let href = s.link?.(v)
    return href ? h('a', { href }, s.name(v)) : s.name(v)
  }
  if (typeof v == 'string' && AT.test(v)) {
    return h('time', { datetime: v }, s.when(v))
  }
  return v && typeof v == 'object' ? JSON.stringify(v) : String(v)
}

let section = <Node>(h: H<Node>, title: string, ...kids: Child<Node>[]) =>
  h(
    'section',
    { class: 'Section' },
    h('h2', { class: 'Section_Title' }, title),
    ...kids,
  )

// An entity with no title of its own is called by its id — except beside its
// id in a `Tile`, where it is called by its kind rather than by its id twice.
let title = <Node>(b: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node =>
  h('span', null, ctx.in == 'Tile' ? shown(ctx).kind(b) : shown(ctx).id(b))

// An edge is titled by the sentence it states: `T-1 requires T-2`.
let sentence = <Node>(
  b: Bundle,
  h: H<Node>,
  ctx: RenderContext<Node>,
): Node => {
  let s = shown(ctx)
  let { from, to } = b.edge as { from?: string; to?: string }
  return h(
    'span',
    null,
    from ? value(h, s, from) : '?',
    ' ',
    s.relation?.(b) ?? s.kind(b),
    ' ',
    to ? value(h, s, to) : '?',
  )
}

let tile = <Node>(b: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = shown(ctx)
  return h(
    'a',
    { class: 'Tile', href: s.link?.(b.entity.eid) },
    h('span', { class: 'Tile_Id' }, s.id(b)),
    ' ',
    h('span', { class: 'Tile_Title' }, ctx.render?.('Title', { in: 'Tile' })),
    ' ',
    ctx.render?.('Status'),
  )
}

// Each component the page does not state elsewhere, one row each: its name,
// then its properties with a value. A component with no properties is a mark,
// and
// its row says only that it is there.
let facts = <Node>(b: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = shown(ctx)
  let rows = Object.entries(b)
    .filter(([name, comp]) =>
      !SHOWN.has(name) && !name.startsWith('$') && !!comp &&
      typeof comp == 'object'
    )
    .map(([name, comp]) => {
      let props = Object.entries(comp as Record<string, unknown>)
        .filter(([, v]) => v != null && v !== '')
      return [
        h('dt', null, name),
        h(
          'dd',
          null,
          props.length
            ? props.map(([prop, v], i) => [
              i ? ' · ' : '',
              h('span', { class: 'Facts_Prop' }, prop),
              ' ',
              value(h, s, v),
            ])
            : '✓',
        ),
      ]
    })
  return h('dl', { class: 'Facts' }, rows)
}

let comment = <Node>(b: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = shown(ctx)
  let made = (b.created ?? {}) as { by?: string; at?: string }
  return h(
    'article',
    { class: 'Comment', id: s.id(b) },
    h(
      'header',
      { class: 'Comment_Head' },
      made.by ? value(h, s, made.by) : 'someone',
      made.at ? [' · ', value(h, s, made.at)] : null,
    ),
    ctx.render?.('Body'),
  )
}

let page = <Node>(b: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = shown(ctx)
  let comments = s.comments ?? []
  let tiles = (items: Bundle[]) =>
    h(
      'ul',
      { class: 'Section_List' },
      items.map((i) => h('li', null, s.show(i, 'Tile'))),
    )
  return h(
    'article',
    { class: 'Page' },
    h(
      'header',
      { class: 'Page_Head' },
      h('span', { class: 'Page_Kind' }, s.kind(b)),
      ' ',
      h('span', { class: 'Page_Id' }, s.id(b)),
      ' ',
      ctx.render?.('Status'),
    ),
    h('h1', { class: 'Page_Title' }, ctx.render?.('Title')),
    h('div', { class: 'Page_Body' }, ctx.render?.('Body')),
    (s.relations ?? [])
      .filter((r) => r.items.length)
      .map((r) => section(h, r.title, tiles(r.items))),
    comments.length
      ? section(
        h,
        `${comments.length} comment${comments.length == 1 ? '' : 's'}`,
        comments.map((c) => s.show(c, 'Comment')),
      )
      : null,
    section(h, 'Details', ctx.render?.('Facts')),
  )
}

/** The views any entity has. Register a package's own views ahead of these. */
export let views: Registry = define([
  { view: 'Title', match: true, render: title },
  { view: 'Title', match: parse('.edge'), render: sentence },
  { view: 'Tile', match: true, render: tile },
  { view: 'Facts', match: true, render: facts },
  { view: 'Comment', match: parse('.comment'), render: comment },
  { view: 'Page', match: true, render: page },
])
