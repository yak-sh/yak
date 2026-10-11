// The Worker's application contributions: connector tools, pages, doors and
// page watches. Store vocabulary, graph hooks and effect handlers compose from
// config.ts through @yaks/host's facets.
import type { Bundle, Graph } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import type { Wake as Schedule } from '@yaks/wake'
import type { Objects } from '@yaks/blob'
import { PAGES } from './content.ts'
import type { App, Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
// Type-only: application contributions do not load a Store.
import type { Bindings } from './graph.ts'
import type { Page } from './guide.ts'
import type { Who } from './session.ts'
import type { Tool } from './tool.ts'
import type { Tools } from '@yaks/tools/declared'
import { caught } from './defects.ts'

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
  /** a visitor's write, held to what every one is at this door: its size and
   * its pace. The refusal to answer with, or null for a member or a visit
   * within both. */
  visiting: (bytes: number) => Promise<Response | null>
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
   * write here as if they had sent it themselves; `via` is what it came
   * through, which its rows' `created.via` names: the transcript whose turn
   * a model's command ran in */
  as: (
    who: string | null,
    bundles: Bundle[],
    via?: string,
  ) => Promise<Bundle[]>
  /** the app's own commands, as its manifest declares them now
   * (@yaks/tools/declared) */
  commands: () => Tools
  /** a failure noted in the app's break log and reported, never thrown */
  broke: (what: string, error: unknown) => void
}

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
