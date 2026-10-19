// Oracle questions enter the native transcript machinery. Retained context is
// frozen in a passive session; each question forks that exact snapshot.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { argsOf, who } from '@yaks/graph/call'
import { derivedEid } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import type { Runs } from '@yaks/graph/tools'
import { promptEntry, snapshot } from '@yaks/context'
import { defaultUsing, selectedUsing } from '@yaks/harness'
import { humanCaller } from '@yaks/session'
import { learning } from './learn.ts'

let part = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let context = (node: Bundle) => {
  let o = part(node, 'oracle')
  return [
    'You are answering in a receiving fork of this oracle. The retained context below belongs to the oracle; this conversation is separate from other callers.',
    `Oracle: ${node.entity.eid}\nDomain: ${o.domain}`,
    String(o.self ?? ''),
    String(o.shared ?? ''),
    `Evidence entity ids: ${JSON.stringify(o.evidence ?? [])}`,
    'Use graph_query to discover related oracles through oracle_child edges (child → parent). oracle_query opens a native receiving fork of another oracle. Read its session transcript through graph_query. Answer the current question; no ongoing background work is requested.',
  ].filter(Boolean).join('\n\n')
}

let usingFor = async (g: Graph, call: Bundle, model?: unknown) => {
  let by = who(call)?.by
  let inherited = by ? await selectedUsing(g, by) : undefined
  let using = inherited ?? await defaultUsing(g, 'openai')
  if (model == null) return using
  let [row] = await g.get([String(model)], ['model'])
  if (!row?.model) throw new Refused('Choose an existing model')
  let offers = await g.read(`.serves .edge.to=${row.entity.eid} ?edge`)
  let offer = offers.find((b) => part(b, 'edge').from == using.provider) ??
    offers[0]
  if (!offer) throw new Refused('No provider serves this model')
  return { ...using, model: row.entity.eid, provider: part(offer, 'edge').from }
}

/** A call names the dialogue, so replay never creates another receiving fork. */
export let runs = (): Runs => ({
  ...learning(),
  oracle_query: async (call, g) => {
    let args = argsOf(call)
    let text = args.text
    if (typeof text != 'string' || !text.trim()) {
      throw new Refused('Ask a nonempty question')
    }
    let eid = derivedEid(`oracle dialogue|${call.entity.eid}`)
    let [existing] = await g.get([eid])
    if (existing?.oracle_dialogue) return [existing]
    let [node] = await g.get([String(args.oracle)], ['oracle', 'doc'])
    if (!node?.oracle) throw new Refused('Choose an oracle')
    let o = part(node, 'oracle')
    let snap = await snapshot(context(node), node.entity.eid)
    let seed = derivedEid(`oracle context|${node.entity.eid}|${snap.revision}`)
    let anchor = derivedEid(`oracle context entry|${seed}`)
    let using = await usingFor(g, call, args.model)
    let actor = who(call)
    let operator = await humanCaller(g, actor)
    let rows: Bundle[] = [{
      entity: { eid: seed },
      session: { ended: true },
      doc: {
        title: `${part(node, 'doc').title ?? o.domain}: retained context`,
      },
    }, {
      ...promptEntry(seed, 1, snap.body, snap.source, 'shared', snap.revision),
      entity: { eid: anchor },
      $actor: { by: seed },
    }, {
      entity: { eid },
      session: { id: eid, operator },
      native: {},
      fork: { from: anchor },
      doc: { title: text.split(/\r?\n/, 1)[0].slice(0, 160) },
      oracle_dialogue: {
        tree: o.tree,
        from: actor?.by ?? call.entity.eid,
        to: node.entity.eid,
        revision: snap.revision,
      },
    }, {
      entity: { eid: derivedEid(`oracle input|${call.entity.eid}`) },
      entry: { session: eid },
      content: { body: text },
      using,
      sending: {
        tools: [
          'graph_query',
          'graph_show',
          'graph_schema',
          'graph_apply',
          'oracle_query',
        ],
      },
    }]
    await g.apply(rows.map((row) => ({
      ...row,
      ...actor && !row.$actor ? { $actor: actor } : {},
    })))
    return await g.get([eid])
  },
})
