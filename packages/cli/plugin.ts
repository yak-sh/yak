// Where a verb comes from. `yak` knows a few words of its own and gets every
// other one from a PLUGIN: a module the command imports, answering with a
// table of verbs when it is asked. A plugin is DATA — a name, the line its
// verbs sit under, and the verbs — so nothing here knows what any of them do,
// and one renderer draws built-ins and plugins as a single page.
//
// Two rules keep the merge readable. The FIRST plugin to name a verb wins, so
// the order a command registers them in IS the precedence: a table listed
// earlier shadows the same word below it, and a box that carries an extra
// plugin decides where it sits. And a plugin is asked for its table only until
// the word is found, so one that has to reach the network for its verbs (the
// tool list) costs nothing on a line that never reaches it — `yak login`
// still works with no server in sight.
//
// A STRAY is the other half: a first word no table named. `yak recipes
// add_recipe` is an app and its command, and only the plugin that knows about
// apps can say so, so it is asked last and only when nothing matched.

import type { Reads } from './args.ts'
import type { Rpc } from './rpc.ts'

/** What a verb is handed: the line it was given, the door, and where to
 * print. */
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

/** One word this command answers to. */
export type Verb = {
  name: string
  /** The argument sketch printed after the name. */
  args?: string
  /** The one line that says what it is. */
  about: string
  /** Its own page, for `yak help <verb>` and `yak <verb> --help`. */
  help?: (c: Ctx) => string | Promise<string>
  /** Do it; answer the exit code. */
  run: (c: Ctx) => number | Promise<number>
}

/** A set of verbs contributed at boot, under one heading. */
export type Plugin = {
  name: string
  /** The heading its verbs sit under in the usage. */
  about: string
  verbs: (c: Ctx) => Verb[] | Promise<Verb[]>
  /** A verb for a word nobody named. Asked only after every table has been. */
  stray?: (c: Ctx) => Verb | undefined | Promise<Verb | undefined>
}

/** One plugin's table, as the usage draws it, or why there is none. */
export type Part = { plugin: Plugin; verbs: Verb[]; why?: string }

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

/**
 * The verb a word names: the first plugin to name it, then the first to claim
 * it as a stray. Plugins are asked in order and no further.
 */
export let verbFor = async (
  plugins: Plugin[],
  c: Ctx,
  word: string,
): Promise<Verb | undefined> => {
  for (let p of plugins) {
    let hit = (await p.verbs(c)).find((v) => v.name == word)
    if (hit) return hit
  }
  for (let p of plugins) {
    let hit = await p.stray?.(c)
    if (hit) return hit
  }
}

/** The line to type, without the program's own name. */
export let lineOf = (v: Verb): string =>
  `${v.name}${v.args ? ` ${v.args}` : ''}`

// One column across every section, so the page reads as one page. Capped: a
// long sketch pushes its own line out rather than every other line.
let WIDE = 30

/**
 * The usage: each plugin's table under its heading, one column throughout. A
 * verb an earlier table already named is left out — it is unreachable, and a
 * page that lists a word twice with two meanings is a page that lies.
 */
export let usage = (parts: Part[]): string => {
  let seen = new Set<string>()
  let shown = parts.map((p) => ({
    ...p,
    verbs: p.verbs.filter((v) => !seen.has(v.name) && seen.add(v.name)),
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
          `  ${lineOf(v).padEnd(wide)}  ${v.about}`.trimEnd()
        ),
      ].join('\n')
    )
    .join('\n\n')
}

/** One verb's page: its own, or the two lines every verb can answer with. */
export let helpFor = (v: Verb, c: Ctx): string | Promise<string> =>
  v.help?.(c) ?? `yak ${lineOf(v)}\n\n  ${v.about}`
