// The views every entity has, whatever it is made of: a `Tile` that stands for
// it in a list, a `Page` that shows it whole, the `Facts` its components state,
// and a `Comment` for an entity aimed at another. Portable @yaks/render
// renderers — they build with the caller's `h`, so a terminal prints them
// through @yaks/text or paints them through @yaks/tui (dressed by `sheet`, in a
// theme's colours), and a browser mounts them through @yaks/preact.
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
//
// A long text in a list is a passage (`passage`), not the text whole: a
// package that owns words (an entry's, a comment's, a document's content)
// registers its `Tile` with it.

import { parse } from '@yaks/query/core'
import { snippet } from '@yaks/graph/hit'
import {
  type Bundle,
  type Child,
  define,
  type H,
  type Registry,
  type RenderContext,
  type Renderer,
  type Rendering,
} from './mod.ts'

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
  /** a reference's complete bundle, when this host holds it */
  get?: (eid: string) => Bundle | undefined
  /** Entities pointing here through a relation, where the host holds its links. */
  related?: (eid: string, relation: string) => Bundle[]
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
    return s.show(s.get?.(v) ?? { entity: { eid: v } }, 'Reference.Inline')
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
  h(
    'span',
    null,
    ctx.in == 'Reference'
      ? shown(ctx).name(b.entity.eid)
      : ctx.in == 'Tile'
      ? shown(ctx).kind(b)
      : shown(ctx).id(b),
  )

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

let inline = <Node>(b: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node =>
  h(
    'a',
    { href: shown(ctx).link?.(b.entity.eid) },
    ctx.render?.('Title', { in: 'Reference' }),
  )

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

/** Where a passage reads its words, and what it says of them: the texts the
 * words may be in, the first that matches what was sought giving the passage;
 * the title, when the words are a document's own; what kind of words they
 * are, when not plain prose (`tool result`); and the entity they sit in, with
 * the word that says how (`in` a transcript, `on` what a comment is aimed
 * at). */
export type Said = {
  texts: (b: Bundle) => unknown[]
  title?: (b: Bundle) => unknown
  what?: (b: Bundle) => string | undefined
  where?: (b: Bundle) => [word: string, eid: string] | undefined
}

// Who made an entity and when, as its `created` says.
let made = (b: Bundle) => {
  let { by, at } = (b.created ?? {}) as { by?: unknown; at?: unknown }
  return {
    by: typeof by == 'string' && by ? by : undefined,
    at: typeof at == 'string' && at ? at : undefined,
  }
}

// The runs a snippet sets between \x01 and \x02, each a match.
let marks = <Node>(h: H<Node>, cut: string): Child<Node>[] =>
  cut.split('\x01').flatMap((chunk, i) => {
    if (!i) return chunk ? [chunk] : []
    let [found, rest = ''] = chunk.split('\x02')
    return [h('mark', { class: 'Match' }, found), ...rest ? [rest] : []]
  })

/**
 * A long text as one row of a list (@yaks/ui's `Passage`): a line saying who
 * said it, when and where, then the words around what was sought, every match
 * marked; with nothing sought, the words it opens with. What was sought is the
 * caller's `ctx.words`, the words of its query. The row names the entities it
 * mentions, so it asks its host for them (`needs`).
 *
 * ```ts
 * import { define } from '@yaks/render'
 * import { passage } from '@yaks/render/views'
 * import { parse } from '@yaks/query'
 * import { plain, tree } from '@yaks/text'
 * import { loadVocab } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 *
 * let said = passage({
 *   texts: (b) => [(b.note as { text?: string }).text],
 *   where: (b) => ['on', String((b.note as { on?: string }).on)],
 * })
 * let views = define([{ view: 'Tile', match: parse('.note'), ...said }])
 * let note = {
 *   entity: { eid: 'n1' },
 *   note: { text: 'Results are often miles long.', on: 't1' },
 *   created: { by: 'p1', at: '2026-10-23T18:26:21Z' },
 * }
 * let ctx = {
 *   name: (eid: string) => ({ p1: 'Jeff', t1: 'T-9' })[eid] ?? eid,
 *   when: () => '2 hours ago',
 *   words: ['miles'],
 * }
 * let vocab = loadVocab({
 *   $defs: {
 *     note: {
 *       component: true,
 *       properties: { text: { type: 'string' }, on: { type: 'string' } },
 *     },
 *   },
 * })
 * equal(
 *   plain(tree(views, note, 'Tile', vocab, ctx)),
 *   'Jeff · 2 hours ago · on T-9 Results are often miles long.',
 * )
 * equal(said.needs!(note), ['p1', 't1'])
 * ```
 */
export let passage = (
  said: Said,
): { render: Rendering; needs: NonNullable<Renderer['needs']> } => ({
  needs: (b) =>
    [made(b).by, said.where?.(b)?.[1]].filter((e): e is string => !!e),
  render: <Node>(b: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
    let s = shown(ctx)
    let words = Array.isArray(ctx.words) ? ctx.words.map(String) : []
    let cuts = said.texts(b)
      .filter((t): t is string => typeof t == 'string' && !!t.trim())
      .map((t) => snippet(t, words))
    let cut = cuts.find((c) => c.includes('\x01')) ?? cuts[0] ?? ''
    let { by, at } = made(b)
    let title = said.title?.(b)
    let what = said.what?.(b)
    let where = said.where?.(b)
    let parts = [
      typeof title == 'string' && title &&
      h('span', { class: 'Passage_Title' }, ...marks(h, snippet(title, words))),
      by && h('span', { class: 'Passage_Who' }, s.name(by)),
      what && h('span', null, what),
      at && h('time', { datetime: at }, s.when(at)),
      where && h('span', null, `${where[0]} ${s.name(where[1])}`),
    ].filter((p): p is Node => !!p)
    return h(
      'a',
      { class: 'Passage', href: s.link?.(b.entity.eid) },
      h(
        'span',
        { class: 'Passage_By' },
        ...parts.flatMap((p, i) =>
          i ? [' ', h('span', { class: 'Passage_Sep' }, '·'), ' ', p] : [p]
        ),
      ),
      ' ',
      h('span', { class: 'Passage_Text' }, ...marks(h, cut)),
    )
  },
})

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
  { view: 'Inline', match: true, render: inline },
  { view: 'Facts', match: true, render: facts },
  { view: 'Comment', match: parse('.comment'), render: comment },
  { view: 'Page', match: true, render: page },
])

/** How these views dress in a terminal (@yaks/tui's painter): their own class
 * names, in the colours of a theme (@yaks/ui `Colors`), named rather than
 * imported: @yaks/tui builds on this package. A page's head, title and body
 * and each section end with a blank line, where a browser has margins. */
export let sheet = (
  c: Record<'dim' | 'heading' | 'muted', string>,
): Record<string, { fg?: string; gap?: boolean }> => ({
  Page_Head: { fg: c.dim, gap: true },
  Page_Title: { gap: true },
  Page_Body: { gap: true },
  Section: { gap: true },
  Section_Title: { fg: c.heading },
  Facts_Prop: { fg: c.muted },
  Tile_Id: { fg: c.dim },
  Comment_Head: { fg: c.dim },
})
