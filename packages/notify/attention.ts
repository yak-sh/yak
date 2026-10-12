/** Graph writes for a person's subscription attention. */
import type { Bundle, Graph } from '@yaks/graph'
import { mint } from '@yaks/graph/identity'
import { attention } from './mod.ts'

/** A letter's ancestors, resolving both graph eids and mail Message-IDs. */
export let ancestry = async (
  graph: Pick<Graph, 'get' | 'read' | 'vocab'>,
  letter: Bundle,
): Promise<Bundle[]> => {
  let found = [letter], seen = new Set([letter.entity.eid])
  let parent = async (ref: string): Promise<Bundle | undefined> => {
    let [row] = await graph.get([ref], undefined, { native: true })
    // A legacy Message-ID reference may have minted only an entity spine.
    // The ancestor is a letter or sent notification, not that empty identity.
    if (row?.mail || row?.notified) return row
    let paths = ['mail.message_id', 'notified.message_id'].filter((path) => {
      let [name, prop] = path.split('.')
      return !!graph.vocab.comp(name) && graph.vocab.props(name).includes(prop)
    })
    if (!paths.length) return
    let q = paths.map((path) => `(.${path}=${JSON.stringify(ref)})`).join('|')
    return (await graph.read(`(${q})&*`, { native: true }))[0]
  }
  for (let current = letter;;) {
    let ref = String((current.mail as Record<string, unknown>)?.reply_to ?? '')
    if (!ref) break
    let up = await parent(ref)
    if (!up || seen.has(up.entity.eid)) break
    seen.add(up.entity.eid)
    found.push(up)
    current = up
  }
  return found
}

/** Refresh one person's attention on their existing subscription row. */
export let markAttention = async (
  graph: Pick<Graph, 'read'>,
  actor: string,
  target: string,
  mark: 'opened' | 'archived',
): Promise<Bundle[]> => {
  let [had] = await graph.read(
    `.subscription.actor=${JSON.stringify(actor)}&.subscription.target=${
      JSON.stringify(target)
    }&.fields=entity.eid`,
  )
  let eid = had?.entity.eid ?? mint()
  return [
    ...(had ? [] : [{ entity: { eid }, subscription: { actor, target } }]),
    ...attention(eid, mark),
  ]
}
