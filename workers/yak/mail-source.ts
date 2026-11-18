// Inbound originals stay private and independent of an app's accepted uploads.
// The address prefix lets recovery find a mailbox's captures by listing it.
import type { Incoming, MailSource } from '@yaks/host/senders'
import { type Capture, capturing } from '@yaks/mail'
import { addressOf } from '@yaks/blob'
import { sha256 } from '@yaks/graph/sha256'
import { r2RawObjects } from './lib/objects.ts'
import type { Env } from './env.ts'

/** An original part in private byte storage; no public upload is made. */
export type MailFile = { name: string; type: string; key: string; size: number }

/** A recoverable manifest whose original parts are held at their byte keys. */
export type MailCapture = Capture<MailFile>

/** Preserve a delivery before acknowledging it, even if its parsed route refuses it. */
export let keepMail = async (env: Env, mail: Incoming): Promise<string> => {
  let objects = r2RawObjects(env.BLOBS)
  let files = new Map<MailSource, MailFile>()
  for (let file of [...mail.attachments, ...mail.sources ?? []]) {
    let key = `mail-source/bytes/${await addressOf(file.bytes)}`
    await objects.put(key, file.bytes)
    files.set(file, {
      name: file.name,
      type: file.type,
      key,
      size: file.bytes.length,
    })
  }
  let body = JSON.stringify(capturing(mail, (file) => files.get(file)!))
  let address = encodeURIComponent(mail.to.trim().toLowerCase())
  let key = `mail-source/${address}/${sha256(body)}.json`
  await objects.put(key, new TextEncoder().encode(body))
  return key
}
