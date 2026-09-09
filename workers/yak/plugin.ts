// What a DOMAIN of this Worker contributes to the host, as data. The Worker is
// well split into files by domain already; what it lacked was a way for a
// domain to say what it brings without every host module naming it back. So
// this is the shape @yaks/graph's own `Plugin` has (packages/graph/plugin.ts) —
// a plain object of optional slots, plus a combinator per slot — said in the
// terms a Worker has rather than the terms `apply()` has.
//
// The slots are EXTRACTED, not invented: each one is a thing a domain file in
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
//   rules    what it does INSIDE a store, as data: a query over one bundle in
//            a batch plus what comes out (@yaks/graph `Rule`), run by the phase
//            it names in every store this Worker builds (graph.ts `#boot`)
//   wakes    rows seeded once in the directory: when to write `fired`, with
//            the tags the plugin's effect rules match beside it
//
// `rules` is the one slot that is not an extraction: it is @yaks/graph's own
// phase seam, offered here so a domain says what it does about a WRITE in the
// same object it says its words and its rows in. A rule about a component a
// store does not speak is inert there (@yaks/graph rules.ts), which is what
// lets one list serve the directory and every app store alike.
//
// A plugin holds no state and is composed once, at module load — `PLUGINS`
// (plugins.ts) is the one list, and the host modules read that list instead of
// naming a domain each.
import type { Bundle, Rule } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import type { Wake as Schedule } from '@yaks/wake'
import { PAGES } from './content.ts'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import type { Page } from './guide.ts'
import type { Who } from './session.ts'
import type { Tool } from './tool.ts'

/**
 * An app's own door, as the request reaches a plugin: everything apps.ts had
 * in hand where the branch used to sit, including its two ways of answering
 * no — `refuse` for a caller who may not, `json` for anything else — so a
 * plugin's refusal is spelled the way every other refusal at that door is.
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
 * A request as the ROUTER holds it, before any part of the kernel has taken
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
  /** schedules seeded once in the directory; existing rows keep their state */
  wakes?: Wake[]
}

/**
 * The row a guide page says about ITSELF: the frontmatter of
 * `public/guide/<slug>.md` (M-34605), which is where a page's title, brief and
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
  if (!row) throw new Error(`public/guide/${slug}.md says nothing`)
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

/** Every schedule row, in plugin order, for the directory's first tick. */
export let wakesOf = (plugins: Plugin[]): Wake[] =>
  plugins.flatMap((p) => p.wakes ?? [])

/** Every guide page, in plugin order. */
export let pagesOf = (plugins: Plugin[]): Page[] =>
  plugins.flatMap((p) => p.pages ?? [])

/**
 * Every plugin door, in plugin order, as ONE door: the first plugin to answer
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
 * The same fold over the ROOT doors (index.ts `serve`), and the same rule: the
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
      console.log(`plugin ${p.name}: ${(e as Error).message}`)
    }
  }
}
