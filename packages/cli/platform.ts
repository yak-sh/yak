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

import type { Ctx, Word } from './run.ts'
import { initialize, type Rpc } from './rpc.ts'
import { type Result, rosterAfter, saidBy } from './roster.ts'
import { cached, forget, remember, type Roster } from './store.ts'
import { type Listed, spelling } from './tool.ts'

/** The tool list for a host: the cached one, or a handshake and a listing.
 * The protocol version is negotiated on this same path and kept beside it. */
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

// One tool the server listed, as a tool this command runs: its published
// schema IS the grammar of the line, and running it is the call. Two words and
// a spelling ride beside it where the tool declared them (tool.ts `spelling`),
// so `yak task new 'ship it'` is typed the way the vocabulary said and a
// server that says neither still lists as one flat name.
let toolOf = (roster: Roster, t: Listed): Word => ({
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

/** Every tool this server lists, as a subcommand. The table that costs a
 * round trip (run.ts `more`), so a line that never reaches it pays nothing. */
export let listed = async (c: Ctx): Promise<Word[]> => {
  let roster = await rosterOf(c.host, c.ask)
  return roster.tools.map((t) => toolOf(roster, t))
}
