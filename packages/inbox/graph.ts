// The inbox read is a query result, not a stored snapshot of attention.
import { type Bundle, derivedEid, type Graph, type Plugin } from '@yaks/graph'
import { map, parse, type Query } from '@yaks/query'
import type { Search } from './threads.ts'
import { readInbox, readThread } from './read.ts'

export type SummaryRequest = Search & { actor: string; thread?: string }

let request = (query: Query): SummaryRequest | undefined => {
  let values: Record<string, string> = {}
  map(query, (c) => {
    if (
      c.kind == 'pred' && c.path[0] == 'inbox_summary' && c.op == '=' &&
      c.value?.kind == 'scalar'
    ) {
      values[c.path[1]] = c.value.raw
    }
    return c
  })
  if (!values.actor) return
  return {
    actor: values.actor,
    text: values.text,
    direction: values.direction as Search['direction'],
    all: values.all == 'true',
    lane: values.lane as Search['lane'],
    thread: values.thread,
  }
}
let dependencies = [
  'subscription',
  'doc',
  'content',
  'comment',
  'entry',
  'output',
  'notice',
  'reasoning',
  'result',
  'exception',
  'refusal',
  'ask',
  'call',
  'stop',
  'commit',
  'prompt',
  'session',
  'project',
  'design',
  'task',
  'decision',
  'filed',
  'mail',
  'mail_notice',
  'notified',
  'knock',
  'deliver',
  'signal',
  'bug',
  'created',
  'opened',
  'archived',
  'completed',
  'cancelled',
  'failed',
  'blocked',
  'broken',
  'resolved',
  'regressed',
  'decided',
  'exit',
  'requires',
  'edge',
]

/** The web host's reader executes the same view in its read worker. Other
 * graph hosts calculate it through their own committed read interface. */
export let plugins = (
  host: { graph: Graph; reader?: Pick<Graph, 'read'> },
): Plugin[] => {
  // Exact completed results only, bounded by entries and bytes. A revision
  // observes external commits too; hosts unable to prove it do not memoize.
  let kept = new Map<
    string,
    { revision: unknown; value: Bundle[]; bytes: number }
  >()
  let pending = new Map<string, Promise<Bundle[]>>()
  let bytes = 0
  return [{
    name: '@yaks/inbox',
    view: (ctx, original) => {
      let asked = request(original)
      if (!asked || !ctx.vocab) return null
      let v = ctx.vocab
      return {
        original,
        vocab: v,
        query: parse(''),
        dependencies: dependencies.filter((c) => !!v.comp(c)),
        expand: async () => {
          if (host.reader) return host.reader.read(original)
          let revision = host.graph.storage.revision?.()
          let key = JSON.stringify(asked)
          let cached = kept.get(key)
          if (revision !== undefined && cached?.revision === revision) {
            kept.delete(key)
            kept.set(key, cached)
            return structuredClone(cached.value)
          }
          let pendingKey = JSON.stringify([key, revision])
          let inFlight = revision === undefined
            ? undefined
            : pending.get(pendingKey)
          if (inFlight) return structuredClone(await inFlight)
          let compute = async () => {
            let source = {
              read: (query: Parameters<Graph['read']>[0]) =>
                host.graph.read(query, { native: true }),
              get: (ids: string[], comps?: string[]) =>
                host.graph.get(ids, comps, { native: true }),
            }
            let found = asked.thread
              ? await readThread(source, v, asked.actor, asked.thread)
              : await readInbox(source, v, asked.actor, asked)
            let threads = Array.isArray(found) ? found : found ? [found] : []
            // Only rows the completed list actually draws cross this door. The
            // historical messages remain on the server until detail is requested.
            let summary = threads.map((t) => ({
              ...t,
              messages: asked.thread ? t.messages : [],
            }))
            let params = {
              actor: asked.actor,
              text: asked.text ?? '',
              direction: asked.direction ?? '',
              all: !!asked.all,
              lane: asked.lane ?? '',
              thread: asked.thread ?? '',
            }
            return [{
              entity: {
                eid: derivedEid('inbox-summary|' + JSON.stringify(params)),
              },
              inbox_summary: { ...params, threads: summary },
            }] as Bundle[]
          }
          let work = compute()
          if (revision !== undefined) pending.set(pendingKey, work)
          try {
            let value = await work
            if (
              revision !== undefined &&
              host.graph.storage.revision?.() === revision
            ) {
              let size = JSON.stringify(value).length * 2
              let old = kept.get(key)
              if (old) bytes -= old.bytes
              kept.delete(key)
              if (size <= 2 * 1024 * 1024) {
                kept.set(key, {
                  revision,
                  value: structuredClone(value),
                  bytes: size,
                })
                bytes += size
              }
              while (kept.size > 8 || bytes > 2 * 1024 * 1024) {
                let first = kept.keys().next().value!
                bytes -= kept.get(first)!.bytes
                kept.delete(first)
              }
            }
            return value
          } finally {
            if (pending.get(pendingKey) === work) pending.delete(pendingKey)
          }
        },
        answer: (rows) => rows,
      }
    },
  }]
}
