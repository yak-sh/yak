// The plugin that is the server: every tool `tools/list` names, as a verb of
// the same name, with its own schema for a grammar and its own help. This is
// what `yak` has always done — it is a plugin now so that the account verbs
// and the apps' commands can sit beside it in one table, all rendered by one
// usage.
//
// The list is read once and cached (store.ts), so the table costs a round trip
// on a cold cache and nothing after. What a result says about that list on the
// way back through is read here too — `printed` is the one place a tool's
// answer becomes stdout, an exit code, and a cache that is still true.

import { argsFor } from './args.ts'
import type { Ctx, Plugin, Verb } from './plugin.ts'
import { initialize, type Rpc } from './rpc.ts'
import { type Result, rosterAfter, saidBy } from './roster.ts'
import { toolHelp } from './show.ts'
import { cached, forget, remember, type Roster } from './store.ts'
import { titleOf, type Tool } from './tool.ts'

/** The tool list for a host: the cached one, or a handshake and a listing.
 * The protocol version is negotiated on this same path and kept beside it. */
export let rosterOf = async (host: string, ask: Rpc): Promise<Roster> => {
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

/**
 * A tool's answer, printed, and the news the server slipped in beside it
 * (roster.ts). Answers the exit code. A caller with no list in hand passes
 * `null` — the staleness still drops the cache.
 */
export let printed = (
  c: Ctx,
  roster: Roster | null,
  name: string,
  said: Result,
): number => {
  let read = saidBy(said)
  let { text, stale } = read
  // What this result said about the list this client is holding (roster.ts).
  // The staleness alone is enough to drop it; a caller holding no list has
  // nothing to keep fresh, and must not throw away somebody else's.
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

let verbOf = (roster: Roster, t: Tool): Verb => ({
  name: t.name,
  about: titleOf(t),
  help: () => toolHelp(t),
  run: async (c) =>
    printed(
      c,
      roster,
      t.name,
      await c.ask('tools/call', {
        name: t.name,
        arguments: await argsFor(t, c.args, c.reads),
      }) as Result,
    ),
})

/** Every tool this server lists, as a subcommand. */
export let platform: Plugin = {
  name: 'platform',
  about: 'the tools this server lists',
  verbs: async (c: Ctx) => {
    let roster = await rosterOf(c.host, c.ask)
    return roster.tools.map((t) => verbOf(roster, t))
  },
}
