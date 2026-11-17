/**
 * An attachment is one use of immutable bytes, beside the message they came
 * with: the bytes' `artifact` row, named by their address, and an
 * `attachment` row for each message that carried them, named by that message
 * and its place there. Sending the same bytes again with another message
 * keeps both names; writing one message's files again patches the same rows.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { attachmentOf, attachmentRows } from '@yaks/blob/attachment'
 *
 * let [bytes, use] = attachmentRows('m1', [
 *   { name: 'notes.pdf', media_type: 'application/pdf', address: 'c0ffee' },
 * ])
 * equal(bytes, {
 *   entity: { eid: 'c0ffee' },
 *   artifact: { address: 'c0ffee', media_type: 'application/pdf' },
 * })
 * equal(use.entity.eid, attachmentOf('m1', 0))
 * ```
 *
 * What a reader is shown of them is {@link attachmentsSeen}: the attachment
 * rows a clause admits and the artifacts they name, and nothing else in the
 * graph, even where a query walks a reference.
 *
 * @module
 */
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { tier } from '@yaks/graph/tools'
import { ram } from '@yaks/ram'
import {
  and,
  type Clause,
  eq,
  fields,
  list,
  or,
  parse,
  type Pred,
  present,
} from '@yaks/query/core'
import { mediaTypeOf } from './image.ts'

/** A file as a message carries it: its name, media type and the address its
 * bytes are kept by, with their size where it is known, and the words read
 * from it for a model that cannot read it as it is, once something has. */
export type Attached = {
  name: string
  media_type: string
  address: string
  size?: number
  text?: string
}

/** The attachment's stable identity within the message that carried it. The
 * words it is derived from are the ones its first rows were named by. */
export let attachmentOf = (message: string, index: number): string =>
  derivedEid(`operator-attachment|${message}|${index}`)

/** The bytes of each file, and each one's use beside `message`. */
export let attachmentRows = (message: string, files: Attached[]): Bundle[] =>
  files.flatMap((file, i) => [{
    entity: { eid: file.address },
    artifact: {
      address: file.address,
      media_type: file.media_type,
      ...file.size == null ? {} : { size: file.size },
    },
  }, {
    entity: { eid: attachmentOf(message, i) },
    attachment: {
      name: file.name,
      media_type: file.media_type,
      artifact: file.address,
      message,
      ...file.text == null ? {} : { text: file.text },
    },
  }])

/** The files each of these messages came with, in the order they came: each
 * attachment beside it (`attachmentRows`) and the size its bytes are kept at.
 * A message with none is left out. */
export let attachedTo = async (
  g: Pick<Graph, 'read' | 'get'>,
  messages: string[],
): Promise<Map<string, Attached[]>> => {
  let asked = [...new Set(messages)].filter(Boolean)
  let uses = asked.length
    ? await g.read(and(
      eq('attachment.message', list(...asked)),
      fields(
        'attachment.name',
        'attachment.media_type',
        'attachment.artifact',
        'attachment.text',
      ),
    ))
    : []
  let by = new Map(uses.map((b) => [b.entity.eid, b]))
  let sizes = new Map(
    (await g.get(
      [...new Set(uses.map((b) => String(use(b).artifact)))],
      ['artifact'],
    )).map((b) => [b.entity.eid, (b.artifact as { size?: number }).size]),
  )
  let out = new Map<string, Attached[]>()
  for (let message of asked) {
    let files: Attached[] = []
    for (let i = 0, b; (b = by.get(attachmentOf(message, i))); i++) {
      let { name, media_type, artifact, text } = use(b)
      let size = sizes.get(String(artifact))
      files.push({
        name: String(name ?? artifact),
        media_type: String(media_type ?? 'application/octet-stream'),
        address: String(artifact),
        ...size == null ? {} : { size: Number(size) },
        ...text == null ? {} : { text: String(text) },
      })
    }
    if (files.length) out.set(message, files)
  }
  return out
}

let use = (b: Bundle) =>
  (b.attachment ?? {}) as {
    name?: string
    media_type?: string
    artifact?: string
    text?: string
  }

/** The artifact row of each address `head` finds kept, its media type read
 * from the first bytes `head` gives back. An address with nothing kept is
 * left out, for the graph to hold as it is. */
export let artifactsOf = async (
  addresses: string[],
  head: (address: string) => Promise<Uint8Array | null>,
): Promise<Bundle[]> => {
  let rows = await Promise.all([...new Set(addresses)].map(async (address) => {
    let first = await head(address)
    if (!first) return null
    let type = mediaTypeOf(first)
    return {
      entity: { eid: address },
      artifact: { address, ...type ? { media_type: type } : {} },
    }
  }))
  return rows.filter((b) => !!b)
}

// A clause that names one entity or one artifact, which the read of
// attachments narrows by before the query is asked of what it found.
let focusOf = (q: string): Clause | undefined => {
  let focus = parse(q).clauses.find((clause): clause is Pred =>
    clause.kind == 'pred' && clause.op == '=' &&
    ['entity.eid', 'attachment.artifact'].includes(clause.path.join('.')) &&
    !!clause.value && ['scalar', 'list'].includes(clause.value.kind)
  )
  // An id may be the attachment's own, or its bytes' address.
  return focus?.path.join('.') == 'entity.eid'
    ? or(focus, { ...focus, path: ['attachment', 'artifact'] })
    : focus
}

/**
 * `q` asked as graph_query asks it, of only the attachment rows `admits` lets
 * a reader see and the artifact rows they name: their names, media types and
 * sizes, never the messages they came with or anything else, even where `q`
 * walks a reference. `call` is the query's call, which the answer names.
 */
export let attachmentsSeen = async (
  g: Pick<Graph, 'read' | 'get' | 'vocab'>,
  admits: Clause,
  q: string,
  call: string = crypto.randomUUID(),
): Promise<Bundle[]> => {
  let focus = focusOf(q)
  let seen = (await g.read(and(
    present('attachment'),
    admits,
    ...focus ? [focus] : [],
  ))).map((row) => ({ entity: row.entity, attachment: row.attachment }))
  let addresses = seen.map((row) =>
    String((row.attachment as { artifact: string }).artifact)
  )
  let artifacts = (await g.get([...new Set(addresses)]))
    .filter((row) => row.artifact)
    .map((row) => ({ entity: row.entity, artifact: row.artifact }))
  let subset = graph({ vocab: g.vocab, storage: ram(g.vocab) })
  await subset.apply([...seen, ...artifacts] as Bundle[], {
    trusted: true,
    stamp: false,
  })
  let query = tier().find((tool) => tool.name == 'graph_query')!
  return await query.run(
    { entity: { eid: call }, call: { args: { q } } },
    subset,
  ) as Bundle[]
}
