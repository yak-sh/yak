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
// two. An answer is a `Tile` per entity, one line apiece, whatever its length:
// a list of one is still a list, and a write says what it changed in a line.
// Only a tool that declares its answer a `page` (`graph show`, `mail show`)
// has a lone entity shown whole, as its `Page`, beside the links and comments
// the page asks for itself, since a tool answers only what it was asked.
//
// A terminal can hold more than a printout: a plugin's `./tui` exports views
// that are Preact components of their own — the harness's session, which is
// the whole interactive app — and those come first when the answer is held.
// They are never printed, because a component is not text.

import type { Bundle } from '@yaks/graph'
import { human, idOf, short } from '@yaks/id'
import {
  define,
  type H,
  prepared,
  type Registry,
  type RenderContext,
  type Renderer,
  resolve,
  type Selection,
} from '@yaks/render'
import type { ComponentRenderer } from '@yaks/preact'
import type { ComponentChild } from 'preact'
import { names, reversed } from '@yaks/edge/vocab'
import { type Node, plain, safe, tree } from '@yaks/text'
import type { Vocab } from '@yaks/vocab/runtime'
import type { Sheet } from '@yaks/tui/theme'
import {
  type Related,
  sheet,
  type Shown,
  views as generic,
} from '@yaks/render/views'
import type { AnatomyObserver } from '@yaks/code/anatomy'
import { relative } from '@yaks/ui/relative'

// What an answer wears in a terminal: @yaks/ui's components and these views'
// own classes, in Everforest. Loaded with the painter, so a printed answer
// never pays for it.
let dressed = async (): Promise<Sheet> => {
  let { everforest, kits, sheet: kit } = await import('@yaks/ui')
  return { ...kit({ kits, theme: everforest }), ...sheet(everforest.colors) }
}

/** A terminal a held answer is drawn on: its width and how to write to it. */
export type Tty = { columns: number; write: (text: string) => void }

/** What one plugin's `./views` module offers a registry. */
export type ViewFacet = {
  views?: Registry
  inspectViews?: unknown
  componentViews?:
    | Selection<ComponentRenderer>
    | (() =>
      | Selection<ComponentRenderer>
      | Promise<Selection<ComponentRenderer>>)
}
/** How one plugin's `./views` becomes a module: config.ts `pluginViews` for
 * the plugins a config names, or modules a caller hands over inline. `warm`
 * readies several at once before they are asked for one by one. */
export type Views = ((plugin: string) => Promise<ViewFacet | null>) & {
  warm?: (plugins: string[]) => Promise<unknown>
}

type Hit = {
  kind: string
  title?: string
  snippet: string
  source: 'text' | 'meaning' | 'both'
  session?: string
  speaker?: 'input' | 'output'
  /** the entity a call just made that this one was found near */
  near?: string
  status?: string
}

let hitOf = (b: Bundle): Hit | null => {
  let h = b.hit
  if (
    !h || typeof h != 'object' || !('kind' in h) ||
    !('snippet' in h) || !('source' in h) ||
    typeof h.kind != 'string' || typeof h.snippet != 'string' ||
    !['text', 'meaning', 'both'].includes(String(h.source))
  ) return null
  return {
    kind: h.kind,
    title: 'title' in h && typeof h.title == 'string' ? h.title : undefined,
    snippet: h.snippet,
    source: h.source == 'text'
      ? 'text'
      : h.source == 'meaning'
      ? 'meaning'
      : 'both',
    session: typeof h.session == 'string' ? h.session : undefined,
    speaker: h.speaker == 'input'
      ? 'input'
      : h.speaker == 'output'
      ? 'output'
      : undefined,
    near: 'near' in h && typeof h.near == 'string' ? h.near : undefined,
    status: 'status' in h && typeof h.status == 'string' ? h.status : undefined,
  }
}

let excerpt = (text: string): string =>
  safe(
    text.replace(/\s+/g, ' ').replace(
      // deno-lint-ignore no-control-regex -- FTS marks matches with these bytes.
      /\x01([^\x02]*)\x02/g,
      (_match, word: string) => `*${word}*`,
    ),
  ).trim()

let hit = <Node>(
  b: Bundle,
  h: H<Node>,
  ctx: RenderContext<Node>,
): Node => {
  let found = hitOf(b)!
  let s = ctx as Shown<Node>
  let title = safe(found.title ?? '')
  let kind = safe(found.kind)
  let snippet = excerpt(found.snippet)
  return h(
    'span',
    { class: 'SearchHit' },
    found.near ? `near ${s.name(found.near)}: ` : '',
    s.id(b),
    title ? ` ${title}` : '',
    ` · ${kind}`,
    found.status ? ` ${safe(found.status)}` : '',
    found.session && found.speaker
      ? ` ${found.speaker} in session ${short(found.session)}`
      : '',
    found.source == 'meaning' ? ' (meaning)' : '',
    snippet ? ` — ${snippet}` : '',
  )
}

let search: Renderer = { view: 'Search.Tile', match: true, render: hit }

/** Every view the `yak` command draws with, most knowing first. */
export function registry(
  plugins: string[],
  load: Views,
  observe: AnatomyObserver | undefined,
  components: true,
): Promise<Registry<Renderer | ComponentRenderer>>
export function registry(
  plugins: string[],
  load: Views,
  observe?: AnatomyObserver,
): Promise<Registry>
export async function registry(
  plugins: string[],
  load: Views,
  observe?: AnatomyObserver,
  components = false,
): Promise<Registry<Renderer | ComponentRenderer>> {
  let named = [...new Set([...plugins, '@yaks/tools'])]
  await load.warm?.(named)
  let found = await Promise.all(named.map(async (plugin) => {
    let m = await load(plugin)
    let faces = components
      ? typeof m?.componentViews == 'function'
        ? await m.componentViews()
        : m?.componentViews
      : undefined
    let views = define([
      ...m?.views?.renderers ?? [],
      ...faces?.renderers ?? [],
    ])
    observe?.({
      package: plugin,
      facet: 'views',
      loaded: m !== null,
      bound: true,
      value: faces ? { ...m, views } : m,
    })
    return views
  }))
  observe?.({
    package: '@yaks/cli',
    facet: 'views',
    loaded: true,
    bound: true,
    value: { views: define([search]) },
  })
  observe?.({
    package: '@yaks/render',
    facet: 'views',
    loaded: true,
    bound: true,
    value: { views: generic },
  })
  let all = define([
    ...found.flatMap((m) => m.renderers),
    search,
    ...generic.renderers,
  ])
  return components ? prepared(all) : all
}

/** What a terminal draws with: portable views, and components of its own. */
export type Held = Selection<Renderer | ComponentRenderer>

/** How one plugin's `./tui` becomes a module. */
export type Tui = (plugin: string) => Promise<{ views?: Held } | null>

/** The views an answer held in the terminal draws with: each plugin's
 * `./tui`, then {@link registry}'s. */
export let terminal = async (
  plugins: string[],
  load: Views,
  held: Tui,
  observe?: AnatomyObserver,
): Promise<Held> => {
  let own = await Promise.all(plugins.map(async (plugin) => {
    let m = await held(plugin)
    observe?.({
      package: plugin,
      facet: 'tui',
      loaded: m !== null,
      bound: true,
      value: m,
    })
    return m
  }))
  return prepared(define([
    ...own.flatMap((m) => m?.views?.renderers ?? []),
    ...(await registry(plugins, load, observe, true)).renderers,
  ]))
}

/** What a drawing has read beyond its answer, and how it asks for more:
 * `answers` holds the rows each query a view asked answered; `eid` and `query`
 * are told of each entity and query a view asked for, so a printout can read
 * them and draw again; `deferred` of a renderer the host must prepare. */
export type Wants = {
  answers?: ReadonlyMap<string, Bundle[]>
  eid?: (eid: string) => void
  query?: (q: string) => void
  deferred?: (renderer: Renderer) => void
}

// What a view cannot know from one bundle, for a terminal: an entity another
// names reads as its id where the answer or `named` holds it, a query a view
// asks answers what `want` holds, nothing links, and a moment reads as a
// browser says it, `5 minutes ago`.
let shown = <Node>(
  vocab: Vocab,
  answer: Bundle[],
  draw: (b: Bundle, view: string, ctx: Shown<Node>) => Node | null,
  named: Bundle[] = [],
  links: Bundle[] = [],
  want: Wants = {},
): Shown<Node> => {
  let demand = want.eid
  let id = human(vocab)
  let idAs = idOf(vocab)
  let held = new Map(
    [...links, ...named, ...answer].map((b) => [b.entity.eid, b]),
  )
  let ctx: Shown<Node> & Pick<RenderContext<Node>, 'needed'> = {
    needed: demand ? (eids) => eids.forEach(demand) : undefined,
    id: (b) => {
      let hit = hitOf(b)
      return hit ? idAs({ ...b.entity, kind: hit.kind }) : id(b)
    },
    kind: (b) => hitOf(b)?.kind ?? (vocab.kindOf(b) || 'entity'),
    name: (eid) => {
      demand?.(eid)
      let b = held.get(eid)
      return b ? id(b) : short(eid)
    },
    when: (at) => relative(at),
    show: (b, view) => {
      demand?.(b.entity.eid)
      return draw(b, view, ctx)
    },
    relation: (b) => relationOf(vocab, b),
    get: (eid) => {
      demand?.(eid)
      return held.get(eid)
    },
    query: (q) => {
      let rows = want.answers?.get(q)
      if (!rows) want.query?.(q)
      return rows
    },
    related: (eid, relation) =>
      links.flatMap((b) => {
        let edge = b.edge as { from?: string; to?: string } | undefined
        return b[relation] && edge?.to == eid && edge.from
          ? [held.get(edge.from) ?? { entity: { eid: edge.from } }]
          : []
      }),
  }
  return ctx
}

/** What a tool declared that decides how its answer is drawn: one that is not
 * `readOnly` wrote, so its answer is drawn as its entities now stand
 * ({@link standing}); a `page` tool's lone entity is drawn whole. */
export type Drawn = { readOnly?: boolean; page?: boolean }

// The view each entity of an answer is drawn as: a `Page` for the lone entity
// of an answer drawn as a page, a `Tile` otherwise.
let viewOf = (them: Bundle[], page: boolean) =>
  page && them.length == 1 ? 'Page' : 'Tile'

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
 * rather than as its handle. `page` is the eid of the entity drawn whole, if
 * one is; every other is drawn as its `Tile`. */
export let referenced = (
  vocab: Vocab,
  answer: Bundle[],
  views?: Held,
  page?: string,
): string[] => {
  let held = new Set(answer.map((b) => b.entity.eid))
  let out = new Set<string>()
  for (let b of answer) {
    let view = b.entity.eid == page ? 'Page' : 'Tile'
    for (let [, , eid] of refsOf(vocab, b)) if (!held.has(eid)) out.add(eid)
    for (
      let eid of views ? resolve(views, b, view, vocab)?.needs?.(b) ?? [] : []
    ) if (!held.has(eid)) out.add(eid)
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

// An answer's entities, and apart from them its search hits: what a search
// found, or what a call's new entities were found near.
let parted = (answer: Bundle[]) => ({
  them: answer.filter((b) => !hitOf(b)),
  hits: answer.filter(hitOf),
})

// What an answer draws, in whatever tree `draw` builds, as groups of lines: a
// lone entity drawn as a `page` as its `Page`, with what the page holds beside
// it, or else every entity as its `Tile`, a line apiece; then every hit, a
// line apiece. The one composition every lowering shares.
let drawn = <Node>(
  vocab: Vocab,
  answer: Bundle[],
  named: Bundle[],
  page: Near | undefined,
  draw: (b: Bundle, view: string, ctx: Shown<Node>) => Node | null,
  want: Wants = {},
): (Node | null)[][] => {
  let near = page ?? nothing
  let ctx = shown(
    vocab,
    answer,
    draw,
    named,
    [...answer, ...near.links, ...near.comments],
    want,
  )
  let { them, hits } = parted(answer)
  let found = hits.map((b) => draw(b, 'Search.Tile', ctx))
  let [lone] = them
  let held = new Map([...named, ...answer].map((b) => [b.entity.eid, b]))
  let drew = viewOf(them, !!page) == 'Page'
    ? [draw(lone, 'Page', { ...ctx, ...around(vocab, lone, near, held) })]
    : them.map((b) => draw(b, 'Tile', ctx))
  return [drew, found].filter((g) => g.length)
}

// Groups of lines as one text: a line apiece within a group, a blank line
// between groups.
let joined = (groups: string[][]): string =>
  groups.map((g) => g.filter(Boolean).join('\n')).filter(Boolean).join('\n\n')

let nothing: Near = { links: [], comments: [] }

// The token belongs to the body a page just showed, not to related entities
// or compact tiles that show no body.
let freshness = (answer: Bundle[], page?: Near): string => {
  let { them } = parted(answer)
  let was = viewOf(them, !!page) == 'Page' ? them[0].$was?.doc?.body : undefined
  return was === undefined ? '' : `was: ${was}`
}

/** An answer as the lines a terminal prints. `named` holds the entities its
 * references point at, so each prints as its id; one not there prints as its
 * handle. Each entity is a line, unless the answer is drawn as a `page`: then
 * a lone entity is its `Page`, with what the page holds beside it. */
export let printed = (
  views: Registry,
  vocab: Vocab,
  answer: Bundle[],
  named: Bundle[] = [],
  page?: Near,
  want: Wants = {},
): string => {
  let groups = drawn<Node>(
    vocab,
    answer,
    named,
    page,
    (b, v, c) => tree(views, b, v, vocab, { ...c, deferred: want.deferred }),
    want,
  )
  return joined([
    ...groups.map((g) => g.map((n) => plain(n))),
    [freshness(answer, page)],
  ])
}

/** The same answer painted for a terminal `columns` wide: the same views,
 * mounted in @yaks/tui's document and laid out, styled and colored by its
 * painter, once. Loaded only for a terminal, so a printed answer never pays
 * for the painter. */
export let painted = async (
  views: Held,
  vocab: Vocab,
  answer: Bundle[],
  named: Bundle[],
  columns: number,
  page?: Near,
  answers?: ReadonlyMap<string, Bundle[]>,
): Promise<string> => {
  let [{ render: mount }, { print }, dress] = await Promise.all([
    import('@yaks/preact'),
    import('@yaks/tui/print'),
    dressed(),
  ])
  let groups = drawn<ComponentChild>(
    vocab,
    answer,
    named,
    page,
    (b, v, c) => mount(views, b, v, vocab, { ...c, readOnly: true }),
    { answers },
  )
  return joined([
    ...groups.map((g) => g.map((n) => print(n, columns, dress))),
    [freshness(answer, page)],
  ])
}

/** An answer held in the terminal (@yaks/tui) until Ctrl-C, drawn as a
 * printout draws it ({@link painted}). Loaded only when asked for, so a
 * printed answer never pays for a terminal app. `config` is the config file
 * naming the graph the answer came from, for a view that keeps reading it. A
 * lone answer whose page is a component of its own (a plugin's `./tui`) is an
 * app, and has the whole terminal, whether or not the answer was drawn as a
 * `page`; anything else scrolls. */
export let hold = async (
  views: Held,
  vocab: Vocab,
  answer: Bundle[],
  config?: string,
  named: Bundle[] = [],
  page?: Near,
  answers?: ReadonlyMap<string, Bundle[]>,
): Promise<void> => {
  let [{ h }, { render: mount }, { run, Scroll }, dress] = await Promise.all([
    import('preact'),
    import('@yaks/preact'),
    import('@yaks/tui'),
    dressed(),
  ])
  let [lone] = answer
  let app = answer.length == 1 && 'Render' in
      (resolve(views, lone, 'Page', vocab, { config }) ?? {})
  await run(() => {
    let nodes = drawn<ComponentChild>(
      vocab,
      answer,
      named,
      app ? page ?? nothing : page,
      (b, v, c) => mount(views, b, v, vocab, { ...c, config }),
      { answers },
    ).flat()
    return app ? nodes[0] : h(
      Scroll,
      { id: 'answer', grow: '1' },
      nodes.map((n) => h('div', null, n)),
    )
  }, { sheet: dress })
}

/** Where a drawing asks for what it draws beyond the answer, from wherever
 * the answer came from: `lookup` reads entities by eid, so a reference
 * prints as the id a person types, and `query` answers a page's
 * {@link nearQuery}. */
export type Source = {
  lookup: (eids: string[]) => Bundle[] | Promise<Bundle[]>
  query: (q: string) => Bundle[] | Promise<Bundle[]>
}

/** What a read that found nothing prints. */
export let NONE = 'none'

let none: Source = { lookup: () => [], query: () => [] }

/** A write's answer as a person reads it: each entity it changed as that
 * entity now stands, where it still does. The answer itself is the batch as
 * applied — what `--json` prints — and names only what moved, so drawn as it
 * is, `task update T-3 done` would be an entity with a `completed` mark and no
 * title. One that no longer stands (a deletion's tombstone) is drawn as the
 * answer has it. */
export let standing = async (
  answer: Bundle[],
  from: Source,
): Promise<Bundle[]> => {
  let eids = parted(answer).them.map((b) => b.entity.eid)
  let now = new Map(
    (eids.length ? await from.lookup(eids) : []).map((b) => [b.entity.eid, b]),
  )
  return answer.map((b) => hitOf(b) ? b : now.get(b.entity.eid) ?? b)
}

/** An answer shown the way the command asked — held in the terminal under
 * `--tui`, drawn by `held` where the command has terminal views and a config
 * to read ({@link terminal}), painted where stdout is a terminal, and printed
 * otherwise — and the way its `tool` was declared ({@link Drawn}): the answer
 * of one that wrote is drawn {@link standing}, and a page tool's lone entity
 * whole, beside the links and comments its page asks for. */
export let show = async (
  c: { tui: boolean; tty?: Tty; out: (line: string) => void },
  views: Registry,
  vocab: Vocab,
  said: Bundle[],
  held: { views?: Held; config?: string } = {},
  from: Source = none,
  tool: Drawn = { readOnly: true },
): Promise<void> => {
  let answer = tool.readOnly ? said : await standing(said, from)
  // A read that found nothing says so: a blank answer reads as a command
  // that did nothing, or one still working.
  if (tool.readOnly && !answer.length && !c.tui) {
    return c.tty ? c.tty.write(NONE) : c.out(NONE)
  }
  let them = parted(answer).them
  let lone = viewOf(them, !!tool.page) == 'Page' ? them[0] : undefined
  let asked = lone ? nearQuery(vocab, lone.entity.eid) : null
  let page = !lone
    ? undefined
    : asked
    ? nearOf(lone.entity.eid, await from.query(asked))
    : nothing
  let near = page ?? nothing
  // Portable renderers are pure. Discover the references and queries the
  // drawing reads, including nested views and declared needs, rather than
  // fetching every reference carried by a bundle that a tile never shows. A
  // terminal paints with what the printout read, and the references its
  // components may read beside it.
  let known = new Set(
    [...answer, ...near.links, ...near.comments].map((b) => b.entity.eid),
  )
  let painting = c.tui || c.tty
  let refs = painting
    ? referenced(
      vocab,
      [...answer, ...near.links, ...near.comments],
      held.views ?? views,
      lone?.entity.eid,
    )
    : []
  let named: Bundle[] = refs.length ? await from.lookup(refs) : []
  named.forEach((b) => known.add(b.entity.eid))
  let answers = new Map<string, Bundle[]>()
  let text = ''
  while (true) {
    let pending = new Set<string>()
    let asking = new Set<string>()
    let loading = new Set<Renderer>()
    try {
      text = printed(views, vocab, answer, named, page, {
        answers,
        eid: (eid) => eid && !known.has(eid) && pending.add(eid),
        query: (q) => asking.add(q),
        deferred: (r) => loading.add(r),
      })
    } catch (error) {
      // A drawing may require a declared or newly-read dependency before
      // it can finish. Retry after those reads; failures without new reads
      // remain drawing errors, including required references that are gone.
      if (!pending.size && !loading.size && !asking.size) throw error
    }
    if (!pending.size && !loading.size && !asking.size) break
    let ids = [...pending]
    ids.forEach((id) => known.add(id))
    let [ready, found, said] = await Promise.all([
      loading.size ? prepared(views, [...loading]) : views,
      ids.length ? from.lookup(ids) : [],
      Promise.all(
        [...asking].map(async (q) =>
          [q, await Promise.resolve(from.query(q)).catch(() => [])] as const
        ),
      ),
    ])
    views = ready
    named.push(...found)
    found.forEach((b) => known.add(b.entity.eid))
    said.forEach(([q, rows]) => answers.set(q, rows))
  }
  if (!painting) {
    if (text) c.out(text)
    return
  }
  if (c.tui) {
    return await hold(
      held.views ?? views,
      vocab,
      answer,
      held.config,
      named,
      page,
      answers,
    )
  }
  if (c.tty) {
    let text = await painted(
      held.views ?? views,
      vocab,
      answer,
      named,
      c.tty.columns,
      page,
      answers,
    )
    if (text) c.tty.write(text)
    return
  }
}
