// Sending a text kept in the graph: an entity wearing `text` and @yaks/mail's
// `deliver{to}` asks to be sent to the `phone{number}` of `deliver.to`. The
// effect runs after the write commits and writes the outcome back as
// `delivered` or `bounced`, the words a letter's outcome uses.
//
// Sending is at most once, as a letter's is: `deliver.tried` is claimed
// before the text reaches the sender, so a crash between the two leaves a
// text that is never handed over again. A sender's `Unsent` knows the text
// never left: the claim is given back and the run fails to be tried again.

import type { Bundle, Comp, Entity, ReadTx } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import type { Handler } from '@yaks/effects'
import { Unsent } from '@yaks/host/senders'
import { Blocked, consentEid, type Sender } from './text.ts'

/** How the effect is built. */
export type Texting = {
  /** what hands a text over */
  sender: Sender
  /** the clock, for a test to hold still */
  now?: () => string
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let get = async (tx: ReadTx, eid: string) => (await tx.get([eid]))[0]

/** Whether a text is still owed a send: it asks to go, was never handed to
 * a sender, and has no outcome. */
export let owed = (text: Bundle | undefined): boolean =>
  !!comp(text, 'text') && !!comp(text, 'deliver') &&
  comp(text, 'deliver')?.tried == null && !comp(text, 'delivered') &&
  !comp(text, 'bounced')

/**
 * The `text_post` handler: hand an outbound text to the sender and write
 * back what became of it. A {@link Blocked} text is bounced with the
 * carrier's reason and reports nothing; any other refusal is bounced and
 * thrown, so the host's reporter hears it.
 */
export let sending =
  ({ sender, now = () => new Date().toISOString() }: Texting): Handler =>
  async (event, tx, write) => {
    let entity: Entity = event.entity
    let text = await get(tx, entity.eid)
    if (!owed(text)) return
    let deliver = comp(text, 'deliver')!
    let settle = (out: Record<string, Comp>) => write([{ entity, ...out }])
    let bounce = (reason: string) =>
      settle({ bounced: { at: now(), reason: reason.slice(0, 500) } })
    let to = String(
      comp(await get(tx, String(deliver.to ?? '')), 'phone')
        ?.number ?? '',
    )
    if (!to) {
      await bounce(`no phone number on file for ${deliver.to}`)
      throw new Error(`text ${entity.eid}: no number for ${deliver.to}`)
    }
    // Nobody is texted before they agree; a text to someone who has not, or
    // who replied STOP, comes to rest as a bounce, which is expected.
    if (!comp(await get(tx, consentEid(String(deliver.to))), 'sms_consent')) {
      return await bounce(
        `${deliver.to} has not agreed to texts: no sms_consent is kept for them`,
      )
    }
    let stamp = now()
    try {
      await write([{
        entity,
        deliver: { tried: stamp, waiting: null },
        $was: { deliver: { tried: token(deliver.tried) } },
      }])
    } catch (error) {
      // Another run claimed it first.
      if (error instanceof Stale && error.eid == entity.eid) return
      throw error
    }
    let said = comp(text, 'text')!
    let receipt
    try {
      receipt = await sender.send({
        to,
        text: String(comp(text, 'doc')?.body ?? ''),
        ...(said.from ? { from: String(said.from) } : {}),
      })
    } catch (error) {
      if (error instanceof Unsent) {
        await write([{
          entity,
          deliver: { tried: null, waiting: error.message.slice(0, 240) },
          $was: { deliver: { tried: token(stamp) } },
        }])
        throw error
      }
      await bounce(error instanceof Error ? error.message : String(error))
      if (error instanceof Blocked) return
      throw error
    }
    await settle({
      text: {
        to,
        ...(receipt.from ? { from: receipt.from } : {}),
        ...(receipt.id ? { message_id: receipt.id } : {}),
      },
      delivered: { at: now() },
    })
  }
