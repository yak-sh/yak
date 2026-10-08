/** The inbox's tools. `inbox_new` returns rows the tool runner writes as the
 * caller; it performs no I/O and neither starts nor feeds a session.
 * `inbox_list` reads one row per thread through the shared policy, and
 * `inbox_archive` puts a thread away until qualifying new activity, refreshing
 * the mark atomically so a repeated archive gets a fresh time.
 */
import {
  argsOf,
  type Bundle,
  type Eid,
  type Graph,
  Refused,
  who,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { readInbox } from './read.ts'
import { readerAt, type Row } from './reader.ts'
import { attention, type Direction, type Lane, threadOf } from './threads.ts'

/** How many threads a list returns when the caller gave no limit. */
export let PAGE = 50

let str = (v: unknown): string => v == null ? '' : String(v)

let rows = (bundles: Bundle[]): Row[] =>
  bundles.map((b) => ({
    eid: b.entity.eid,
    comps: Object.fromEntries(
      Object.entries(b).filter(([k, v]) =>
        k != 'entity' && v && typeof v == 'object'
      ),
    ) as Row['comps'],
  }))

/** Whose inbox this is: the entity the arguments named, else whoever is
 * asking. */
export let reader = (call: Bundle): Eid => {
  let asked = argsOf(call).who
  if (asked != null) return str(asked)
  let me = who(call)?.by
  if (!me) throw new Error('nobody is asking — say --who')
  return me
}

// The thread a letter belongs to for whoever is asking: up its `reply_to`
// chain, then the shared policy's thread of it.
let threadAt = async (
  graph: Graph,
  call: Bundle,
  letter: Bundle,
): Promise<Eid> => {
  let actor = who(call)?.by
  if (!actor) return letter.entity.eid
  let person = readerAt(rows(await graph.get([actor])), actor)
  let chain = [letter]
  let seen = new Set([letter.entity.eid])
  for (
    let up = str((letter.mail as Record<string, unknown>)?.reply_to);
    up && !seen.has(up);
  ) {
    seen.add(up)
    let [parent] = await graph.get([up])
    if (!parent) break
    chain.push(parent)
    up = str((parent.mail as Record<string, unknown>)?.reply_to)
  }
  let all = rows(chain)
  let byId = new Map(all.map((r) => [r.eid, r]))
  for (let r of all) {
    if (r.comps.mail?.message_id) byId.set(str(r.comps.mail.message_id), r)
  }
  return threadOf(all[0], person, byId)
}

/** Implementations of the tools declared in the inbox vocabulary. */
export let runs = (): Runs => ({
  inbox_new: (call): Bundle[] => {
    let text = argsOf(call).text
    if (typeof text != 'string' || !text.trim()) {
      throw new Refused('a conversation needs your words — say text')
    }
    return [{
      entity: { eid: '$conversation' },
      conversation: {},
      doc: { title: text.split(/\r?\n/, 1)[0], body: text },
    }]
  },

  inbox_list: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let found = await readInbox(graph, graph.vocab, reader(call), {
      all: !!args.all,
      text: str(args.search),
      direction: args.direction as Direction | undefined,
      lane: args.lane as Lane | undefined,
    })
    let n = args.limit == null ? PAGE : Number(args.limit)
    let page = found.slice(0, n)
    let entities = new Map((await graph.get(page.map((t) => t.eid), []))
      .map((b) => [b.entity.eid, b.entity]))
    return page.map((t) => ({
      entity: entities.get(t.eid) ?? { eid: t.eid },
      ...t.row.comps,
    }))
  },

  inbox_archive: async (call, graph): Promise<Bundle[]> => {
    let item = str(argsOf(call).item)
    let [found] = await graph.get([item])
    return attention(
      found?.mail ? await threadAt(graph, call, found) : item,
      'archived',
    )
  },
})
