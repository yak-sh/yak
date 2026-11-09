// Passive child completion shares fork lineage and entry ordering with normal
// delegation. Its single receipt is refreshed when a closed chat is resumed.
import type { Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { kindOf, statusOf, textOf } from './state.ts'
import { entryStatus } from './reach.ts'

/** Deliver a child's closing notice, or return the quiet deadline its host
 * should wake at. Running children report when their runner finishes. */
export let childNotice = async (
  g: Graph,
  child: string,
  link: Comp,
  now: number,
  working: () => Promise<boolean>,
): Promise<number | undefined> => {
  let [last] = await g.read(
    `.entry.session=${child}&.order=-entry.seq&.limit=1&.fields=entity.eid`,
  )
  if (!last) return
  let eid = derivedEid(`delivery:${child}:notice`)
  let [prior] = await g.get([eid], ['delivery'])
  if ((prior?.delivery as Comp | undefined)?.through == last.entity.eid) return
  let status = await entryStatus(g, child)
  if (!['settled', 'failed', 'stopped'].includes(status)) return
  let inputsOnly = [
    'output',
    'ask',
    'call',
    'result',
    'notice',
    'prompt',
    'refusal',
    'exception',
  ]
    .filter((name) => g.vocab.comp(name)).map((name) => '!' + name).join('&')
  let query = `.entry.session=${child}&.content&${inputsOnly}`
  let [sent] = await g.read(
    query + '&.order=-entry.seq&.limit=1&.fields=created.at',
  )
  let at = Date.parse(String((sent?.created as Comp | undefined)?.at ?? ''))
  let due = at + Math.max(0, Number(link.quiet ?? 0))
  if (status == 'settled' && due > now) return due
  if (status == 'settled' && await working()) return
  let entries = await g.read(`.entry.session=${child}&.order=entry.seq&*`)
  if (
    entries.at(-1)?.entity.eid != last.entity.eid || statusOf(entries) != status
  ) return now
  let inputs = entries.filter((b) =>
    kindOf(b) == 'input' && !b.prompt && !b.notice
  )
  let answer = entries.findLast((b) => b.output && !b.notice)
  await g.apply([{ entity: { eid: child }, completed: {} }, {
    entity: { eid },
    entry: { session: String(link.parent) },
    notice: { child },
    delivery: { child, outcome: status, through: last.entity.eid },
    content: {
      body: [
        `Chat ${child} closed (${status == 'settled' ? 'quiet' : status}).`,
        'Asked:\n' + inputs.map(textOf).join('\n\n'),
        'Done / open:\n' + (answer ? textOf(answer) : textOf(entries.at(-1)!)),
        ...status == 'settled'
          ? []
          : [`Open: the chat ${status}; work may remain.`],
      ].join('\n\n'),
    },
  }], { trusted: true })
}
