// How the `yak` command shows a tool's answer, whichever graph gave it: the
// one a config names, opened in this process (./local.ts), or the one behind an
// MCP server (./platform.ts), whose reply carries the same bundles. A tool
// returns bundles and never keeps the terminal; drawing them is the caller's,
// through the same @yaks/render views a browser draws with, lowered by where
// they go. Piped, they go through @yaks/text as plain lines; to a terminal,
// @yaks/preact mounts the same trees in @yaks/tui's document and its painter
// lays them out in color, once; under `--tui`, @yaks/tui holds them until
// Ctrl-C.
//
// The views are every configured plugin's `./views`, then @yaks/tools' (the
// host always carries its `content`), then the generic ones any entity has
// (@yaks/render/views). A server names no plugins, so its answers get the last
// two. A lone entity is shown whole, as its `Page`, beside the links
// and comments the page asks for itself, since a tool answers only what it
// was asked; several are a `Tile` each, one line apiece.
//
// A terminal can hold more than a printout: a plugin's `./tui` exports views
// that are Preact components of their own — the harness's session, which is
// the whole interactive app — and those come first when the answer is held.
// They are never printed, because a component is not text.

import type { Bundle } from '@yaks/graph'
import { human, short } from '@yaks/id'
import {
  define,
  type Registry,
  type Renderer,
  resolve,
  type Selection,
} from '@yaks/render'
import type { ComponentRenderer } from '@yaks/preact'
import type { ComponentChild } from 'preact'
import { names, reversed } from '@yaks/edge/vocab'
import { type Node, plain, tree } from '@yaks/text'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import {
  type Related,
  sheet,
  type Shown,
  views as generic,
} from '@yaks/render/views'
import { subpath } from './config.ts'
import { understood } from './keywords.ts'
import type { Tty } from './run.ts'

/** How one plugin's `./views` becomes a module: {@link subpath} unless a test
 * hands its modules over inline. */
export type Views = (plugin: string) => Promise<{ views?: Registry } | null>

/** Every view the `yak` command draws with, most knowing first. */
export let registry = async (
  plugins: string[],
  load: Views = (plugin) => subpath(plugin, 'views'),
): Promise<Registry> => {
  let named = [...new Set([...plugins, '@yaks/tools'])]
  let found = await Promise.all(named.map(load))
  return define([
    ...found.flatMap((m) => m?.views?.renderers ?? []),
    ...generic.renderers,
  ])
}

/** What a terminal draws with: portable views, and components of its own. */
export type Held = Selection<Renderer | ComponentRenderer>

/** How one plugin's `./tui` becomes a module. */
export type Tui = (plugin: string) => Promise<{ views?: Held } | null>

/** The views an answer held in the terminal draws with: each plugin's
 * `./tui`, then {@link registry}'s. */
export let terminal = async (
  plugins: string[],
  load: Views = (plugin) => subpath(plugin, 'views'),
  held: Tui = (plugin) => subpath<{ views?: Held }>(plugin, 'tui'),
): Promise<Held> => {
  let own = await Promise.all(plugins.map(held))
  return define([
    ...own.flatMap((m) => m?.views?.renderers ?? []),
    ...(await registry(plugins, load)).renderers,
  ])
}

// What a view cannot know from one bundle, for a terminal: an entity another
// names reads as its id where the answer or `named` holds it, nothing links,
// and a moment reads as written.
let shown = <Node>(
  vocab: Vocab,
  answer: Bundle[],
  draw: (b: Bundle, view: string, ctx: Shown<Node>) => Node | null,
  named: Bundle[] = [],
): Shown<Node> => {
  let id = human(vocab)
  let held = new Map([...named, ...answer].map((b) => [b.entity.eid, b]))
  let ctx: Shown<Node> = {
    id,
    kind: (b) => vocab.kindOf(b) || 'entity',
    name: (eid) => {
      let b = held.get(eid)
      return b ? id(b) : short(eid)
    },
    when: (at) => at,
    show: (b, view) => draw(b, view, ctx),
    relation: (b) => relationOf(vocab, b),
  }
  return ctx
}

let viewOf = (answer: Bundle[]) => answer.length == 1 ? 'Page' : 'Tile'

// The relation an edge states: the component beside `edge` that the
// vocabulary declares one (@yaks/edge).
let relationOf = (vocab: Vocab, b: Bundle): string | undefined =>
  Object.keys(b).find((c) => vocab.comp(c)?.keywords?.edge != null)

// Every reference one bundle makes, as `[comp, prop, eid]`.
let refsOf = (vocab: Vocab, b: Bundle): [string, string, string][] =>
  Object.entries(b).flatMap(([comp, value]) =>
    comp == 'entity' || !value || typeof value != 'object'
      ? []
      : Object.entries(value).flatMap(([prop, v]) =>
        typeof v == 'string' && vocab.prop(comp, prop)?.category == 'ref'
          ? [[comp, prop, v] as [string, string, string]]
          : []
      )
  )

/** The entities an answer's references point at that the answer does not
 * carry itself: what a printed reference needs looked up to read as `P-19`
 * rather than as its handle. */
export let referenced = (vocab: Vocab, answer: Bundle[]): string[] => {
  let held = new Set(answer.map((b) => b.entity.eid))
  let out = new Set<string>()
  for (let b of answer) {
    for (let [, , eid] of refsOf(vocab, b)) if (!held.has(eid)) out.add(eid)
  }
  return [...out]
}

// Links a page leaves out: bookkeeping written about an entity, not a link
// anybody made — the kernel's `references` (text that mentions it) and
// @yaks/dreaming's `recalled` (a session recalled it). `yak graph query
// '.refs=<id>&.references&*'` lists them.
let META = ['references', 'recalled']

// How many of one group a page lists before it only counts the rest, and how
// many links it asks for at all: an actor's page could name thousands.
let MOST = 10
let ENOUGH = 100

/** What a page draws beside an entity: the links it is in and the comments
 * aimed at it. A tool answers only what it was asked for, so the page asks
 * for these itself, in the one query {@link nearQuery} writes. */
export type Near = { links: Bundle[]; comments: Bundle[] }

/** The one query a page asks about the entity it draws: the links it is in,
 * bar META, and the comments aimed at it — each only where this vocabulary
 * has the component, and none at all where it has neither. */
export let nearQuery = (vocab: Vocab, eid: string): string | null => {
  let arms = [
    ...vocab.comp('edge') ? [`.edge.from=${eid}`, `.edge.to=${eid}`] : [],
    ...vocab.comp('comment') ? [`.comment.target=${eid}`] : [],
  ]
  return arms.length
    ? [
      `(${arms.join('|')})`,
      ...META.filter((m) => vocab.comp(m)).map((m) => `!${m}`),
      `.limit=${ENOUGH}`,
      '*',
    ].join('&')
    : null
}

// The answer to {@link nearQuery}, told apart: a comment aimed at the entity,
// or a link.
let nearOf = (eid: string, found: Bundle[]): Near => ({
  links: found.filter((b) => b.edge),
  comments: found.filter((b) =>
    (b.comment as { target?: string } | undefined)?.target == eid
  ),
})

// What a page says about the entity it draws: each link as the entity at its
// other end, grouped by relation and direction — `requires` for what it
// requires, and the relation's `reversed` phrase (@yaks/edge), `required by`,
// for the entities that require it — and the comments aimed at it.
let around = (
  vocab: Vocab,
  it: Bundle,
  near: Near,
  held: Map<string, Bundle>,
): { relations: Related[]; comments: Bundle[] } => {
  let eid = it.entity.eid
  let named = names(vocab)
  let back = reversed(vocab)
  let groups = new Map<string, Bundle[]>()
  for (let b of near.links) {
    let rel = relationOf(vocab, b)
    let edge = b.edge as { from?: string; to?: string } | undefined
    if (!rel || !edge) continue
    let out = edge.from == eid
    let other = (out ? edge.to : edge.from) ?? ''
    let title = out ? rel : back[named[rel]] ?? `${rel} ←`
    groups.set(title, [
      ...groups.get(title) ?? [],
      held.get(other) ?? { entity: { eid: other } },
    ])
  }
  // Asked for at most ENOUGH, so a full answer counts only what it holds.
  let more = near.links.length + near.comments.length >= ENOUGH ? '+' : ''
  let relations = [...groups].map(([title, items]) => ({
    title: items.length > MOST
      ? `${title} (${MOST} of ${items.length}${more})`
      : title,
    items: items.slice(0, MOST),
  }))
  return { relations, comments: near.comments }
}

// What an answer draws, in whatever tree `draw` builds: a lone entity as its
// `Page`, with what `near` holds beside it, or else every entity as its view,
// a line apiece. The one composition every lowering shares.
let drawn = <Node>(
  vocab: Vocab,
  answer: Bundle[],
  named: Bundle[],
  near: Near,
  draw: (b: Bundle, view: string, ctx: Shown<Node>) => Node | null,
): { nodes: (Node | null)[]; gap: string } => {
  let ctx = shown(vocab, answer, draw, named)
  let [lone] = answer
  if (answer.length != 1) {
    return { nodes: answer.map((b) => draw(b, viewOf(answer), ctx)), gap: '\n' }
  }
  let held = new Map([...named, ...answer].map((b) => [b.entity.eid, b]))
  return {
    nodes: [draw(lone, 'Page', { ...ctx, ...around(vocab, lone, near, held) })],
    gap: '\n\n',
  }
}

let nothing: Near = { links: [], comments: [] }

/** An answer as the lines a terminal prints. `named` holds the entities its
 * references point at, so each prints as its id; one not there prints as its
 * handle. A lone entity is its `Page`, with what `near` holds beside it. */
export let printed = (
  views: Registry,
  vocab: Vocab,
  answer: Bundle[],
  named: Bundle[] = [],
  near: Near = nothing,
): string => {
  let { nodes, gap } = drawn<Node>(
    vocab,
    answer,
    named,
    near,
    (b, v, c) => tree(views, b, v, vocab, c),
  )
  return nodes.map((n) => plain(n)).filter(Boolean).join(gap)
}

/** The same answer painted for a terminal `columns` wide: the same views,
 * mounted in @yaks/tui's document and laid out, styled and colored by its
 * painter, once. Loaded only for a terminal, so a printed answer never pays
 * for the painter. */
export let painted = async (
  views: Registry,
  vocab: Vocab,
  answer: Bundle[],
  named: Bundle[],
  columns: number,
  near: Near = nothing,
): Promise<string> => {
  let [{ render: mount }, { print }] = await Promise.all([
    import('@yaks/preact'),
    import('@yaks/tui/print'),
  ])
  let { nodes, gap } = drawn<ComponentChild>(
    vocab,
    answer,
    named,
    near,
    (b, v, c) => mount(views, b, v, vocab, { ...c, readOnly: true }),
  )
  return nodes.map((n) => print(n, columns, sheet)).filter(Boolean).join(gap)
}

/** An answer held in the terminal (@yaks/tui) until Ctrl-C, drawn as a
 * printout draws it ({@link painted}). Loaded only when asked for, so a
 * printed answer never pays for a terminal app. `config` is the config file
 * naming the graph the answer came from, for a view that keeps reading it. A lone answer drawn by a
 * component of its own (a plugin's `./tui`) is an app, and has the whole
 * terminal; anything else scrolls. */
export let hold = async (
  views: Held,
  vocab: Vocab,
  answer: Bundle[],
  config?: string,
  named: Bundle[] = [],
  near: Near = nothing,
): Promise<void> => {
  let [{ h }, { render: mount }, { run, Scroll }] = await Promise.all([
    import('preact'),
    import('@yaks/preact'),
    import('@yaks/tui'),
  ])
  let [lone] = answer
  let app = answer.length == 1 && 'Render' in
      (resolve(views, lone, viewOf(answer), vocab, { config }) ?? {})
  await run(() => {
    let { nodes } = drawn<ComponentChild>(
      vocab,
      answer,
      named,
      near,
      (b, v, c) => mount(views, b, v, vocab, { ...c, config }),
    )
    return app ? nodes[0] : h(
      Scroll,
      { id: 'answer', grow: '1' },
      nodes.map((n) => h('div', null, n)),
    )
  }, { sheet })
}

// A package a server named that this machine has no copy of: its plugins are
// its own, so an answer is drawn with the views that are here.
let elsewhere = (error: unknown): boolean =>
  error instanceof TypeError && error.message.includes('not a dependency')

/** A vocabulary a server reported (`graph_schema`), read the way a host reads
 * its own — with the keywords every host understands — and the views of the
 * packages it says declared its components, where this machine has them. */
export let reported = async (
  doc: VocabDoc,
): Promise<{ views: Registry; vocab: Vocab }> => {
  let vocab = loadVocab([doc], understood())
  let plugins = vocab.all.flatMap((n) => vocab.comp(n)?.package ?? [])
  let views = await registry(
    [...new Set(plugins)],
    (plugin) =>
      subpath<{ views?: Registry }>(plugin, 'views').catch((error) =>
        elsewhere(error) ? null : Promise.reject(error)
      ),
  )
  return { views, vocab }
}

/** Where a drawing asks for what it draws beyond the answer, from wherever
 * the answer came from: `lookup` reads entities by eid, so a reference
 * prints as the id a person types, and `query` answers a page's
 * {@link nearQuery}. */
export type Source = {
  lookup: (eids: string[]) => Bundle[] | Promise<Bundle[]>
  query: (q: string) => Bundle[] | Promise<Bundle[]>
}

let none: Source = { lookup: () => [], query: () => [] }

/** A write's answer as a person reads it: each entity it changed as that
 * entity now stands, where it still does. The answer itself is the change as
 * applied — what `--json` prints — and names only what moved, so drawn as it
 * is, `task update T-3 done` would be an entity with a `completed` mark and no
 * title. One that no longer stands (a deletion's tombstone) is drawn as the
 * answer has it. */
export let standing = async (
  answer: Bundle[],
  from: Source,
): Promise<Bundle[]> => {
  let eids = answer.map((b) => b.entity.eid)
  let now = new Map(
    (eids.length ? await from.lookup(eids) : []).map((b) => [b.entity.eid, b]),
  )
  return answer.map((b) => now.get(b.entity.eid) ?? b)
}

/** An answer shown the way the command asked — held in the terminal under
 * `--tui`, drawn by `held` where the command has terminal views and a config
 * to read ({@link terminal}), painted where stdout is a terminal, and printed
 * otherwise. The answer of a tool that `wrote` is drawn {@link standing}. */
export let show = async (
  c: { tui: boolean; tty?: Tty; out: (line: string) => void },
  views: Registry,
  vocab: Vocab,
  said: Bundle[],
  held: { views?: Held; config?: string } = {},
  from: Source = none,
  wrote = false,
): Promise<void> => {
  let answer = wrote ? await standing(said, from) : said
  let [lone] = answer
  let asked = answer.length == 1 ? nearQuery(vocab, lone.entity.eid) : null
  let near = asked ? nearOf(lone.entity.eid, await from.query(asked)) : nothing
  let refs = referenced(vocab, [...answer, ...near.links, ...near.comments])
  let named = refs.length ? await from.lookup(refs) : []
  if (c.tui) {
    return await hold(
      held.views ?? views,
      vocab,
      answer,
      held.config,
      named,
      near,
    )
  }
  if (c.tty) {
    let text = await painted(views, vocab, answer, named, c.tty.columns, near)
    if (text) c.tty.write(text)
    return
  }
  let text = printed(views, vocab, answer, named, near)
  if (text) c.out(text)
}
