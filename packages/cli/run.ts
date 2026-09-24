// One command line, run. `cli(commands, opts)` is the whole interface: hand
// it the commands and it reads the command line — the subcommand, either order
// of a two-word tool, the arguments through that tool's own input schema —
// runs the one it found, and returns the exit code.
//
// A command is a @yaks/graph `Tool` declaration and nothing else. There is no
// registration format between a tool and the command line that runs it: a
// program that wants more subcommands passes more commands, and the first to
// claim a name wins, so the order of the list is the precedence.
//
// Where a command runs is {@link aimed}: the graph a config file names, opened
// in this process, or an MCP server to call over `/mcp`. The file is the
// ordinary case — a graph this machine can open needs nothing listening — and
// an MCP server is for a graph it cannot open.
//
// Two things cost more to gather than a list does, and both are opts rather
// than commands. `more` is a list that has to be fetched — the tools of the
// graph this command opens, or an MCP server's `tools/list` — asked for only
// when the commands already in hand did not match the first word, so
// `yak login` still works with no graph in sight, and printed on the usage
// page as a reason when it cannot be had. `stray` is the other half: a first
// word nothing claimed. `yak recipes add_recipe` is an app and one of its
// commands, and only something that knows about apps can recognize that, so it
// is asked last and only when nothing else matched.

import type { Tool, ToolId } from '@yaks/graph'
import { argsFor, type Grammar, type Reads, Usage } from './args.ts'
import { lineOf, safe, sketch, toolHelp } from './show.ts'
import { commandOf, titleOf } from './tool.ts'
import { doorUrl, type Rpc, rpc, timed } from './rpc.ts'
import { configPath } from './config.ts'
import { tokenFor } from './store.ts'

/** What a command is handed: where it runs, where to print, and the global
 * flags. */
export type Ctx = {
  /** The MCP server this command talks to, where it talks to one — and the
   * name its bearer token is stored under either way. */
  host: string
  /** The config file naming the graph this command opens, in this process.
   * Absent where the command named an MCP server instead ({@link aimed}). */
  config?: string
  /** Whether the graph this command opens runs its duties — false under
   * `--no-duties`, which takes no lease and runs none of them. */
  duties: boolean
  json: boolean
  help: boolean
  ask: Rpc
  reads: Reads
  out: (line: string) => void
  note: (line: string) => void
  /** Every command this run can reach, including the ones that cost a
   * composition or a round trip. Gathered once; a list that cannot be fetched
   * is left out. */
  all: () => Promise<Command[]>
  /** The usage page — every tool one line each, and why a list is missing. */
  page: () => Promise<string>
}

/**
 * One command this program can run: a tool's declaration — its name, its
 * schema, how it is written on a command line — with a run of its own.
 *
 * A graph tool is `run(call, graph) → bundles` and only @yaks/tools' runner
 * calls one. A command is the other end: it takes the arguments parsed off the
 * command line, prints, and returns an exit code. The same declaration, so a
 * command is listed, helped and tab-completed from the one schema; a different
 * run, because a command line is not a tool call. `yak <tool>` is a command
 * wrapping a call — local.ts writes one against the graph this command opened,
 * platform.ts sends one to the MCP server it named.
 */
export type Command = Omit<Tool<number>, 'run'> & {
  run: (
    args: Record<string, unknown>,
    c: Ctx,
  ) => number | Promise<number>
}

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
  /** The MCP server a command talks to where it names neither a config nor a
   * host. */
  host?: string
  /** More commands, where gathering them costs a composition or a round
   * trip. */
  more?: (c: Ctx) => Command[] | Promise<Command[]>
  /** A command for a first word nothing else claimed. */
  stray?: (
    word: string,
    args: string[],
    c: Ctx,
  ) => Command | undefined | Promise<Command | undefined>
  /** How a JSON-RPC request is sent, where a program has a caller of its own
   * — a test passes a function that records what it was asked. */
  ask?: Rpc
  /** Where a value written `@path` or `-` is read from. */
  reads?: Reads
  out?: (line: string) => void
  note?: (line: string) => void
}

/**
 * The tools, refused where two of them answer to one command line. A two-word
 * tool is reachable in either order, so `session list` and `list session` are
 * the same tool, and a second tool using either pair is a command line that
 * means two things.
 *
 * `cli` does not apply this to the whole list, because shadowing is the point
 * of the order: a program that carries its own `login` means it. A contributor
 * runs this over its own list, where two tools of one name are a mistake.
 */
export let unique = <T extends ToolId>(tools: readonly T[]): readonly T[] => {
  let said = new Set<string>()
  for (let t of tools) {
    let words = t.noun && t.verb
      ? [`${t.noun} ${t.verb}`, `${t.verb} ${t.noun}`]
      : [commandOf(t)]
    if (!words[0]) throw new Error('a tool needs a name, or a noun and a verb')
    for (let w of new Set(words)) {
      if (said.has(w)) throw new Error(`two tools answer to: ${w}`)
      said.add(w)
    }
  }
  return tools
}

/**
 * The tool a command line names, and the words left for its schema. A two-word
 * tool takes the word after it in either order; a one-word tool takes none.
 *
 * ```ts
 * commandFor([{noun: 'session', verb: 'list', description: '', run: () => 0}],
 *   ['list', 'session', '--all'])?.args // ['--all']
 * ```
 */
export let commandFor = <T extends ToolId>(
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
    } else if (commandOf(t) == word) return { verb: t, args: argv.slice(1) }
  }
}

// One column across the page, so it reads as one page. Capped: a long
// argument sketch pushes its own line out rather than every other line.
let WIDE = 30

/** One tool per listed name, in the order they were given: where two answer
 * to one command line, the first one wins. */
let once = <T extends Grammar>(tools: readonly T[]): T[] => {
  let seen = new Set<string>()
  return tools.filter((t) => !seen.has(commandOf(t)) && seen.add(commandOf(t)))
}

/**
 * The tools grouped under the noun each is typed with: `graph` holds `apply`,
 * `query` and the rest, and a tool that declared one word alone — or none — is
 * grouped under `''`, which is the page's own first block. Nouns come in the
 * order they were first named, so the order of the list is still the order of
 * the page.
 *
 * ```ts
 * nouns([{ noun: 'graph', verb: 'apply', description: '', run: () => 0 }])
 *   .map(([noun]) => noun) // ['graph']
 * ```
 */
export let nouns = <T extends Grammar>(
  tools: readonly T[],
): [string, T[]][] => {
  let by = new Map<string, T[]>([['', []]])
  for (let t of once(tools)) {
    let noun = t.noun && t.verb ? t.noun : ''
    let said = by.get(noun) ?? []
    by.set(noun, said)
    said.push(t)
  }
  return [...by].filter(([, said]) => said.length)
}

type Listed = Grammar & { title?: string; description?: string }

// The line to type, with the heading's own word left out: under `graph`, a
// tool is its verb and its arguments.
let lineIn = (noun: string, t: Listed): string =>
  noun ? `${t.verb} ${sketch(t)}`.trimEnd() : lineOf(t)

let block = (noun: string, said: Listed[], wide: number): string[] => [
  ...(noun ? ['', noun] : []),
  ...said.map((t) =>
    `  ${lineIn(noun, t).padEnd(wide)}  ${titleOf(t)}`.trimEnd()
  ),
]

// How wide the one column is across every block: the longest line it holds,
// capped.
let column = (groups: [string, Listed[]][]): number =>
  Math.min(
    WIDE,
    Math.max(
      0,
      ...groups.flatMap(([noun, said]) =>
        said.map((t) => lineIn(noun, t).length)
      ),
    ),
  )

/** Every tool, one line each, its verbs grouped under their noun. */
export let usage = (
  tools: readonly Listed[],
  opts: Opts = {},
): string => {
  let groups = nouns(tools)
  let wide = column(groups)
  return [
    ...(opts.about ? [opts.about, ''] : []),
    ...groups.flatMap(([noun, said]) => block(noun, said, wide)),
    ...(opts.notes ? ['', opts.notes] : []),
  ].join('\n')
}

/** One noun's own page: its verbs, one line each, under the word itself —
 * what `yak graph` and `yak graph --help` print. Nothing where no tool here is
 * typed under that word. */
export let nounUsage = (
  tools: readonly Listed[],
  word: string,
): string | undefined => {
  let said = nouns(tools).find(([noun]) => noun && noun == word)
  if (!said) return undefined
  return block(said[0], said[1], column([said])).slice(1).join('\n')
}

/** The flags a program keeps for itself, lifted off the command line before a
 * command ever sees it. `host` and `config` are what the command line gave and
 * nothing else — where a command runs when it gives neither is
 * {@link aimed}'s answer. */
export let globals = (
  argv: readonly string[],
): {
  host?: string
  config?: string
  duties: boolean
  json: boolean
  help: boolean
  timing: boolean
  rest: string[]
} => {
  let host: string | undefined
  let json = false
  let duties = true
  let help = false
  let config: string | undefined
  // A whole shell asks for the timing line with YAKS_TIMING=1; one command
  // asks with the flag.
  let timing = Deno.env.get('YAKS_TIMING') == '1'
  let rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    if (a == '--json') json = true
    else if (a == '--no-duties') duties = false
    else if (a == '--help' || a == '-h') help = true
    else if (a == '--timing') timing = true
    else if (a == '--host') host = argv[++i] ?? host
    else if (a.startsWith('--host=')) host = a.slice(7)
    else if (a == '--config') config = argv[++i] ?? config
    else if (a.startsWith('--config=')) config = a.slice(9)
    else rest.push(a)
  }
  return { host, config, duties, json, help, timing, rest }
}

/**
 * Where this command runs what it was asked: the graph a config file names,
 * which it opens in this process, or an MCP server it calls over `/mcp`.
 *
 * A config names A graph. `yak --config yak.json task list` reads that file,
 * composes its plugins over the SQLite file it names, runs the tool here and
 * exits — no server, and nothing to wait for. `--host` is for a graph this
 * machine cannot open as a file; given together the two name two places, which
 * is a command line that means two things.
 *
 * In order: `--config`, `--host`, `$YAKS_HOST`, `$YAK_CONFIG`, the config this
 * machine keeps for its own graph (`~/.yak/yak.json`), and the platform this
 * program came with. A host name comes back either way, because it is also the
 * name a bearer token is stored under.
 *
 * ```ts
 * aimed({ host: 'yaks.app' }) // { host: 'yaks.app' }
 * ```
 */
export let aimed = (
  said: { host?: string; config?: string },
  dflt = 'yaks.app',
): { config?: string; host: string } => {
  if (said.host && said.config) {
    throw new Usage('--host and --config name two places — a line names one')
  }
  if (said.config) return { config: said.config, host: dflt }
  let door = said.host ?? Deno.env.get('YAKS_HOST')
  if (door) return { host: door }
  let path = configPath()
  return path ? { config: path, host: dflt } : { host: dflt }
}

/**
 * The run this command line is part of, as the environment names it: a harness
 * sets it, every shell and hook under that harness inherits it, and a write
 * made from any of them carries the transcript that produced it without
 * anybody passing a flag. It is sent in the `x-via` header, which the server
 * resolves to the session, and what the command writes is signed with it
 * (@yaks/session/routes).
 *
 * The variable names are the harnesses' own, read most specific first: a
 * subagent's own id before the tree it was spawned from.
 */
export let via = (
  env: (name: string) => string | undefined = (n) => Deno.env.get(n),
): string | undefined =>
  env('CLAUDE_CODE_SESSION_ID') ?? env('TASKS_SESSION') ??
    env('CODEX_THREAD_ID')

let disk: Reads = {
  file: (path) => Deno.readTextFile(path),
  stdin: () => new Response(Deno.stdin.readable).text(),
}

/**
 * Run one command line. Returns the exit code a script reads: 0 succeeded, 1
 * the tool or the server refused, 2 the command line was wrong.
 */
export let cli = async (
  tools: readonly Command[],
  opts: Opts = {},
): Promise<number> => {
  let out = opts.out ?? ((line: string) => console.log(safe(line)))
  let note = opts.note ?? ((line: string) => console.error(safe(line)))
  let said = globals(opts.argv ?? Deno.args)
  let { duties, json, help, timing, rest } = said
  try {
    // Where this command runs: a file it opens, or an MCP server it calls. A
    // command line naming both is refused here, like any other that means two
    // things.
    let { config, host } = aimed(said, opts.host ?? 'yaks.app')
    // A list that cannot be fetched is a reason printed on the page, not a
    // page nobody gets: `yak` with no argument is what a person types when
    // nothing works.
    let extra: Command[] | undefined
    let why: string | undefined
    let fetched = async (): Promise<Command[]> => {
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
      duties,
      json,
      help,
      ask: opts.ask ?? rpc({
        url: doorUrl(host),
        token: tokenFor(host),
        via: via(),
        fetch: timing ? timed(note) : undefined,
      }),
      reads: opts.reads ?? disk,
      out,
      note,
      all: async () => [...tools, ...await fetched()],
      page: async () =>
        usage(await c.all(), opts) + (why ? `\n\n  (${why})` : ''),
    }
    // The one thing that must work with no network and nobody signed in.
    if (!rest.length) {
      out(await c.page())
      return 0
    }
    let found = commandFor(tools, rest) ??
      commandFor(await fetched(), rest) ??
      await (async () => {
        let hit = await opts.stray?.(rest[0], rest.slice(1), c)
        return hit ? { verb: hit, args: rest.slice(1) } : undefined
      })()
    if (!found) {
      // A noun on its own is a question, not a mistake: `yak graph` (and
      // `yak graph --help`, which is the same command line with the flag
      // lifted off) asks what that word can do, and the answer is its verbs.
      let page = nounUsage(await c.all(), rest[0])
      if (page) {
        out(page)
        return 0
      }
      throw new Usage(
        `${config ?? host} has nothing called ${rest[0]} — try \`${
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

/** The `help` command every program here carries: the whole usage page, or
 * one subcommand's own. */
export let helpTool = (opts: Opts = {}): Command => ({
  name: 'help',
  description: 'every command, one line each — or one command’s own page',
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
    let found = commandFor(await c.all(), words)
    if (found) {
      c.out(toolHelp(found.verb, opts.name))
      return 0
    }
    // `yak help graph` is the same question `yak graph` asks: the verbs that
    // word holds.
    let page = nounUsage(await c.all(), words[0])
    if (!page) throw new Usage(`nothing here is called ${words[0]}`)
    c.out(page)
    return 0
  },
})
