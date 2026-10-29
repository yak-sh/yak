// An ended CLI run leaves its report on its task and a knock for whoever
// started it. The knock is ordinary session-bus delivery, so listen, hooks
// and native transcripts all hear the same receipt.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Stale } from '@yaks/graph/errors'
import { signed } from '@yaks/graph/provenance'
import { argsOf } from '@yaks/graph/call'
import { human } from '@yaks/id'
import { cleanEnd, ordered, parked, speaking, textOf } from '@yaks/session'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let str = (v: unknown): string => v == null ? '' : String(v)

/** The account a session wrote, otherwise its last spoken output. Tool
 * results and private reasoning are never the report of its work. */
export let reportOf = (row: Bundle | undefined, entries: Bundle[]): string => {
  let brief = str(comp(row, 'brief')?.text)
  if (brief) return brief
  let spoken = entries.filter((b) =>
    b.output && b.content && !b.reasoning && !b.call && !b.result && !b.stop
  ).at(-1)
  let failure = entries.filter((b) => b.stop && b.content).at(-1)
  return spoken || failure ? textOf((spoken ?? failure)!) : ''
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
    'spawned',
  ])
  if (!row?.process || !row.exit) return
  if (cleanEnd(row) && await parked(g, session)) return
  let entries = ordered(await g.read(`.entry.session=${session}&*`))
  let end = entries.filter((b) => b.stop && !b.lines && comp(b, 'ask')?.through)
    .at(-1)
  if (!end) return
  let source = str(comp(row, 'session')?.source)
  let [call] = source ? await g.get([source], ['call', 'entry', 'created']) : []
  // Claims may already have been released by the terminal-entry effect, or
  // by the agent itself. The originating spawn call still names its task.
  let task = call?.call ? str(argsOf(call).task) : ''
  let tasks = task
    ? [task]
    : g.vocab.comp('task')
    ? (await g.read(`.task&.claim.session=${session}`)).map((b) => b.entity.eid)
    : []
  let parent = str(comp(row, 'spawned')?.parent) ||
    str(comp(call, 'entry')?.session) || str(comp(call, 'created')?.via)
  let [owner] = parent ? await g.get([parent], ['session']) : []
  let notify = owner?.session && g.vocab.comp('knock') ? parent : ''
  if (!tasks.length && !notify) return
  let title = `${human(g.vocab)(row)} — exited ${str(comp(row, 'exit')?.code)}`
  let body = [title, reportOf(row, entries)].filter(Boolean).join('\n\n')
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
