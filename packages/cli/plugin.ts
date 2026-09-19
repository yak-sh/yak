// Where a verb comes from. `yak` knows a few words of its own and gets every
// other one from a PLUGIN: a module the command imports, answering with a
// table of TOOLS when it is asked. A plugin is DATA — a name, the line its
// tools sit under, and the tools — so nothing here knows what any of them do,
// and one renderer draws built-ins and plugins as a single page.
//
// A tool is a @yaks/graph `Tool` and nothing else: noun, verb, description,
// input schema, run. That is the same declaration an MCP transport lists and
// an app ships in its vocabulary, so a word reaches a command line, an agent
// and a completion from one place. What a CLI tool is HANDED is this package's
// `Ctx` and what it answers with is an exit code — the two things a command
// line has that a graph does not — which is what `Tool<Ctx, number>` says.
//
// Two rules keep the merge readable. The FIRST plugin to name a word wins, so
// the order a command registers them in IS the precedence: a table listed
// earlier shadows the same word below it, and a box that carries an extra
// plugin decides where it sits. And a plugin is asked for its table only until
// the word is found, so one that has to reach the network for its tools (the
// tool list) costs nothing on a line that never reaches it — `yak login`
// still works with no server in sight.
//
// A STRAY is the other half: a first word no table named. `yak recipes
// add_recipe` is an app and its command, and only the plugin that knows about
// apps can say so, so it is asked last and only when nothing matched.

import type { Tool } from '@yaks/graph'
import type { Reads } from './args.ts'
import type { Rpc } from './rpc.ts'
import { lineOf } from './show.ts'
import { titleOf, wordOf } from './tool.ts'

/** What a tool is handed: the door, where to print, and the line's globals. */
export type Ctx = {
  /** The server this line is aimed at. */
  host: string
  /** The verb as it was typed — an app's name, where nothing claimed it. */
  word: string
  /** The words after it, globals already lifted out. */
  args: string[]
  json: boolean
  help: boolean
  ask: Rpc
  reads: Reads
  out: (line: string) => void
  note: (line: string) => void
  /** Every plugin this run is carrying, in precedence order. */
  plugins: Plugin[]
}

/** A set of tools contributed at boot, under one heading. */
export type Plugin = {
  name: string
  /** The heading its tools sit under in the usage. */
  about: string
  verbs: (c: Ctx) => Tool<Ctx, number>[] | Promise<Tool<Ctx, number>[]>
  /** A tool for a word nobody named. Asked only after every table has been. */
  stray?: (
    c: Ctx,
  ) =>
    | Tool<Ctx, number>
    | undefined
    | Promise<Tool<Ctx, number> | undefined>
}

/** One plugin's table, as the usage draws it, or why there is none. */
export type Part = {
  plugin: Plugin
  verbs: Tool<Ctx, number>[]
  why?: string
}

/**
 * Every plugin's table, in order — what a usage page is made of. A plugin
 * that cannot answer says so in its own section rather than taking the page
 * down with it: `yak` with no argument is what a person types when nothing is
 * working, and a tool list needs a server to come from.
 */
export let parts = (plugins: Plugin[], c: Ctx): Promise<Part[]> =>
  Promise.all(plugins.map(async (plugin) => {
    try {
      return { plugin, verbs: await plugin.verbs(c) }
    } catch (e) {
      return { plugin, verbs: [], why: (e as Error).message }
    }
  }))

/** A word resolved: the tool it named, and the words left for its schema. */
export type Found = { verb: Tool<Ctx, number>; args: string[] }

/**
 * The tool a word names: the first plugin to name it, then the first to claim
 * it as a stray. Plugins are asked in order and no further. A two-word tool
 * answers to EITHER order — `harness session list` and `harness list session`
 * are the same tool — so the word after it is consulted where there is one,
 * and whichever words the name took are gone from what the schema then reads.
 */
export let verbFor = async (
  plugins: Plugin[],
  c: Ctx,
  word: string,
): Promise<Found | undefined> => {
  let next = c.args[0]
  for (let p of plugins) {
    for (let t of await p.verbs(c)) {
      if (t.noun && t.verb) {
        let pair = (t.noun == word && t.verb == next) ||
          (t.verb == word && t.noun == next)
        if (pair) return { verb: t, args: c.args.slice(1) }
      } else if (wordOf(t) == word) return { verb: t, args: c.args }
    }
  }
  for (let p of plugins) {
    let hit = await p.stray?.(c)
    if (hit) return { verb: hit, args: c.args }
  }
}

// One column across every section, so the page reads as one page. Capped: a
// long sketch pushes its own line out rather than every other line.
let WIDE = 30

/**
 * The usage: each plugin's table under its heading, one column throughout. A
 * word an earlier table already named is left out — it is unreachable, and a
 * page that lists a word twice with two meanings is a page that lies.
 */
export let usage = (parts: Part[]): string => {
  let seen = new Set<string>()
  let shown = parts.map((p) => ({
    ...p,
    verbs: p.verbs.filter((v) => !seen.has(wordOf(v)) && seen.add(wordOf(v))),
  }))
  let all = shown.flatMap((p) => p.verbs.map((v) => lineOf(v).length))
  let wide = Math.min(WIDE, Math.max(0, ...all))
  return shown
    .filter((p) => p.verbs.length || p.why)
    .map((p) =>
      [
        p.plugin.about,
        ...(p.why ? [`  (${p.why})`] : []),
        ...p.verbs.map((v) =>
          `  ${lineOf(v).padEnd(wide)}  ${titleOf(v)}`.trimEnd()
        ),
      ].join('\n')
    )
    .join('\n\n')
}
