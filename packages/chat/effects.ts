// Posting a chat message kept in the graph: one wearing `chat_message` and
// @yaks/mail's `deliver{to}` asks to be posted in the `chat_room` that
// `deliver.to` names, by the bot of its `connection`. The effect runs after
// the write commits, hands it to the chatter its host lends for the platform
// (`Host.chatters`, by `chat_message.via`), and writes the outcome back as
// `delivered` or `bounced`, the words a letter's and a text's outcome use.
//
// A private message (`chat_private{to}`) is never posted as its words: its
// room gets a line naming the one it is for, with a button that shows them
// its words alone (@yaks/chat `notice`).
//
// Posting is at most once, as sending a text is (@yaks/phone): `deliver.tried`
// is claimed before the message reaches the chatter, and only a chatter's
// `Unsent` gives the claim back, to be tried again.

import type { Bundle, Comp, Entity, ReadTx } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import type { Handler, Handlers } from '@yaks/effects'
import type { Host } from '@yaks/host'
import { type Control, Unsent } from '@yaks/host/senders'
import { notice } from './mod.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let get = async (tx: ReadTx, eid: string) => (await tx.get([eid]))[0]

/** Whether a message is still owed a post: it asks to go, was never handed
 * to a chatter, and has no outcome. */
export let owed = (message: Bundle | undefined): boolean =>
  !!comp(message, 'chat_message') && !!comp(message, 'deliver') &&
  comp(message, 'deliver')?.tried == null && !comp(message, 'delivered') &&
  !comp(message, 'bounced')

/**
 * The `chat_post` handler, with the chatter for the message's platform: post
 * it and write back what became of it. A message naming no room or no
 * connection is bounced and thrown, as is any refusal but `Unsent`, so the
 * host's reporter hears it.
 */
export let posting = (
  chatterOf: NonNullable<Host['chatter']>,
  now = (): string => new Date().toISOString(),
): Handler =>
async (event, tx, write, attempt) => {
  let entity: Entity = event.entity
  let message = await get(tx, entity.eid)
  if (!owed(message)) return
  let said = comp(message, 'chat_message')!
  let via = String(said.via ?? '')
  let settle = (out: Record<string, Comp>) => write([{ entity, ...out }])
  let bounce = (reason: string) =>
    settle({ bounced: { at: now(), reason: reason.slice(0, 500) } })
  let to = String(comp(message, 'deliver')?.to ?? '')
  let room = comp(await get(tx, to), 'chat_room')
  let connection = said.connection ? String(said.connection) : undefined
  if (!room?.id || (!connection && (!room.platform_bot || room.server))) {
    let why = !room?.id ? `no chat room ${to}` : 'no connection to post it with'
    await bounce(why)
    throw new Error(`chat message ${entity.eid}: ${why}`)
  }
  let chatter = await chatterOf(via)
  let waiting = !chatter
    ? `waiting for a chatter: nothing lends ${via}`
    : chatter.waiting?.()
  if (waiting) {
    await write([{ entity, deliver: { waiting } }])
    if (attempt?.defer) return attempt.defer(60_000)
    throw new Error(`@yaks/chat — ${waiting}`)
  }
  let stamp = now()
  try {
    await write([{
      entity,
      deliver: { tried: stamp, waiting: null },
      $was: { deliver: { tried: token(comp(message, 'deliver')?.tried) } },
    }])
  } catch (error) {
    // Another run claimed it first.
    if (error instanceof Stale && error.eid == entity.eid) return
    throw error
  }
  let alone = comp(message, 'chat_private')?.to
  let controls = said.controls as Control[] | undefined
  let posted
  try {
    posted = await chatter!.post({
      ...connection ? { connection } : {},
      room: String(room.id),
      ...alone ? notice(entity.eid, String(alone)) : {
        text: String(comp(message, 'doc')?.body ?? ''),
        ...controls?.length ? { controls } : {},
      },
      ...said.reply_to ? { reply_to: String(said.reply_to) } : {},
      ...said.thread ? { thread: String(said.thread) } : {},
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
    throw error
  }
  await settle({
    ...posted.id ? { chat_message: { message_id: posted.id } } : {},
    delivered: { at: now() },
  })
}

/** `@yaks/chat/effects`: `chat_post`, through the chatter the host lends for
 * each message's platform. */
export let effects = (
  host?: Pick<Host, 'chatters' | 'chatter'> | null,
): Handlers => ({
  chat_post: posting((via) => host?.chatters?.[via] ?? host?.chatter?.(via)),
})
