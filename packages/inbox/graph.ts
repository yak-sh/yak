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
): Plugin[] => [{
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
      },
      answer: (rows) => rows,
    }
  },
}]
