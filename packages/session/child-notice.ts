// Passive child completion shares fork lineage and entry ordering with normal
// delegation. Its single receipt is refreshed when a closed chat is resumed.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { kindOf, statusOf, textOf } from './state.ts'
import { entryStatus } from './reach.ts'

/** The main thread above a chain of passive children. */
export let noticeParent = async (g: Graph, child: string): Promise<string> => {
  let [row] = await g.get([child], ['spawned'])
  let link = row?.spawned as Comp | undefined
  return link?.notice && link.parent
    ? noticeParent(g, String(link.parent))
    : child
}

/** Raise exceptional work without starting a turn in the main thread. */
export let raiseNotice = async (
  g: Graph,
  child: string,
  body: string,
  eid: string,
): Promise<Bundle[]> => [{
  entity: { eid },
  entry: { session: await noticeParent(g, child) },
  notice: { child },
  content: { body },
}]

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
  let reports = entries.filter((b) => b.notice && b.delivery)
  let body = [
    `${link.quiet == null ? 'Helper' : 'Chat'} ${child} closed (${
      status == 'settled' ? 'quiet' : status
    }).`,
    'Asked:\n' + inputs.map(textOf).join('\n\n'),
    'Done / open:\n' + (answer ? textOf(answer) : textOf(entries.at(-1)!)),
    ...reports.length ? ['Helpers:\n' + reports.map(textOf).join('\n\n')] : [],
    ...status == 'settled'
      ? []
      : [`Open: the chat ${status}; work may remain.`],
  ].join('\n\n')
  await g.apply([
    { entity: { eid: child }, completed: {} },
    {
      entity: { eid },
      entry: { session: String(link.parent) },
      notice: { child },
      delivery: { child, outcome: status, through: last.entity.eid },
      content: { body },
    },
    ...status == 'failed' && await noticeParent(g, child) != link.parent
      ? await raiseNotice(
        g,
        child,
        body,
        derivedEid(`delivery:${child}:failure`),
      )
      : [],
  ], { trusted: true })
}
