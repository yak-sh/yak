// The subcommands a remote MCP server contributes: every tool `tools/list`
// names becomes a subcommand of the same name, with that tool's own input
// schema as its grammar and its own help page. This is what `yak` has always
// done; it is a separate module so that the account subcommands and the apps'
// commands can sit beside these in one list, all printed by one usage page.
//
// The tool list is fetched once and cached (store.ts), so it costs a round
// trip on a cold cache and nothing after that. What a tool result reports
// about that list on the way back is read here too — `printed` is the one
// place a tool's result becomes stdout, an exit code, and a cache that is
// still current.

import type { Command, Ctx } from './run.ts'
import { initialize, type Rpc } from './rpc.ts'
import { type Result, rosterAfter, saidBy } from './roster.ts'
import { cached, forget, remember, type Roster } from './store.ts'
import { type Listed, spelling } from './tool.ts'

/** The tool list for a host: the cached one, or an `initialize` handshake
 * followed by `tools/list`. The protocol version is negotiated on that same
 * path and cached beside the list. */
export let rosterOf = async (host: string, ask: Rpc): Promise<Roster> => {
  let kept = cached(host)
  if (kept) return kept
  let hello = await initialize(ask)
  let listed = await ask('tools/list')
  let roster: Roster = {
    protocol: String(hello.protocolVersion ?? ''),
    tools: (listed.tools ?? []) as Listed[],
  }
  remember(host, roster)
  return roster
}

/**
 * Print a tool's result, and the roster notice the server added beside it
 * (roster.ts). Returns the exit code. A caller holding no tool list passes
 * `null` — a staleness notice still drops the cache.
 */
export let printed = (
  c: Ctx,
  roster: Roster | null,
  name: string,
  said: Result,
): number => {
  let read = saidBy(said)
  let { text, stale } = read
  // What this result reported about the tool list this client is holding
  // (roster.ts). A staleness notice alone is enough to drop the cache; a
  // caller holding no list has nothing of its own to keep fresh, and must not
  // throw away somebody else's.
  if (stale) {
    forget(c.host)
    c.note(stale)
  } else if (roster) {
    let next = rosterAfter(roster, name, read)
    if (!next) forget(c.host)
    else if (next != roster) remember(c.host, next)
  }
  if (said.isError) {
    c.note(text || 'the tool erred and said nothing')
    return 1
  }
  if (c.json) c.out(JSON.stringify(said.structuredContent ?? said, null, 2))
  else if (text) c.out(text)
  return 0
}

// One tool the server listed, as a subcommand this program runs: its published
// input schema IS the command-line grammar, and running the subcommand makes
// the call. The tool's two words and its argument layout come along where it
// declared them (tool.ts `spelling`), so `yak task new 'ship it'` is typed the
// way the tool declared, and a server that declares neither still lists the
// tool under one flat name.
let toolOf = (roster: Roster, t: Listed): Command => ({
  name: t.name,
  ...spelling(t),
  ...(t.title ?? t.annotations?.title
    ? { title: t.title ?? t.annotations?.title }
    : {}),
  description: t.description ?? '',
  ...(t.inputSchema
    ? { inputSchema: t.inputSchema as Record<string, unknown> }
    : {}),
  run: async (args, c) =>
    printed(
      c,
      roster,
      t.name,
      await c.ask('tools/call', {
        name: t.name,
        arguments: args,
      }) as Result,
    ),
})

/** Every tool this server lists, as a subcommand. This is the list that costs
 * a round trip (run.ts `more`), so a command that never needs it pays
 * nothing. */
export let listed = async (c: Ctx): Promise<Command[]> => {
  let roster = await rosterOf(c.host, c.ask)
  return roster.tools.map((t) => toolOf(roster, t))
}
