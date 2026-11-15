// The files a line of an Operator's conversation came with, or a step of it
// brought back: the attachments (@yaks/blob/attachment) beside the item a
// person's words came in (@yaks/session `intake{item}`), beside the line
// itself where no item brought them, or beside the call a result answers
// (operator-channels.ts `madeFiles`). A line kept before its store's pass
// (files-move.ts) names its files on itself, as `operator_files{request,
// files}`, and is read so until the pass says it is done.
import type { Bundle, Comp } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import { type Attached, attachedTo } from '@yaks/blob/attachment'
import type { Graph } from '@yaks/graph'
import { attachmentKey } from './attachments.ts'
import type { Space } from './directory.ts'
import type { Kept } from './operator-draw.ts'
import { sourceId } from './operator-source.ts'

/** Where a store says no line of it names its files on itself any more
 * (files-move.ts `filesBackfill`). */
export let FILES = 'operator:files'

/** A line's files and the message they are attached beside, which the
 * conversation's links to them name (`?attachment=<message>&file=<i>`). */
export type Sent = { message: string; files: Attached[] }

/** Each line's files, by the line's eid. */
export type Files = Map<string, Sent>

/** A file as the Operator keeps it in the space's bucket, with the words
 * read from it for a model that cannot read it as it is, once read. */
export type File = {
  name: string
  mime: string
  key: string
  size?: number
  text?: string
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let str = (v: unknown) => typeof v == 'string' ? v : ''

/** A file kept in the space's bucket, as an attachment names it. */
export let keptOf = (space: Pick<Space, 'store'>, file: Attached): File => ({
  name: file.name,
  mime: file.media_type,
  key: attachmentKey(space, file.address),
  ...file.size == null ? {} : { size: file.size },
  ...file.text == null ? {} : { text: file.text },
})

/** The id a file attached to the Operator goes by: the digest its key ends
 * in (attachments.ts). */
export let attachmentId = (file: File) => file.key.split('/').at(-1)!

/** A kept file as an attachment names it. */
export let attachedOf = (file: File): Attached => ({
  name: file.name,
  media_type: file.mime,
  address: attachmentId(file),
  ...file.size == null ? {} : { size: file.size },
  ...file.text == null ? {} : { text: file.text },
})

/** Whether a store's lines all find their files among its attachments. A
 * store kept nowhere was made in memory with the words that put them there. */
export let moved = (store: { marks?: Pick<Meta, 'get'> }) =>
  !store.marks || store.marks.get(FILES) == 'done'

/** Each line's files as the conversation draws them (operator-draw.ts
 * `Kept`): their names and kinds, and the message their links name. */
export let drawnFiles = async (
  store: { g: Pick<Graph, 'read' | 'get'>; marks?: Pick<Meta, 'get'> },
  lines: Bundle[],
): Promise<Record<string, Kept>> =>
  Object.fromEntries(
    [...await filesOf(store, lines)].map(([line, { message, files }]) => [
      line,
      {
        message,
        files: files.map((f) => ({ name: f.name, mime: f.media_type })),
      },
    ]),
  )

/** The files of each of these lines that has any: words given with what
 * came with them, a step's result with what it made. */
export let filesOf = async (
  store: { g: Pick<Graph, 'read' | 'get'>; marks?: Pick<Meta, 'get'> },
  lines: Bundle[],
): Promise<Files> => {
  let out: Files = new Map()
  let asked = new Map<string, string[]>()
  let old = !moved(store)
  for (let b of lines) {
    let kept = comp(b, 'operator_files')
    if (old && Array.isArray(kept?.files)) {
      out.set(b.entity.eid, {
        message: str(kept.request) || b.entity.eid,
        files: (kept.files as File[]).map(attachedOf),
      })
    } else if (b.result || (b.content && !b.output && !b.prompt)) {
      asked.set(
        b.entity.eid,
        [
          str(comp(b, 'intake')?.item),
          b.entity.eid,
          str(comp(b, 'result')?.call),
        ].filter(Boolean),
      )
    }
  }
  let held = await attachedTo(store.g, [...asked.values()].flat())
  let byEid = new Map(lines.map((b) => [b.entity.eid, b]))
  for (let [line, messages] of asked) {
    let message = messages.find((m) => held.has(m))
    // The original words a line refers to (operator-source.ts) are kept
    // beside it too, but are no file it came with.
    let source = sourceId(str(comp(byEid.get(line), 'content')?.body))
    let files = message
      ? held.get(message)!.filter((f) => f.address != source)
      : []
    if (files.length) out.set(line, { message: message!, files })
  }
  return out
}
