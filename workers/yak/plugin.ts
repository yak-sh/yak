// What a domain of this Worker contributes to the host, as data. The Worker is
// well split into files by domain already; what it lacked was a way for a
// domain to say what it brings without every host module naming it back. So
// this is the shape @yaks/graph's own `Plugin` has (packages/graph/plugin.ts) —
// a plain object of optional slots, plus a combinator per slot — said in the
// terms a Worker has rather than the terms `apply()` has.
//
// The slots are extracted, not invented: each one is a thing a domain file in
// here was already doing by being named from a host module.
//
//   vocab    a JSON Schema document folded into the directory's words
//            (vocab.ts `platformDocs`)
//   tools    rows of the connector's one roster (tools.ts `TOOLS`). Rows are
//            config-time and identical for every caller: the roster is fixed
//            and public (T-34541), so a plugin may add a row and may never
//            decide one per person.
//   pages    guide pages, offered by the `guide` tool and served as MCP
//            resources (guide.ts `PAGES`)
//   answers  a door at an app's own address (apps.ts `api`)
//   routes   a door at the apex or on a space's hostname, answered before any
//            app is (index.ts `serve`)
//   watch    what a plugin does about a page an app served (apps.ts `viewed`)
//   rules    what it does inside a store, as data: a query over one bundle in
//            a batch plus what comes out (@yaks/graph `Rule`), run by the phase
//            it names in every store this Worker builds (graph.ts `#boot`)
//   effects  what it does after a store commits: registrations on that store's
//            own post-commit registry (@yaks/effects, graph.ts `#boot`)
//   wakes    rows seeded once in the directory: when to write `fired`, with
//            the tags the plugin's effect rules match beside it
//   installs rows a store holds as the plugin ships them, written as the
//            kernel whenever they differ (graph.ts `#sow`): the directory's
//            built integrations, every app store's model catalogue
//   pins     the pinned bytes it still names, so the retention sweep keeps
//            them (versions.ts `pruned`)
//
// `rules` is the one slot that is not an extraction: it is @yaks/graph's own
// phase seam, offered here so a domain says what it does about a write in the
// same object it says its words and its rows in. A rule about a component a
// store does not speak is inert there (@yaks/graph rules.ts), which is what
// lets one list serve the directory and every app store alike.
//
// A plugin holds no state and is composed once, at module load — `PLUGINS`
// (plugins.ts) is the one list, and the host modules read that list instead of
// naming a domain each.
import type { Effects as Registry } from '@yaks/effects'
import type { Bundle, Graph, Query, Rule } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import type { Wake as Schedule } from '@yaks/wake'
import type { Objects } from '@yaks/blob'
import { PAGES } from './content.ts'
import type { App, Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
// The store's own bindings type. Type-only, so nothing here loads graph.ts:
// graph.ts reads this list (`rulesOf`, `effected`) and the shape it hands an
// effect is its own to say.
import type { Bindings } from './graph.ts'
import type { Page } from './guide.ts'
import type { Who } from './session.ts'
import type { Tool } from './tool.ts'
import type { Tools } from './lib/tools.ts'
import { caught } from './sentry.ts'

/**
 * An app's own door, as the request reaches a plugin: everything apps.ts had
 * in hand where the branch used to sit, including its two ways of answering
 * no — `refuse` for a caller who may not, `json` for anything else — so a
 * plugin's refusal is shaped the way every other refusal at that door is.
 */
export type Asked = {
  env: Env
  req: Request
  /** the path within the app's `/api/` prefix — `/stats`, not `/api/stats` */
  path: string
  space: Space
  app: App
  who: Who
  refuse: (what?: string) => Response
  json: (status: number, code: string, says?: string) => Response
}

/** A door a plugin answers, or `null` for a path that is not its business. */
export type Answer = (
  asked: Asked,
) => Promise<Response | null> | Response | null

/**
 * A request as the router holds it, before any part of the kernel has taken
 * it: the whole path on the hostname, and which space that hostname names —
 * `null` at the apex. Not `Route`'s `path` (route.ts), which is already the
 * path within an app; a door here sits above the app split and needs the
 * address as the client wrote it.
 */
export type Arrived = {
  env: Env
  req: Request
  /** the whole path on the hostname, as asked */
  path: string
  /** the space the hostname names, or null at the apex */
  space: string | null
}

/**
 * A door a plugin answers at the apex or on a space's hostname, or `null` for
 * a path that is not its business — the same way an `Answer` says no, so a
 * plugin has one shape for "not mine" wherever it sits.
 */
export type Door = (
  at: Arrived,
) => Promise<Response | null> | Response | null

/** A page an app served, and which app it was a page of. */
export type Visit = {
  env: Env
  req: Request
  res: Response
  at: { app: string; space: string; slug: string }
}

/**
 * What a plugin does about a served page. It runs on the way out of a request
 * that has already been answered, so it returns nothing and must not throw: a
 * counter is never a reason for a page not to arrive.
 */
export type Watch = (v: Visit) => void

/** A directory row a plugin seeds once, wearing the tags its rules match. */
export type Wake = Bundle & { wake: Schedule }

/** The change that brings the rows a plugin ships up to date in a store,
 * given a read of it and which store it is: nothing where they already match
 * (@yaks/connections `install`), and nothing in a store they are not for. */
export type Install = (
  read: (query: Query) => Bundle[] | Promise<Bundle[]>,
  at: Stored,
) => Bundle[] | Promise<Bundle[]>

/**
 * The store an effect is being registered in, said as what a plugin may know
 * about it (graph.ts `#boot`): the Worker's bindings, whether this is the
 * platform's own directory store rather than an app's, the app it holds, and
 * its two ways of writing.
 *
 * `mail` and `commands` are functions because the object learns them after it
 * wakes — its address from the requests it answers, its commands from a
 * deploy — so a registration reads them when the effect runs, never at boot.
 */
export type Stored = {
  env: Bindings
  /** the platform's own directory store, rather than an app's */
  meta: boolean
  /** the app this store holds, or null while it holds none */
  app: string | null
  /** the address a letter leaves this store under, asked at send time */
  mail: () => string | null
  /** the store's graph, whose writes are the kernel's own: the platform's
   * bookkeeping, which no person's level is asked about */
  graph: Graph
  /** a write as somebody (null: nobody signed in), held to what they may
   * write here as if they had sent it themselves */
  as: (who: string | null, bundles: Bundle[]) => Promise<Bundle[]>
  /** the app's own commands, as its manifest declares them now
   * (lib/tools.ts) */
  commands: () => Tools
  /** a failure noted in the app's break log and reported, never thrown */
  broke: (what: string, error: unknown) => void
}

/**
 * What a plugin does about data a store committed: registrations on that
 * store's own registry, made once per incarnation. It runs at boot, so it must
 * not throw — an effect a store cannot register is a store that will not
 * build.
 */
export type Effect = (on: Registry, at: Stored) => void

/**
 * One app's pinned bytes, as the retention sweep holds them (versions.ts
 * `pruned`): the store they are in, the app's own prefix in it, and the moment
 * the sweep is reckoning from.
 */
export type Swept = {
  dir: Directory
  blobs: Objects
  /** the app's own prefix in the blob store */
  prefix: string
  app: App
  /** the moment the sweep reckons age from */
  now: number
}

/**
 * The pinned blobs a plugin still names — bytes the sweep must keep because
 * something of the plugin's own points at them, which a manifest and a path's
 * history cannot say.
 *
 * A throw takes the sweep with it, deliberately: not knowing what is named is
 * never a reason to delete.
 */
export type Pins = (at: Swept) => Promise<Iterable<string>> | Iterable<string>

/** A self-contained contribution to this Worker. */
export type Plugin = {
  /** the plugin's name, for diagnostics and for the list to read as a list */
  name: string
  /** the components it adds to the directory's vocabulary */
  vocab?: VocabDoc[]
  /** the rows it adds to the connector's roster */
  tools?: Tool[]
  /** the guide pages it registers */
  pages?: Page[]
  /** the doors it answers at an app's address */
  answers?: Answer[]
  /** the doors it answers at the apex, or on a space's hostname before its
   * apps */
  routes?: Door[]
  /** what it does about a page an app served */
  watch?: Watch
  /** the rules it declares, run inside every store this Worker builds */
  rules?: Rule[]
  /** what it registers on a store's post-commit registry, once per boot */
  effects?: Effect[]
  /** schedules seeded once in the directory; existing rows keep their state */
  wakes?: Wake[]
  /** rows the directory holds as the plugin ships them, installed as the
   * kernel once per incarnation of the directory's store */
  installs?: Install[]
  /** the pinned bytes it still names, which the sweep must keep */
  pins?: Pins[]
}

/**
 * The row a guide page says about itself: the frontmatter of
 * `public/docs/<slug>.md` (M-34605), which is where a page's title, brief and
 * description live now. Naming a slug is the whole of registering a page — the
 * words are the page's own — and a slug no file answers to throws at module
 * load, which is the build and the test run.
 *
 * It sits here, below both, because guide.ts says the platform's pages with it
 * and a plugin says its own; the file it reads is generated (gen.ts), so
 * nothing in that direction can cycle.
 */
export let page = (slug: string): Page => {
  let row = PAGES[slug]
  if (!row) throw new Error(`public/docs/${slug}.md says nothing`)
  return row
}

/** Every vocabulary document a set of plugins contributes, in plugin order. */
export let vocabOf = (plugins: Plugin[]): VocabDoc[] =>
  plugins.flatMap((p) => p.vocab ?? [])

/** Every tool row, in plugin order — what the roster lists beside its own. */
export let toolsOf = (plugins: Plugin[]): Tool[] =>
  plugins.flatMap((p) => p.tools ?? [])

/** Every rule, in plugin order — what a store's graph is built with, beside
 * @yaks/graph's own (graph.ts `#boot`). */
export let rulesOf = (plugins: Plugin[]): Rule[] =>
  plugins.flatMap((p) => p.rules ?? [])

/**
 * Every sha any plugin still names for one app, as one set (versions.ts
 * `pruned`). Asked in plugin order and awaited one at a time: a sweep is a
 * background job, and a plugin reading its own store is a read the sweep can
 * wait for.
 */
export let pinsOf = async (
  plugins: Plugin[],
  at: Swept,
): Promise<Set<string>> => {
  let keep = new Set<string>()
  for (let p of plugins) {
    for (let pins of p.pins ?? []) for (let sha of await pins(at)) keep.add(sha)
  }
  return keep
}

/** Every schedule row, in plugin order, for the directory's first tick. */
export let wakesOf = (plugins: Plugin[]): Wake[] =>
  plugins.flatMap((p) => p.wakes ?? [])

/** Every install, in plugin order, for a store's first request. */
export let installsOf = (plugins: Plugin[]): Install[] =>
  plugins.flatMap((p) => p.installs ?? [])

/**
 * Register every plugin's effects on one store's registry, in plugin order
 * (graph.ts `#boot`). A store gets every plugin's — one about a component this
 * store does not speak never fires, the way an inert rule never matches — so
 * the list decides nothing but the order two handlers on one component run in.
 */
export let effected = (plugins: Plugin[], on: Registry, at: Stored) => {
  for (let p of plugins) for (let fx of p.effects ?? []) fx(on, at)
}

/** Every guide page, in plugin order. */
export let pagesOf = (plugins: Plugin[]): Page[] =>
  plugins.flatMap((p) => p.pages ?? [])

/**
 * Every plugin door, in plugin order, as one door: the first plugin to answer
 * wins, and `null` means no plugin claimed the path. Order is the list's, so
 * two plugins claiming one path is decided the way every other precedence
 * here is — by where they sit in `PLUGINS`.
 */
export let answered = async (
  plugins: Plugin[],
  asked: Asked,
): Promise<Response | null> => {
  for (let p of plugins) {
    for (let answer of p.answers ?? []) {
      let said = await answer(asked)
      if (said) return said
    }
  }
  return null
}

/**
 * The same fold over the root doors (index.ts `serve`), and the same rule: the
 * first plugin to answer wins, `null` means the kernel goes on to its own
 * table. It is asked ahead of the apps on a space's hostname — including the
 * home app, which otherwise answers every address no app claims (T-33040) — so
 * a door here claims a path an app cannot: a first segment carrying a dot is
 * no slug (route.ts `SLUG`), which is what makes `/<app>.git/*` sayable here
 * and unsayable by an app.
 */
export let routed = async (
  plugins: Plugin[],
  at: Arrived,
): Promise<Response | null> => {
  for (let p of plugins) {
    for (let door of p.routes ?? []) {
      let said = await door(at)
      if (said) return said
    }
  }
  return null
}

/**
 * Tell every watching plugin about a page that was served. One plugin falling
 * over is a log line and never the next one's problem, and never the page's:
 * this runs after the response is decided.
 */
export let watched = (plugins: Plugin[], v: Visit) => {
  for (let p of plugins) {
    try {
      p.watch?.(v)
    } catch (e) {
      caught(e, { request: `plugin ${p.name}` })
    }
  }
}
