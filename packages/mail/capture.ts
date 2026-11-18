// A delivery's recoverable source, independent of its parsed graph projection.
// Bytes are base64 in the JSON capture so any private byte store can keep it.
import { fromBase64, toBase64 } from '@yaks/fp'
import type { Incoming, MailSource } from '@yaks/host/senders'

type Part = { name: string; type: string; base64: string }

/** A complete delivery: the neutral envelope and original provider bytes. */
export type Capture = {
  from: string
  to: string
  name?: string
  headers: [string, string][]
  text: string
  html?: string
  verified?: boolean
  vouched?: boolean
  attachments: Part[]
  sources: Part[]
}

let part = ({ bytes, ...file }: MailSource): Part => ({
  ...file,
  base64: toBase64(bytes),
})

/** Keep all bytes before projecting a delivery into a letter or an upload. */
export let capture = (
  { headers, attachments, sources, ...mail }: Incoming,
): Capture => ({
  ...mail,
  headers: [...headers.entries?.() ?? []],
  attachments: attachments.map(part),
  sources: (sources ?? []).map(part),
})

/** Read original files from a capture, including ones an app could not take. */
export let captured = (parts: Part[]): MailSource[] =>
  parts.map(({ base64, ...file }) => ({ ...file, bytes: fromBase64(base64) }))
