// The page's outbox: the mail service the tab's mail effect hands a letter
// to, standing in for a real one, so nothing leaves the page. It turns each
// letter away the first time, as a mail service that is briefly unreachable
// does, so the effect can be seen trying again, and keeps each letter it then
// takes for the page to show.
import { type Message, type Receipt, Unsent } from '@yaks/host/senders'

/** One hand-over: when, which letter, and the id the outbox gave it, or why
 * it turned it away. */
export type Try = {
  at: number
  subject: string
  from: string
  to: string
  id?: string
  said?: string
}

export type Outbox = ReturnType<typeof outbox>

/** Why the outbox turns a letter away the first time. */
export const AWAY = 'the outbox could not be reached'

/** An outbox whose first refusal of a letter asks to be tried again after
 * `wait` ms. */
export let outbox = (wait = 1500) => {
  let tries: Try[] = []
  let kept: Message[] = []
  let listeners = new Set<() => void>()
  let told = () => listeners.forEach((l) => l())
  return {
    /** A sender, as @yaks/mail hands a letter over. */
    send: (m: Message): Promise<Receipt> => {
      let to = [m.to].flat().join(', ')
      let first = !tries.some((t) => t.subject == m.subject && t.to == to)
      let id = first ? undefined : `outbox-${kept.length + 1}`
      let { subject, from } = m
      tries.push({
        at: Date.now(),
        subject,
        from,
        to,
        ...(id ? { id } : { said: AWAY }),
      })
      if (!id) {
        told()
        return Promise.reject(new Unsent(AWAY, wait))
      }
      kept.push(m)
      told()
      return Promise.resolve({ id })
    },
    /** Every hand-over, oldest first. */
    tries: () => tries,
    /** Every letter it took. */
    kept: () => kept,
    listen: (l: () => void) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
  }
}
