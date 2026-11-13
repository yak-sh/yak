// An ended CLI run leaves its report on its task and a knock for whoever
// started it, or for the nearest session up that one's line once it is over
// (@yaks/session `reported`). The knock is ordinary session-bus delivery, so
// listen, hooks and native transcripts all hear the same receipt: one row
// carrying the whole report, which is the only knock its work on the task
// makes (@yaks/session's watch.ts).
//
// A provider's subagents run inside its process, so they end when it does. A
// run waits on its own background agents (./adapters.ts `claude.env`), but one
// stopped or crashed still takes them down while its last words say they are
// at work, so the receipt names each one that never settled, from its own
// transcript.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Stale } from '@yaks/graph/errors'
import { signed } from '@yaks/graph/provenance'
import { human } from '@yaks/id'
import {
  children,
  cleanEnd,
  entryStatus,
  parked,
  receiptOf,
  reported,
  saidOf,
  speaking,
  textOf,
} from '@yaks/session'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let str = (v: unknown): string => v == null ? '' : String(v)
let s = (n: number) => n == 1 ? '' : 's'

/** The account a session wrote, otherwise what it said last (@yaks/session
 * `saidOf`). Tool results and private reasoning are never the report of its
 * work. */
export let reportOf = async (g: Graph, row: Bundle): Promise<string> => {
  let brief = str(comp(row, 'brief')?.text)
  if (brief) return brief
  let said = await saidOf(g, row.entity.eid)
  return said ? textOf(said) : ''
}

/** The subagents a run started that did not settle before it ended, each
 * with its title and the status its entries leave. */
export let unfinished = async (
  g: Graph,
  session: string,
): Promise<{ row: Bundle; status: string }[]> => {
  let kids = await children(g, session)
  let said = await Promise.all(kids.map(async (row) => ({
    row,
    status: await entryStatus(g, row.entity.eid),
  })))
  return said.filter(({ status }) => status != 'settled')
}

/** Publish one completion per ended run. A parked run still owes work and
 * keeps its claim; its eventual final run publishes the receipt. */
export let complete = async (g: Graph, session: string): Promise<void> => {
  let [row] = await g.get([session], [
    'session',
    'process',
    'exit',
    'stop',
    'brief',
  ])
  if (!row?.process || !row.exit) return
  if (cleanEnd(row) && await parked(g, session)) return
  let end = await receiptOf(g, session)
  if (!end) return
  let { tasks, to } = await reported(g, session)
  let notify = to && g.vocab.comp('knock') ? to : ''
  if (!tasks.length && !notify) return
  let name = human(g.vocab)
  let cut = await unfinished(g, session)
  // A run somebody stopped ended as they asked: the title says so first, so
  // its reader does not take the signal's exit code for a crash.
  let exited = `exited ${str(comp(row, 'exit')?.code)}`
  let title =
    `${name(row)} — ${row.stop ? `asked to stop, ${exited}` : exited}` +
    (cut.length ? `, ${cut.length} unfinished subagent${s(cut.length)}` : '')
  let line = ({ row, status }: { row: Bundle; status: string }) =>
    `- ${name(row)} ${str(comp(row, 'doc')?.title)} (${status})`
  let stopped = cut.length
    ? `Its subagents stopped with it, their work unfinished:\n${
      cut.map(line).join('\n')
    }`
    : ''
  let body = [title, stopped, await reportOf(g, row)].filter(Boolean)
    .join('\n\n')
  let reports = tasks.length ? tasks : ['']
  let actor = await speaking(g, row)
  for (let target of reports) {
    if (!target && !notify) continue
    let eid = derivedEid(
      `spawn completion ${session} ${end.entity.eid} ${target}`,
    )
    if ((await g.get([eid], ['doc']))[0]?.doc) continue
    try {
      await g.apply(
        signed([{
          entity: { eid },
          doc: { title, body },
          ...target ? { comment: { target } } : {},
          ...notify ? { knock: { target: notify } } : {},
          $was: { doc: { body: null } },
        }], actor),
        { trusted: true },
      )
    } catch (error) {
      if (!(error instanceof Stale)) throw error
    }
  }
}
