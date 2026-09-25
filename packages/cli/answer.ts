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
// (@yaks/web/views) — the order @yaks/web's browser registers them in, so an
// entity reads the same in both. A server names no plugins, so its answers get
// the last two. A lone entity is shown whole, as its `Page`; several are a
// `Tile` each, one line apiece — unless the answer is some entities and what
// points at them (`yak graph show`), when each of those is a `Page` and the
// rest are its relations and comments.
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
import { type Node, plain, tree } from '@yaks/text'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import {
  type Related,
  sheet,
  type Shown,
  views as generic,
} from '@yaks/web/views'
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
    .filter((p) => p != '@yaks/web')
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
let META = new Set(['references', 'recalled'])

// How many of one group a page lists before it only counts the rest.
let MOST = 10

// The entities an answer is about, where it is some entities and what points
// at them: each is pointed at by something in the answer and points at
// nothing in it, and everything else points at one of them. A list whose
// members stand on their own is about none of them.
let subjects = (vocab: Vocab, answer: Bundle[]): Bundle[] => {
  let held = new Set(answer.map((b) => b.entity.eid))
  let aims = new Map(answer.map((b) => [
    b.entity.eid,
    new Set(
      refsOf(vocab, b).map(([, , eid]) => eid)
        .filter((eid) => held.has(eid) && eid != b.entity.eid),
    ),
  ]))
  let aimed = new Set([...aims.values()].flatMap((s) => [...s]))
  let about = answer.filter((b) =>
    aimed.has(b.entity.eid) && !aims.get(b.entity.eid)!.size
  )
  let at = new Set(about.map((b) => b.entity.eid))
  return about.length &&
      answer.every((b) =>
        at.has(b.entity.eid) ||
        [...aims.get(b.entity.eid)!].some((e) => at.has(e))
      )
    ? about
    : []
}

// What a page says about one of an answer's subjects: each link as the entity
// at its other end, grouped by relation and direction (`contains ←` for the
// entities that contain it), anything else that points at it grouped by the
// property that does, and the comments aimed at it.
let around = (
  vocab: Vocab,
  it: Bundle,
  answer: Bundle[],
  held: Map<string, Bundle>,
): { relations: Related[]; comments: Bundle[] } => {
  let eid = it.entity.eid
  let groups = new Map<string, Bundle[]>()
  let put = (title: string, b: Bundle) =>
    groups.set(title, [...groups.get(title) ?? [], b])
  let comments: Bundle[] = []
  for (let b of answer) {
    let hits = refsOf(vocab, b).filter(([, , e]) => e == eid)
    if (b == it || !hits.length) continue
    let rel = relationOf(vocab, b)
    let edge = b.edge as { from?: string; to?: string } | undefined
    if (rel && edge) {
      if (META.has(rel)) continue
      let out = edge.from == eid
      let other = (out ? edge.to : edge.from) ?? ''
      put(
        `${rel} ${out ? '→' : '←'}`,
        held.get(other) ?? { entity: { eid: other } },
      )
    } else if ((b.comment as { target?: string })?.target == eid) {
      comments.push(b)
    } else put(`${hits[0][0]}.${hits[0][1]} ←`, b)
  }
  let relations = [...groups].map(([title, items]) => ({
    title: items.length > MOST
      ? `${title} (${MOST} of ${items.length})`
      : title,
    items: items.slice(0, MOST),
  }))
  return { relations, comments }
}

// What an answer draws, in whatever tree `draw` builds: each entity it is about
// as a `Page` with what surrounds it, a blank line apart, or else every entity
// as its view, a line apiece. The one composition both lowerings share.
let drawn = <Node>(
  vocab: Vocab,
  answer: Bundle[],
  named: Bundle[],
  draw: (b: Bundle, view: string, ctx: Shown<Node>) => Node | null,
): { nodes: (Node | null)[]; gap: string } => {
  let ctx = shown(vocab, answer, draw, named)
  let about = subjects(vocab, answer)
  if (!about.length) {
    return { nodes: answer.map((b) => draw(b, viewOf(answer), ctx)), gap: '\n' }
  }
  let held = new Map([...named, ...answer].map((b) => [b.entity.eid, b]))
  return {
    nodes: about.map((b) =>
      draw(b, 'Page', { ...ctx, ...around(vocab, b, answer, held) })
    ),
    gap: '\n\n',
  }
}

/** An answer as the lines a terminal prints. `named` holds the entities its
 * references point at, so each prints as its id; one not there prints as its
 * handle. */
export let printed = (
  views: Registry,
  vocab: Vocab,
  answer: Bundle[],
  named: Bundle[] = [],
): string => {
  let { nodes, gap } = drawn<Node>(
    vocab,
    answer,
    named,
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
): Promise<string> => {
  let [{ render: mount }, { print }] = await Promise.all([
    import('@yaks/preact'),
    import('@yaks/tui/print'),
  ])
  let { nodes, gap } = drawn<ComponentChild>(
    vocab,
    answer,
    named,
    (b, v, c) => mount(views, b, v, vocab, { ...c, readOnly: true }),
  )
  return nodes.map((n) => print(n, columns, sheet)).filter(Boolean).join(gap)
}

/** An answer held in the terminal (@yaks/tui) until Ctrl-C, drawn as a
 * printout draws it ({@link painted}). Loaded only when asked for, so a
 * printed answer never pays for a terminal app. `db` is the file the answer
 * came from, for a view that keeps reading it. A lone answer drawn by a
 * component of its own (a plugin's `./tui`) is an app, and has the whole
 * terminal; anything else scrolls. */
export let hold = async (
  views: Held,
  vocab: Vocab,
  answer: Bundle[],
  db?: string,
  named: Bundle[] = [],
): Promise<void> => {
  let [{ h }, { render: mount }, { run, Scroll }] = await Promise.all([
    import('preact'),
    import('@yaks/preact'),
    import('@yaks/tui'),
  ])
  let [lone] = answer
  let app = answer.length == 1 && 'Render' in
      (resolve(views, lone, viewOf(answer), vocab, { db }) ?? {})
  await run(() => {
    let { nodes } = drawn<ComponentChild>(
      vocab,
      answer,
      named,
      (b, v, c) => mount(views, b, v, vocab, { ...c, db }),
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

/** An answer shown the way the command asked — held in the terminal under
 * `--tui`, drawn by `held` where the command has terminal views and a file to
 * read ({@link terminal}), painted where stdout is a terminal, and printed
 * otherwise. `lookup` reads the entities the answer's references point at,
 * from wherever the answer came from, so a reference prints as the id a person
 * types. */
export let show = async (
  c: { tui: boolean; tty?: Tty; out: (line: string) => void },
  views: Registry,
  vocab: Vocab,
  answer: Bundle[],
  held: { views?: Held; db?: string } = {},
  lookup: (eids: string[]) => Bundle[] | Promise<Bundle[]> = () => [],
): Promise<void> => {
  let refs = referenced(vocab, answer)
  let named = refs.length ? await lookup(refs) : []
  if (c.tui) {
    return await hold(held.views ?? views, vocab, answer, held.db, named)
  }
  if (c.tty) {
    let text = await painted(views, vocab, answer, named, c.tty.columns)
    if (text) c.tty.write(text)
    return
  }
  let text = printed(views, vocab, answer, named)
  if (text) c.out(text)
}
