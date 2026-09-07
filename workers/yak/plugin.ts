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
//   watch    what a plugin does about a page an app served (apps.ts `viewed`)
//
// There is deliberately NO sweep slot. `scheduled` in index.ts fires the meter
// and the trash collection, and neither is a plugin yet; a slot with no
// contributor is a guess about the next domain rather than an extraction from
// this one. The day a plugin has a sweep, it is four lines here and a fold in
// index.ts.
//
// A plugin holds no state and is composed once, at module load — `PLUGINS`
// (plugins.ts) is the one list, and the host modules read that list instead of
// naming a domain each.
import type { VocabDoc } from '@yaks/vocab'
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
  /** what it does about a page an app served */
  watch?: Watch
}

/** Every vocabulary document a set of plugins contributes, in plugin order. */
export let vocabOf = (plugins: Plugin[]): VocabDoc[] =>
  plugins.flatMap((p) => p.vocab ?? [])

/** Every tool row, in plugin order — what the roster lists beside its own. */
export let toolsOf = (plugins: Plugin[]): Tool[] =>
  plugins.flatMap((p) => p.tools ?? [])

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
