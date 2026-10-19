// A topic opening admits its self context and one generation of deliberately
// shared context along relations declaring a parent endpoint. Stored edge
// directions stay intact; assembled prompts never travel again.
import type { Bundle, Graph } from '@yaks/graph'
import { part } from './learn.ts'
import { names } from '@yaks/edge'
import { sha256 } from '@yaks/graph/sha256'

let protocol = [
  'You are the oracle cultivating three contexts attached to one topic: self (your own working knowledge), parent (what you share upward), and children (what you share downward). Answer the current question in this separate native conversation.',
  'Topics form a graph using ordinary typed edges such as contains, reads and cites. Only relations declaring a parent endpoint share context automatically: each child receives its direct parents’ children-facing context; each parent receives its direct children’s parent-facing context. Stored edge directions keep their own meaning. Unclassified links remain available to query without automatic context sharing. Context travels one generation only. Use graph_query to discover more; oracle_query consults another topic in a separate native conversation. For a consultation you opened, wait({children:[session id]}) returns its answer; then continue the current conversation.',
  'Grow knowledge in response to questions. Use topic_find before topic_new so a subject already named is reused. graph_apply links topics using existing edge vocabulary, without copying their knowledge. Keep each topic focused and grow only where questions justify it.',
  'Read recorded graph evidence directly. Use hosted web research when the selected provider offers it. Preserve source links in a recorded research message; read that entry back before using its id as evidence. Distinguish user statements, cited research and inference. Say what remains unknown when no source or research tool is available.',
  'oracle_read returns the topic, its directional context records and $was.topic_context preconditions. oracle_revise replaces supplied self/parent/children directions, each as {body,evidence}, with the corresponding preconditions in was. Preserve useful prior knowledge; on a stale write, read and merge. Cultivate the relevant topic as part of answering so later conversations reuse what was learned. No background population is requested.',
].join('\n\n')

export let neighborhood = async (g: Graph, node: Bundle) => {
  let eid = node.entity.eid
  let links = await g.read(`.edge (.edge.from=${eid}|.edge.to=${eid}) *`)
  let tags = names(g.vocab)
  let classified = links.flatMap((link) => {
    let edge = part(link, 'edge')
    let relation = Object.keys(tags).find((tag) => link[tag])
    let endpoint = relation
      ? g.vocab.comp(relation)?.keywords.parent
      : undefined
    if (typeof endpoint != 'string' || !['from', 'to'].includes(endpoint)) {
      return []
    }
    let parent = String(edge[endpoint]),
      child = String(edge[endpoint == 'from' ? 'to' : 'from'])
    return [{
      eid: parent == eid ? child : parent,
      slot: parent == eid ? 'parent' : 'children',
      via: `${edge.from} -${relation}-> ${edge.to}`,
    }]
  }).filter((link) => link.eid != eid)
  let ids = [...new Set(classified.map((link) => link.eid))].sort()
  let neighbors = (await g.get(ids, ['topic', 'topic_context', 'doc'])).filter((
    b,
  ) => b.topic)
  let selected = [{ topic: node, slot: 'self', via: 'own' }]
  for (let link of classified) {
    let topic = neighbors.find((b) => b.entity.eid == link.eid)
    if (!topic) continue
    let prior = selected.find((s) =>
      s.topic.entity.eid == link.eid && s.slot == link.slot
    )
    if (prior) prior.via += `; ${link.via}`
    else selected.push({ topic, slot: link.slot, via: link.via })
  }
  let heads = await g.get([
    ...new Set(selected.flatMap(({ topic, slot }) => {
      let head = part(topic, 'topic_context')[slot]
      return head ? [String(head)] : []
    })),
  ], ['content', 'prompt'])
  let sections = selected.map(({ topic, slot, via }) => {
    let head = String(part(topic, 'topic_context')[slot] ?? '')
    let source = heads.find((b) => b.entity.eid == head)
    let body = part(source, 'content').body, prompt = part(source, 'prompt')
    if (
      head &&
      (typeof body != 'string' || prompt.source != topic.entity.eid ||
        prompt.revision != sha256(body))
    ) {
      throw new Error(`Topic context integrity failed: ${head}`)
    }
    return [
      `Topic: ${topic.entity.eid} (${
        part(topic, 'doc').title ?? part(topic, 'topic').name
      }); direction: ${slot}`,
      `Relationship: ${via}`,
      source
        ? `Context: ${head}; revision: ${part(source, 'prompt').revision}`
        : '',
      String(part(source, 'content').body ?? ''),
    ].filter(Boolean).join('\n\n')
  })
  return { body: [protocol, ...sections].join('\n\n'), heads }
}
