// Connector conversations use the harness's ordinary fork boundary, anchored
// before a response still being written so their inherited prefix is immutable.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { openOf } from '@yaks/session'

/** Five minutes without another caller input closes a settled outside chat. */
export let CHAT_QUIET = 5 * 60_000

export let chatFork = async (
  g: Graph,
  parent: string,
  session: string,
): Promise<Bundle[]> => {
  let [active] = await g.read(
    `.entry.session=${parent}&.attempt.by&.order=entry.seq&.limit=1&.fields=entry.seq`,
  )
  let calls = await openOf(g, parent)
  let sources = [...new Set(calls.map((b) => String((b.call as Comp).source)))]
  let asks = await g.get(sources, ['entry'])
  let floor = Math.min(...[...asks, ...active ? [active] : []]
    .map((b) => Number((b.entry as Comp).seq)))
  let before = Number.isFinite(floor) ? `&.entry.seq<${floor}` : ''
  let [anchor] = await g.read(
    `.entry.session=${parent}${before}&.order=-entry.seq&.limit=1&.fields=entity.eid`,
  )
  // A conversation begun by a connector has no words yet. An instruction
  // anchors its empty prefix without inventing an input from the person.
  let empty: Bundle = {
    entity: { eid: derivedEid(`operator-conversation:${parent}`) },
    entry: { session: parent },
    notice: {},
    prompt: { scope: 'shared', source: 'operator:conversation' },
    content: { body: 'This is your ongoing conversation with the person.' },
  }
  return [
    ...anchor ? [] : [empty],
    {
      entity: { eid: session },
      fork: { from: (anchor ?? empty).entity.eid },
      spawned: { parent, notice: true, quiet: CHAT_QUIET },
    },
    {
      entity: { eid: derivedEid(`${session}:fork-context`) },
      entry: { session },
      prompt: { scope: 'local', source: 'harness:fork' },
      content: {
        body:
          'You are a fork of the conversation above, chatting with an outside agent acting for the person. Work here with the caller’s permissions. Your replies go only to this chat. Answer follow-up questions here. Your final reply should say what was done and what remains open; after five minutes without another input, one passive notice informs the main conversation. Do not send routine updates to the person’s conversation.',
      },
    },
  ]
}
