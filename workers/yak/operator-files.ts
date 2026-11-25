// The files a line of an Operator's conversation came with, or a step of it
// brought back: the attachments (@yaks/blob/attachment) beside the item a
// person's words came in (@yaks/session `intake{item}`), beside the line
// itself where no item brought them, or beside the call a result answers
// (operator-channels.ts `madeFiles`). A line kept before its store's pass
// (files-move.ts) names its files on itself, as `operator_files{request,
// files}`, and is read so until the pass says it is done.
import type { Bundle, Comp } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import { type Attached, attachedTo, attachmentOf } from '@yaks/blob/attachment'
import { and, eq, fields, list } from '@yaks/query/core'
import type { Graph } from '@yaks/graph'
import { attachmentKey } from './attachment-key.ts'
import { FILES } from './operator-file-marks.ts'
import type { Space } from './directory.ts'
import type { Kept } from './operator-draw.ts'

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
 * `Kept`): their names and kinds, and the message their links name; and for
 * a step's result, the files the step read. */
export let drawnFiles = async (
  store: { g: Pick<Graph, 'read' | 'get'>; marks?: Pick<Meta, 'get'> },
  lines: Bundle[],
): Promise<Record<string, Kept>> => {
  let [made, read] = await Promise.all([
    filesOf(store, lines),
    readOf(store.g, lines),
  ])
  let out: Record<string, Kept> = {}
  for (let [line, { message, files }] of made) {
    out[line] = {
      message,
      files: files.map((f) => ({ name: f.name, mime: f.media_type })),
    }
  }
  for (let [line, files] of read) {
    out[line] = { ...out[line] ?? { message: line, files: [] }, read: files }
  }
  return out
}

/** A file a step read: its name and kind, and the message it is attached
 * beside and its place there, which its link names
 * (`?attachment=<message>&file=<i>`). */
export type Read = { name: string; mime: string; message: string; file: number }

// The 64 hex digits an attachment's bytes are kept by (attachments.ts).
let ADDRESS = /^[0-9a-f]{64}$/

let argsOf = (b: Bundle | undefined): Record<string, unknown> => {
  let args = comp(b, 'call')?.args
  if (typeof args == 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      return {}
    }
  }
  return args && typeof args == 'object' ? args as Record<string, unknown> : {}
}

// The attachment a call names, which any tool given one reads: the
// attachment_read and sandbox_write tools take it alike.
let named = (call: Bundle | undefined) => {
  let id = argsOf(call).attachment
  return typeof id == 'string' && ADDRESS.test(id) ? [id] : []
}

// The calls a step's script made (code_mode), which its answer lists by id.
let nested = (result: Bundle): string[] => {
  try {
    let { calls } = JSON.parse(str(comp(result, 'content')?.body))
    return Array.isArray(calls) ? calls.map((c) => str(c?.id)) : []
  } catch {
    return []
  }
}

/** The files each step read, by its result's eid: the attachment its call
 * names, and those the calls its script made name. A file no message of the
 * store carries is left out. */
export let readOf = async (
  g: Pick<Graph, 'read' | 'get'>,
  lines: Bundle[],
): Promise<Map<string, Read[]>> => {
  let results = lines.filter((b) => b.result)
  let byEid = new Map(lines.map((b) => [b.entity.eid, b]))
  let called = (r: Bundle) => str(comp(r, 'result')?.call)
  let wanted = results.flatMap((r) => [
    ...byEid.has(called(r)) ? [] : [called(r)],
    ...nested(r),
  ]).filter(Boolean)
  for (let b of wanted.length ? await g.get(wanted, ['call']) : []) {
    byEid.set(b.entity.eid, b)
  }
  let asked = new Map(
    results.map((r) => [
      r.entity.eid,
      [
        ...new Set(
          [called(r), ...nested(r)].flatMap((id) => named(byEid.get(id))),
        ),
      ],
    ]),
  )
  let addresses = [...new Set([...asked.values()].flat())]
  if (!addresses.length) return new Map()
  let uses = await g.read(and(
    eq('attachment.artifact', list(...addresses)),
    fields(
      'attachment.name',
      'attachment.media_type',
      'attachment.artifact',
      'attachment.message',
    ),
  ))
  // Each file by its bytes, as the first message to carry them names it.
  let files = new Map<string, Read>()
  for (let b of uses) {
    let use = comp(b, 'attachment')!
    let message = str(use.message)
    let address = str(use.artifact)
    let file = Array.from({ length: 64 }, (_, i) => i)
      .find((i) => attachmentOf(message, i) == b.entity.eid)
    if (file == null || files.has(address)) continue
    files.set(address, {
      name: str(use.name) || address,
      mime: str(use.media_type) || 'application/octet-stream',
      message,
      file,
    })
  }
  return new Map(
    [...asked].flatMap(([line, ids]) => {
      let read = ids.flatMap((id) => files.get(id) ?? [])
      return read.length ? [[line, read]] : []
    }),
  )
}

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
  for (let [line, messages] of asked) {
    let message = messages.find((m) => held.has(m))
    let files = message ? held.get(message)! : []
    if (files.length) out.set(line, { message: message!, files })
  }
  return out
}
