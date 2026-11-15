// A line of an Operator's conversation kept while it named its own files,
// as `operator_files{request, files}`, finds them among the attachments
// (@yaks/blob/attachment) once its store's pass reaches it, in bounded alarm
// batches beside the store's other passes, never in boot: the words a
// person gave link back to the request they came in (@yaks/session
// `taken{item}`), beside which their files are attached; the words read from
// a file the model could not read as it is move from the request onto the
// file's attachment (`attachment.text`); and the line's own copy goes. A
// step's result keeps nothing more: what it made is attached beside its call
// (output-move.ts). The pass waits for the attachment passes before it
// (attachment-move.ts, output-move.ts), so no file is left to only the line.
// Until it is done, a reader takes a line's files from the line where it
// still names them (operator-files.ts `filesOf`).
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import { attachedTo, attachmentOf } from '@yaks/blob/attachment'
import { ATTACHMENTS } from './attachment-move.ts'
import { OUTPUTS } from './operator-store.ts'
import { FILES } from './operator-files.ts'

/** How many lines one batch moves. */
export let BATCH = 50

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

type Read = { attachment?: string; name?: string; text?: string }

// The words read from a request's files, as the request kept them.
let readOf = (request: Bundle | undefined): Read[] => {
  let body = comp(request, 'content')?.body
  if (!request?.operator_request || typeof body != 'string') return []
  try {
    let read = JSON.parse(body)
    return Array.isArray(read) ? read : []
  } catch {
    return []
  }
}

/** One batch of the pass. Answers whether another alarm has work. A store
 * kept nowhere was made in memory with the words, and owes no pass. */
export let filesBackfill = async (store: {
  g: Graph
  marks?: Pick<Meta, 'get' | 'set'>
  waiting?: () => number
}): Promise<boolean> => {
  let { g, marks } = store
  if (!marks || marks.get(FILES) == 'done') return false
  if (store.waiting?.()) return true
  if (marks.get(ATTACHMENTS) != 'done' || marks.get(OUTPUTS) != 'done') {
    return true
  }
  let rows = await g.read(
    `.operator_files&.limit=${BATCH}&.fields=operator_files.request,taken.item`,
  )
  let asked = (b: Bundle) => {
    let request = String(comp(b, 'operator_files')?.request ?? '')
    return request && request != b.entity.eid ? request : ''
  }
  let requests = [...new Set(rows.map(asked).filter(Boolean))]
  let [kept, held] = await Promise.all([
    g.get(requests, ['operator_request', 'content']),
    attachedTo(g, requests),
  ])
  let read = new Map(kept.map((b) => [b.entity.eid, readOf(b)]))
  let texts = requests.flatMap((request) =>
    (held.get(request) ?? []).flatMap((file, i) => {
      let said = read.get(request)?.find((r) =>
        r.attachment == file.address && r.name == file.name
      )
      return said?.text != null && file.text == null
        ? [{
          entity: { eid: attachmentOf(request, i) },
          attachment: { text: said.text },
        }]
        : []
    })
  )
  let lines = rows.map((b) => ({
    entity: b.entity,
    ...asked(b) && !comp(b, 'taken')?.item ? { taken: { item: asked(b) } } : {},
    operator_files: null,
  }))
  if (lines.length) {
    await g.apply([...texts, ...lines], { trusted: true, stamp: false })
  }
  if (rows.length < BATCH) marks.set(FILES, 'done')
  return rows.length == BATCH
}
