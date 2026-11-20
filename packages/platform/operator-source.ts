// The original message attachment and channel framing are rendered with the
// model's input. The transcript holds the words on their own.
import type { Bundle, Comp } from '@yaks/graph/bundle'

let BEFORE = '\n\nOriginal message text: message.txt (attachment '
let AFTER =
  '). Read its exact text with attachment_read inside code_mode, or write it into the sandbox with sandbox_write and attachment; do not retype it.'

export let sourceReference = (id: string) => BEFORE + id + AFTER

/** The exact final note as older inputs stored it. */
export let sourceId = (body: string) => {
  let at = body.lastIndexOf(BEFORE)
  if (at < 0) return undefined
  let id = body.slice(at + BEFORE.length, at + BEFORE.length + 64)
  return /^[0-9a-f]{64}$/.test(id) && body.slice(at) == sourceReference(id)
    ? id
    : undefined
}

export let sourceWords = (body: string, source = sourceId(body)) =>
  source ? body.slice(0, -sourceReference(source).length) : body

/** The original message attachment of an input. An empty value records an
 * input composed from its own words without a separate source attachment. */
export let sourceOf = (entry: Bundle) =>
  (entry.intake as Comp | undefined)?.source as string | undefined

/** How a line's words came, including the component older stores used. */
export let cameBy = (entry: Bundle): { name?: string; framing?: string } => {
  let channel = entry.channel as Comp | undefined
  let old = entry.operator_channel as Comp | undefined
  return {
    name: (channel?.name ?? old?.channel) as string | undefined,
    framing: (channel ? channel.framing : old?.framing) as string | undefined,
  }
}

/** Render the source note only for inputs written in the new form. A legacy
 * input already carries its framing and source note in its body. */
export let inputBody = (entry: Bundle, body: string) => {
  let source = sourceOf(entry)
  if (source == null) return body
  return (cameBy(entry).framing ?? '') + body +
    (source ? sourceReference(source) : '')
}

export let unframe = (body: string, framing = '') =>
  body.startsWith(framing) ? body.slice(framing.length) : body
