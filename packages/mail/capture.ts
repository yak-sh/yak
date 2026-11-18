// A delivery's recoverable source, independent of its parsed graph projection.
// Bytes are base64 in the JSON capture so any private byte store can keep it.
import { fromBase64, toBase64 } from '@yaks/fp'
import type { Incoming, MailSource } from '@yaks/host/senders'

type Part = { name: string; type: string; base64: string }

/** A complete delivery: the neutral envelope and original provider bytes. */
export type Capture<File = Part> = {
  from: string
  to: string
  name?: string
  headers: [string, string][]
  text: string
  html?: string
  verified?: boolean
  vouched?: boolean
  attachments: File[]
  sources: File[]
}

let part = ({ bytes, ...file }: MailSource): Part => ({
  ...file,
  base64: toBase64(bytes),
})

/** Describe a delivery with its files encoded by the caller, such as private byte references. */
export let capturing = <File>(
  { headers, attachments, sources, ...mail }: Incoming,
  file: (source: MailSource) => File,
): Capture<File> => ({
  ...mail,
  headers: [...headers.entries?.() ?? []],
  attachments: attachments.map(file),
  sources: (sources ?? []).map(file),
})

/** Keep all bytes before projecting a delivery into a letter or an upload. */
export let capture = (mail: Incoming): Capture => capturing(mail, part)

/** Read original files from a capture, including ones an app could not take. */
export let captured = (parts: Part[]): MailSource[] =>
  parts.map(({ base64, ...file }) => ({ ...file, bytes: fromBase64(base64) }))
