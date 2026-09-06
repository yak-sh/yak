// The `yaks` command. It knows four verbs of its own — `help`, `login`,
// `logout`, `apply` — and every other subcommand is a tool the server listed.
// That is the whole design: the CLI reads `tools/list` at run time, so it
// cannot drift from the connector an agent is talking to, and a tool a release
// adds is a subcommand the day it ships without anybody publishing this
// package again.
//
//   yaks app_list
//   yaks app_files --app recipes --path index.html --content @index.html
//   yaks graph_query --q '.recipe!'
//   cat bundles.ndjson | yaks apply
//
// Exit codes are the contract a script reads: 0 said, 1 the tool or the door
// refused, 2 the command line was wrong.

import { argsFor, type Reads, saidIn, Usage } from './args.ts'
import { bundlesIn, chunks } from './apply.ts'
import { doorUrl, initialize, type Rpc, rpc } from './rpc.ts'
import {
  cached,
  forget,
  forgetToken,
  remember,
  type Roster,
  saveToken,
  tokenFor,
} from './store.ts'
import { type Result, rosterAfter, saidBy } from './roster.ts'
import { safe, toolHelp, toolLines } from './show.ts'
import type { Tool } from './tool.ts'

/** The platform this command talks to unless told otherwise. */
export let HOST = 'yaks.app'

let out = (line: string) => console.log(safe(line))
let note = (line: string) => console.error(safe(line))

let reads: Reads = {
  file: (path) => Deno.readTextFile(path),
  stdin: () => new Response(Deno.stdin.readable).text(),
}

/** The flags this program keeps for itself, lifted out of the line before a
 * tool ever sees it. */
export let globals = (
  argv: string[],
): { host: string; json: boolean; help: boolean; rest: string[] } => {
  let host = Deno.env.get('YAKS_HOST') ?? HOST
  let json = false
  let help = false
  let rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    if (a == '--json') json = true
    else if (a == '--help' || a == '-h') help = true
    else if (a == '--host') host = argv[++i] ?? host
    else if (a.startsWith('--host=')) host = a.slice(7)
    else rest.push(a)
  }
  return { host, json, help, rest }
}

// The tool list for a host: the cached one, or a handshake and a listing. The
// protocol version is negotiated on this same path and kept beside it.
let rosterOf = async (host: string, ask: Rpc): Promise<Roster> => {
  let kept = cached(host)
  if (kept) return kept
  let hello = await initialize(ask)
  let listed = await ask('tools/list')
  let roster: Roster = {
    protocol: String(hello.protocolVersion ?? ''),
    tools: (listed.tools ?? []) as Tool[],
  }
  remember(host, roster)
  return roster
}

let printed = (
  host: string,
  roster: Roster,
  name: string,
  said: Result,
  json: boolean,
): number => {
  let read = saidBy(said)
  let { text, stale } = read
  // What this result said about the list this client is holding (roster.ts).
  let next = rosterAfter(roster, name, read)
  if (!next) forget(host)
  else if (next != roster) remember(host, next)
  if (stale) note(stale)
  if (said.isError) {
    note(text || 'the tool erred and said nothing')
    return 1
  }
  if (json) {
    out(JSON.stringify(said.structuredContent ?? said, null, 2))
  } else if (text) out(text)
  return 0
}

let USAGE = `yaks — every tool this server lists, as a subcommand

  yaks                        what is here
  yaks help                   the tools, one line each
  yaks help <tool>            one tool's arguments
  yaks <tool> [--name value]  call it
  yaks apply [@file]          bundles as NDJSON, in batches of 50
  yaks login <token>          remember a bearer for this host
  yaks logout                 forget it

  --host <host>   which server (default $YAKS_HOST, else ${HOST})
  --json          print the structured result instead of the words
  --help          this, or a tool's own

A value that is @path is that file, and - is stdin. $YAKS_TOKEN is the
bearer when it is set; otherwise the one \`yaks login\` wrote.`

// `apply` is graph_apply with a door for a stream: a batch is atomic, and a
// file of bundles is a load rather than one batch, so it goes over in chunks.
let applied = async (
  ask: Rpc,
  host: string,
  roster: Roster,
  argv: string[],
  json: boolean,
): Promise<number> => {
  let tool = roster.tools.find((t) => t.name == 'graph_apply')
  if (!tool) throw new Usage(`${host} lists no graph_apply to apply through`)
  let { opts } = saidIn(argv)
  if (opts.some(([n]) => n == 'change')) {
    let said = await ask('tools/call', {
      name: tool.name,
      arguments: await argsFor(tool, argv, reads),
    }) as Result
    return printed(host, roster, tool.name, said, json)
  }
  let source = argv.find((a) => !a.startsWith('--')) ?? '-'
  let body = source == '-' || source == '@-'
    ? await reads.stdin()
    : await reads.file(source.replace(/^@/, ''))
  let batches = chunks(bundlesIn(body))
  let code = 0
  for (let change of batches) {
    let said = await ask('tools/call', {
      name: tool.name,
      arguments: { change },
    }) as Result
    code = printed(host, roster, tool.name, said, json) || code
    if (code) break
  }
  return code
}

/** Run one command line. Answers the exit code. */
export let run = async (argv: string[]): Promise<number> => {
  let { host, json, help, rest } = globals(argv)
  let [cmd, ...args] = rest

  // The one thing that must work with no network and nobody signed in.
  if (!cmd) {
    out(USAGE)
    return 0
  }
  if (cmd == 'login') {
    if (!args[0]) throw new Usage('yaks login <token>')
    out(`bearer for ${host} kept in ${saveToken(host, args[0])}`)
    return 0
  }
  if (cmd == 'logout') {
    forgetToken(host)
    out(`forgot the bearer for ${host}`)
    return 0
  }

  let ask = rpc({ url: doorUrl(host), token: tokenFor(host) })
  let roster = await rosterOf(host, ask)

  if (cmd == 'help') {
    if (!args[0]) {
      out(toolLines(roster.tools))
      return 0
    }
    let tool = roster.tools.find((t) => t.name == args[0])
    if (!tool) throw new Usage(`${host} lists no tool called ${args[0]}`)
    out(toolHelp(tool))
    return 0
  }

  if (cmd == 'apply') return await applied(ask, host, roster, args, json)

  let tool = roster.tools.find((t) => t.name == cmd)
  if (!tool) {
    throw new Usage(`${host} lists no tool called ${cmd} — try \`yaks help\``)
  }
  if (help) {
    out(toolHelp(tool))
    return 0
  }
  let said = await ask('tools/call', {
    name: tool.name,
    arguments: await argsFor(tool, args, reads),
  }) as Result
  return printed(host, roster, tool.name, said, json)
}

if (import.meta.main) {
  try {
    Deno.exit(await run(Deno.args))
  } catch (e) {
    note(`yaks: ${(e as Error).message}`)
    Deno.exit(e instanceof Usage ? 2 : 1)
  }
}
