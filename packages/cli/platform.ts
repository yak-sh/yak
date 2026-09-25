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
//
// A result's answer is shown the way a local graph's is, through the views
// (./answer.ts): the reply carries the bundles the tool answered, and the
// server's vocabulary, asked for once, says what they are and which packages'
// views draw them. Only a reply with no bundles in it — a tool with an output
// schema of its own, a server that is not a graph — is printed as the text it
// came as.

import type { Bundle } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
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

// A reply's answer as entities: the bundles under `structuredContent.result`,
// which every tool whose answer is entities sends (@yaks/mcp `answerSchema`).
// A tool with an output schema of its own sends its value there instead.
let answered = (said: Result): Bundle[] | null => {
  let result = (said.structuredContent as { result?: unknown } | undefined)
    ?.result
  return Array.isArray(result) ? result : null
}

// The server's vocabulary in full: the index `graph_schema` answers with no
// arguments names every component, and asking for all of them by name returns
// each as declared — the letter its ids are printed with, and which kind wins
// the display. Asked once and kept beside the tool list, so it goes when the
// list does. A server that lists no `graph_schema` has none to give.
let vocabOf = async (c: Ctx): Promise<VocabDoc | null> => {
  let roster = await rosterOf(c.host, c.ask)
  if (roster.vocab) return roster.vocab
  if (!roster.tools.some((t) => t.name == 'graph_schema')) return null
  let schema = async (args: Record<string, unknown>) =>
    ((await c.ask('tools/call', {
      name: 'graph_schema',
      arguments: args,
    })) as Result).structuredContent as VocabDoc | undefined
  let index = await schema({})
  let whole = await schema({ component: Object.keys(index?.$defs ?? {}) })
  if (!whole) return null
  remember(c.host, { ...roster, vocab: whole })
  return whole
}

/**
 * Show a tool's result, and the roster notice the server added beside it
 * (roster.ts). Returns the exit code. A caller holding no tool list passes
 * `null` — a staleness notice still drops the cache.
 */
export let printed = async (
  c: Ctx,
  roster: Roster | null,
  name: string,
  said: Result,
): Promise<number> => {
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
  if (c.json) {
    c.out(JSON.stringify(said.structuredContent ?? said, null, 2))
    return 0
  }
  let answer = answered(said)
  let vocab = answer && await vocabOf(c)
  if (answer && vocab) {
    // Imported only to draw, so a command that never does pays nothing.
    let { reported, show } = await import('./answer.ts')
    let { views, vocab: read } = await reported(vocab)
    // The entities its references point at, asked of the same host, so each
    // prints as the id a person types rather than as its handle.
    let lookup = async (ids: string[]) =>
      answered(
        await c.ask('tools/call', {
          name: 'graph_show',
          arguments: { ids, backrefs: false },
        }) as Result,
      ) ?? []
    await show(c, views, read, answer, {}, (ids) => lookup(ids).catch(() => []))
  } else if (text) c.out(text)
  return 0
}

// One tool the server listed, as a subcommand this program runs: its published
// input schema is the command-line grammar, and running the subcommand makes
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
