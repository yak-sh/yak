// One command line, run. `cli(tools, opts)` is the whole seam: hand it the
// tools and it reads the line — the word, either order of a two-word tool, the
// arguments through that tool's own input schema — runs the one it found, and
// answers the exit code.
//
// A tool is a @yaks/graph `Tool` and nothing else. There is no registration
// shape between a tool and the command that runs it: a program that wants more
// words passes more tools, and the FIRST tool to name a word wins, so the
// order of the list IS the precedence.
//
// Two things cost more than a list does, and both are opts rather than tools.
// `more` is a table that has to be fetched — a server's `tools/list` — asked
// only when the tools in hand did not name the word, so `yak login` still
// works with no server in sight, and drawn into the page as a reason when it
// cannot be had. `stray` is the other half: a first word nobody named. `yak
// recipes add_recipe` is an app and its command, and only something that knows
// about apps can say so, so it is asked last and only when nothing matched.

import type { Tool, ToolId } from '@yaks/graph'
import { argsFor, type Grammar, type Reads, Usage } from './args.ts'
import { lineOf, safe, toolHelp } from './show.ts'
import { titleOf, wordOf } from './tool.ts'
import { doorUrl, type Rpc, rpc, timed } from './rpc.ts'
import { tokenFor } from './store.ts'

/** What a tool is handed: the door, where to print, and the line's globals. */
export type Ctx = {
  /** The server this line is aimed at. */
  host: string
  /** The config file naming a LOCAL host, where the line is aimed at one:
   * `--config`, else `$YAK_CONFIG` (serve.ts). */
  config?: string
  json: boolean
  help: boolean
  ask: Rpc
  reads: Reads
  out: (line: string) => void
  note: (line: string) => void
  /** Every tool this run can reach, the ones that cost a round trip included.
   * Asked once; a table that cannot be had is simply absent. */
  all: () => Promise<Tool<Ctx, number>[]>
  /** The usage page — every tool one line each, and why a table is missing. */
  page: () => Promise<string>
}

/** A word this command runs. */
export type Word = Tool<Ctx, number>

/** What a program brings besides its tools. */
export type Opts = {
  /** The words to read. Defaults to `Deno.args`. */
  argv?: string[]
  /** What the program calls itself, in its usage and its help pages. */
  name?: string
  /** The line the usage page opens with. */
  about?: string
  /** The notes it closes with. */
  notes?: string
  /** The server a line is aimed at unless `--host` says otherwise. */
  host?: string
  /** A table that costs a round trip. */
  more?: (c: Ctx) => Word[] | Promise<Word[]>
  /** A tool for a first word nobody named. */
  stray?: (
    word: string,
    args: string[],
    c: Ctx,
  ) => Word | undefined | Promise<Word | undefined>
  /** The door, where a program has one of its own — a test hands over a
   * function that records what it was asked. */
  ask?: Rpc
  /** Where a value that is `@path` or `-` comes from. */
  reads?: Reads
  out?: (line: string) => void
  note?: (line: string) => void
}

/**
 * The tools, refused where two of them answer to one line. A two-word tool is
 * reachable in EITHER order, so `session list` and `list session` are the same
 * tool and a second tool spelling either pair is a line that means two things.
 *
 * `cli` does NOT apply this to the whole list, because shadowing is the point
 * of the order: a box that carries its own `login` means it. A contributor
 * runs it over its OWN table, where two words the same is a mistake.
 */
export let unique = <T extends ToolId>(tools: readonly T[]): readonly T[] => {
  let said = new Set<string>()
  for (let t of tools) {
    let words = t.noun && t.verb
      ? [`${t.noun} ${t.verb}`, `${t.verb} ${t.noun}`]
      : [wordOf(t)]
    if (!words[0]) throw new Error('a tool needs a name, or a noun and a verb')
    for (let w of new Set(words)) {
      if (said.has(w)) throw new Error(`two tools answer to: ${w}`)
      said.add(w)
    }
  }
  return tools
}

/**
 * The tool a line names, and the words left for its schema. A two-word tool
 * takes the word after it in either order; a one-word tool takes none.
 *
 * ```ts
 * wordFor([{noun: 'session', verb: 'list', description: '', run: () => 0}],
 *   ['list', 'session', '--all'])?.args // ['--all']
 * ```
 */
export let wordFor = <T extends ToolId>(
  tools: readonly T[],
  argv: readonly string[],
): { verb: T; args: string[] } | undefined => {
  let [word, next] = argv
  if (!word) return undefined
  for (let t of tools) {
    if (t.noun && t.verb) {
      if (
        (t.noun == word && t.verb == next) || (t.verb == word && t.noun == next)
      ) return { verb: t, args: argv.slice(2) }
    } else if (wordOf(t) == word) return { verb: t, args: argv.slice(1) }
  }
}

// One column across the page, so it reads as one page. Capped: a long sketch
// pushes its own line out rather than every other line.
let WIDE = 30

/** Every tool, one line each, in the order they were given. */
export let usage = (
  tools: readonly (Grammar & { title?: string; description?: string })[],
  opts: Opts = {},
): string => {
  let seen = new Set<string>()
  let shown = tools.filter((t) => !seen.has(wordOf(t)) && seen.add(wordOf(t)))
  let wide = Math.min(WIDE, Math.max(0, ...shown.map((t) => lineOf(t).length)))
  return [
    ...(opts.about ? [opts.about, ''] : []),
    ...shown.map((t) => `  ${lineOf(t).padEnd(wide)}  ${titleOf(t)}`.trimEnd()),
    ...(opts.notes ? ['', opts.notes] : []),
  ].join('\n')
}

/** The flags a program keeps for itself, lifted off the line before a tool
 * ever sees it. */
export let globals = (
  argv: readonly string[],
  host = 'yaks.app',
): {
  host: string
  config?: string
  json: boolean
  help: boolean
  timing: boolean
  rest: string[]
} => {
  let json = false
  let help = false
  let config: string | undefined
  // A whole shell asks for the timing line with YAKS_TIMING=1; one command
  // asks with the flag.
  let timing = Deno.env.get('YAKS_TIMING') == '1'
  let rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    if (a == '--json') json = true
    else if (a == '--help' || a == '-h') help = true
    else if (a == '--timing') timing = true
    else if (a == '--host') host = argv[++i] ?? host
    else if (a.startsWith('--host=')) host = a.slice(7)
    else if (a == '--config') config = argv[++i] ?? config
    else if (a.startsWith('--config=')) config = a.slice(9)
    else rest.push(a)
  }
  return { host, config, json, help, timing, rest }
}

/** Where a LOCAL host's config is: what the line said, else `$YAK_CONFIG`. */
export let configPath = (said?: string): string | undefined =>
  said ?? Deno.env.get('YAK_CONFIG') ?? undefined

let disk: Reads = {
  file: (path) => Deno.readTextFile(path),
  stdin: () => new Response(Deno.stdin.readable).text(),
}

/**
 * Run one command line. Answers the exit code a script reads: 0 said, 1 the
 * tool or the door refused, 2 the line was wrong.
 */
export let cli = async (
  tools: readonly Word[],
  opts: Opts = {},
): Promise<number> => {
  let out = opts.out ?? ((line: string) => console.log(safe(line)))
  let note = opts.note ?? ((line: string) => console.error(safe(line)))
  let { host, config, json, help, timing, rest } = globals(
    opts.argv ?? Deno.args,
    Deno.env.get('YAKS_HOST') ?? opts.host ?? 'yaks.app',
  )
  // A table that cannot be had is a reason on the page, not a page nobody
  // gets: `yak` with no argument is what a person types when nothing works.
  let extra: Word[] | undefined
  let why: string | undefined
  let fetched = async (): Promise<Word[]> => {
    if (extra || !opts.more) return extra ?? []
    try {
      extra = [...await opts.more(c)]
    } catch (e) {
      extra = []
      why = (e as Error).message
    }
    return extra
  }
  let c: Ctx = {
    host,
    config,
    json,
    help,
    ask: opts.ask ?? rpc({
      url: doorUrl(host),
      token: tokenFor(host),
      fetch: timing ? timed(note) : undefined,
    }),
    reads: opts.reads ?? disk,
    out,
    note,
    all: async () => [...tools, ...await fetched()],
    page: async () =>
      usage(await c.all(), opts) + (why ? `\n\n  (${why})` : ''),
  }
  try {
    // The one thing that must work with no network and nobody signed in.
    if (!rest.length) {
      out(await c.page())
      return 0
    }
    let found = wordFor(tools, rest) ??
      wordFor(await fetched(), rest) ??
      await (async () => {
        let hit = await opts.stray?.(rest[0], rest.slice(1), c)
        return hit ? { verb: hit, args: rest.slice(1) } : undefined
      })()
    if (!found) {
      throw new Usage(
        `${host} has nothing called ${rest[0]} — try \`${
          opts.name ?? 'yak'
        } help\``,
      )
    }
    if (help) {
      out(toolHelp(found.verb, opts.name))
      return 0
    }
    return await found.verb.run(
      await argsFor(found.verb, found.args, c.reads),
      c,
    )
  } catch (e) {
    note(`${opts.name ?? 'yak'}: ${(e as Error).message}`)
    return e instanceof Usage ? 2 : 1
  }
}

/** The `help` tool every program here carries: the page, or one word's own. */
export let helpTool = (opts: Opts = {}): Word => ({
  name: 'help',
  description: 'every word, one line each — or one word’s own page',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { words: { type: 'array', items: { type: 'string' } } },
  },
  options: { rest: 'words' },
  readOnly: true,
  run: async (args, c) => {
    let words = (args.words ?? []) as string[]
    if (!words.length) {
      c.out(await c.page())
      return 0
    }
    let found = wordFor(await c.all(), words)
    if (!found) throw new Usage(`nothing here is called ${words[0]}`)
    c.out(toolHelp(found.verb, opts.name))
    return 0
  },
})
