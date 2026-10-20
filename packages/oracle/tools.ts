// Topic questions admit immutable context into native conversations. Retained
// experiment oracles keep their existing receiving-fork snapshot history.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { argsOf, who } from '@yaks/graph/call'
import { derivedEid } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import type { Runs } from '@yaks/graph/tools'
import { promptEntry, snapshot } from '@yaks/context'
import { defaultUsing, selectedUsing } from '@yaks/harness'
import { humanCaller } from '@yaks/session'
import { link } from '@yaks/edge'
import { content } from '@yaks/kernel'
import { learning } from './learn.ts'
import { neighborhood } from './context.ts'

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
  let using = inherited ?? await defaultUsing(g)
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
    let [node] = await g.get([String(args.oracle)], [
      'oracle',
      'doc',
      'topic',
      'topic_context',
    ])
    if (!node?.oracle && !node?.topic) throw new Refused('Choose a topic')
    let o = part(node, 'oracle')
    let nearby = node.topic ? await neighborhood(g, node) : undefined
    let body = nearby?.body ?? context(node)
    let snap = await snapshot(body, node.entity.eid)
    let seed = derivedEid(`oracle context|${node.entity.eid}|${snap.revision}`)
    let anchor = derivedEid(
      node.topic
        ? `oracle opening context|${call.entity.eid}`
        : `oracle context entry|${seed}`,
    )
    let using = await usingFor(g, call, args.model)
    let actor = who(call)
    let operator = await humanCaller(g, actor)
    let [caller] = actor?.by
      ? await g.get([actor.by], ['native', 'session'])
      : []
    let parent = caller?.native ? caller.entity.eid : undefined
    let rows: Bundle[] = [{
      entity: { eid },
      session: { id: eid, operator },
      native: {},
      ...parent ? { spawned: { parent } } : {},
      ...!node.topic ? { fork: { from: anchor } } : {},
      doc: { title: text.split(/\r?\n/, 1)[0].slice(0, 160) },
      oracle_dialogue: {
        ...o.tree ? { tree: o.tree } : {},
        from: actor?.by ?? call.entity.eid,
        to: node.entity.eid,
        revision: snap.revision,
      },
    }, {
      ...promptEntry(
        node.topic ? eid : seed,
        1,
        snap.body,
        snap.source,
        'shared',
        snap.revision,
      ),
      entity: { eid: anchor },
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
          'topic_find',
          'topic_new',
          'oracle_read',
          'oracle_revise',
          'graph_apply',
          'oracle_query',
          'wait',
        ],
      },
    }]
    if (!node.topic) {
      rows.unshift({
        entity: { eid: seed },
        session: { ended: true },
        doc: {
          title: `${part(node, 'doc').title ?? o.domain}: retained context`,
        },
      })
    }
    rows.push(...(nearby?.heads ?? []).map((head) => ({
      ...link(anchor, 'cites', head.entity.eid),
      cites: { hash: content(g.vocab)(head) },
    })))
    await g.apply(rows.map((row) => ({
      ...row,
      ...actor && !row.$actor ? { $actor: actor } : {},
    })))
    return await g.get([eid])
  },
})
