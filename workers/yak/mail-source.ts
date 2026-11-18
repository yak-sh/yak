// Inbound originals stay private and independent of an app's accepted uploads.
// The address prefix lets recovery find a mailbox's captures by listing it.
import type { Incoming } from '@yaks/host/senders'
import { capture } from '@yaks/mail'
import { sha256 } from '@yaks/graph/sha256'
import { r2RawObjects } from './lib/objects.ts'
import type { Env } from './env.ts'

/** Preserve a delivery before acknowledging it, even if its parsed route refuses it. */
export let keepMail = async (env: Env, mail: Incoming): Promise<string> => {
  let body = JSON.stringify(capture(mail))
  let address = encodeURIComponent(mail.to.trim().toLowerCase())
  let key = `mail-source/${address}/${sha256(body)}.json`
  await r2RawObjects(env.BLOBS).put(key, new TextEncoder().encode(body))
  return key
}
