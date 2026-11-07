// A host as a member of a reach (@yaks/reach): a graph this program reaches
// over its `/mcp` door rather than opens. Its reads are `graph_query`, its
// writes `graph_apply` and its words `graph_schema`, the generic tier every
// graph's door lists (@yaks/graph/tools), so a member is the same value
// whether the host is another box or yaks.app answering across its own
// stores.
//
// Every host is asked as the person it knows: its door carries the token of
// that host's own connection row (accounts.ts). The command line's own say
// about who is asking — `$YAKS_TOKEN`, `--as` — is about the one host the
// line aims at (run.ts `aimed`), so only that host's door hears it.

import * as system from '@yaks/process/system'
import type { Bundle } from '@yaks/graph'
import type { Member } from '@yaks/reach'
import { CallError } from '@yaks/tools/errors'
import type { VocabDoc } from '@yaks/vocab'
import { type Door, doorUrl, type Rpc, rpc } from './rpc.ts'
import { type Result, saidBy } from './roster.ts'
import { type AccountOptions, accountToken } from './accounts.ts'
import type { Env } from './store.ts'

/** One tool called on a door, its answer as the value it carries: the
 * bundles, or what a reduction or a schema said. A tool's refusal throws. */
export let called = async (
  ask: Rpc,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  let reply = await ask('tools/call', { name, arguments: args }) as Result
  if (reply.isError) throw new CallError('remote', saidBy(reply).text)
  let said = reply.structuredContent as { result?: unknown } | undefined
  return said && 'result' in said ? said.result : said
}

/** A host's vocabulary in full: `graph_schema` with no arguments is the
 * index of every word, and asked for each by name it answers them as
 * declared. A host whose index names nothing has no words to give. */
export let schemaOf = async (ask: Rpc): Promise<VocabDoc | null> => {
  let index = await called(ask, 'graph_schema', {}) as VocabDoc | undefined
  let names = Object.keys(index?.$defs ?? {})
  if (!names.length) return null
  return await called(ask, 'graph_schema', { component: names }) as
    | VocabDoc
    | null
}

// A reduction comes back as one `$said` row carrying its value (`{count}`),
// which is what a member answers for it.
let reduction = (rows: Bundle[]): unknown => {
  let [one] = rows
  return rows.length == 1 && one.entity?.eid == '$said'
    ? (one.output as { value?: unknown } | undefined)?.value
    : undefined
}

/**
 * The host at `at`, asked through `ask`, as a reach member. A read is one
 * `graph_query` of the line, including the gather by eid reach sends
 * (`.entity.eid=a,b`): a host holding none of them answers nothing rather
 * than refusing, which graph_show would. The words are asked once.
 *
 * ```ts ignore
 * let member = hostMember('yaks.app', hostDoor('yaks.app', { aimed: 'yaks.app' }))
 * await reach({ core }).read([box, member], '.book&?loan')
 * ```
 */
export let hostMember = (at: string, ask: Rpc): Member => {
  let words: Promise<VocabDoc> | undefined
  return {
    at,
    read: async (line) => {
      let rows = await called(ask, 'graph_query', { q: line })
      if (!Array.isArray(rows)) return rows
      return reduction(rows) ?? rows
    },
    apply: async (bundles, check) =>
      await called(ask, 'graph_apply', {
        bundles,
        ...(check ? { check } : {}),
      }) as Bundle[],
    vocab: () => {
      words ??= schemaOf(ask).then((doc) => doc ?? { $defs: {} })
      // A host that could not say its words is asked again next time.
      words.catch(() => words = undefined)
      return words
    },
  }
}

/** Where a command line stands: the host it aims at, and its own say about
 * who is asking, which reaches that host alone. */
export type Aim = {
  aimed: string
  state?: string
  config?: string
  as?: string
  env?: Env
  via?: string
  fetch?: Door['fetch']
  /** The bearer for a host; the selected connection's by default. */
  token?: (
    host: string,
    state?: string,
    opts?: AccountOptions,
  ) => Promise<string | null>
}

// The environment a host the line did not aim at reads: the same, without the
// token the line gave for the host it aimed at.
let unaimed = (env: Env): Env => (name) =>
  name == 'YAKS_TOKEN' ? undefined : env(name)

/** The door to `host`, as the person its own connection row signs in. The
 * aimed host's door also hears `$YAKS_TOKEN` and `--as`; every other host's
 * hears only its row. The token is read at each call. */
export let hostDoor = (host: string, aim: Aim): Rpc => {
  let env = aim.env ?? ((name: string) => system.env.get(name))
  let mine = host == aim.aimed
  let token = aim.token ?? accountToken
  return rpc({
    url: doorUrl(host),
    via: aim.via,
    fetch: aim.fetch,
    token: () =>
      token(host, aim.state, {
        config: aim.config,
        env: mine ? env : unaimed(env),
        ...(mine && aim.as ? { as: aim.as } : {}),
      }),
  })
}
