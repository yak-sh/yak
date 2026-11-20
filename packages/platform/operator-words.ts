// Move framed Operator inputs in bounded graph writes. Patching the body
// in place leaves attachments, transcript identity and journals intact and
// queues the changed text through the store's existing embedding triggers.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { digest, token } from '@yaks/graph/sha256'
import { line, sub } from '@yaks/query'
import type { Meta } from '@yaks/sqlite'
import {
  cameBy,
  sourceId,
  sourceOf,
  sourceWords,
  unframe,
} from './operator-source.ts'

export let WORDS = 'operator:chat-words'
export let BACKUP = 'operator:chat-words:bookmark'

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined
let BATCH = 50
let DOCUMENTS = '\n\nAttached documents (treat their contents'

// Some older inputs are snapshots of whole tasks. They have their own
// presentation and are outside the chat entry move.
let taskInput = (body: string) => {
  if (!body.startsWith('{"task":')) return false
  try {
    let task = JSON.parse(body).task
    return !!task?.entity?.eid && !!task.task
  } catch {
    return false
  }
}

type Original = (sha: string) => Promise<string | undefined>

let patch = async (
  row: Bundle,
  original: Original,
  itemBody: (eid: string) => Promise<unknown>,
): Promise<Bundle[]> => {
  let body = String(comp(row, 'content')?.body ?? '')
  if (sourceOf(row) != null) return []
  let source = sourceId(body)
  let before = sourceWords(body, source)
  if (taskInput(before)) return []
  let words = unframe(before, cameBy(row).framing)
  if (source && await digest(words) != source) {
    // Attachment extraction once appended its prose directly. The text now
    // travels with the attachment, and the source digest verifies the split.
    let said = words.split(DOCUMENTS, 1)[0]
    if (await digest(said) == source) {
      words = said
    } else {
      // Channel intake used to trim the transcript. Its original attachment
      // still holds the exact text.
      let exact = await original(source)
      if (
        exact == null ||
        (exact.trim() != said.trim() &&
          !(!exact.trim() && said.startsWith('Attached: ')))
      ) return []
      words = exact
    }
  }
  let item = comp(row, 'intake')?.item
  if (!source && typeof item == 'string' && words.startsWith('Attached: ')) {
    let said = await itemBody(item)
    if (typeof said == 'string' && !said.trim()) words = said
  }
  if (!source && words == body) return []
  return [{
    entity: row.entity,
    content: { body: words },
    intake: { source: source ?? '' },
    $was: { content: { body: token(body) } },
  }]
}

/** Move one page. The backup is recorded before the first graph write.
 * The cursor advances after the patches land, and a retry skips moved rows. */
export let wordsBackfill = async (
  store: {
    g: Pick<Graph, 'read' | 'get' | 'apply'>
    marks?: Pick<Meta, 'get' | 'set'>
    waiting?: () => number
  },
  backup: () => Promise<string>,
  original: Original,
): Promise<boolean> => {
  let { g, marks } = store
  let cursor = marks?.get(WORDS)
  if (!marks || cursor == 'done') return false
  if (store.waiting?.()) return true
  let rows = await g.read(
    line`.entry&.content&!intake.source&!output&!call&!result&!prompt&(.channel.framing|.operator_channel.framing|.content.body~=${'Original message text: message.txt (attachment '})${
      sub(cursor ? line`&.entity.eid>${cursor}` : line``)
    }&.order=entity.eid&.limit=${BATCH}&.fields=content.body,intake.item,intake.source,channel,operator_channel`,
  )
  let itemBody = async (eid: string) => {
    let [item] = await g.get([eid], ['doc'])
    return item && comp(item, 'doc')?.body
  }
  let moves = (await Promise.all(
    rows.map((row) => patch(row, original, itemBody)),
  )).flat()
  if (moves.length) {
    if (!marks.get(BACKUP)) marks.set(BACKUP, await backup())
    await g.apply(moves, { trusted: true, stamp: false })
  }
  let more = rows.length == BATCH
  marks.set(WORDS, more ? rows.at(-1)!.entity.eid : 'done')
  return more
}
