// The page's outbox: the mail service the tab's mail effect hands a letter
// to, standing in for a real one, so nothing leaves the page. It turns each
// letter away the first time, as a busy mail service does, so the effect can
// be seen trying again on its own, and keeps each letter it then takes for
// the page to show.
import { type Message, type Receipt, Unsent } from '@yaks/host/senders'

/** One hand-over: when, which letter, and the id the outbox gave it, or why
 * it turned it away and how long it asked the effect to wait. */
export type Try = {
  at: number
  subject: string
  from: string
  to: string
  id?: string
  said?: string
  again?: number
}

export type Outbox = ReturnType<typeof outbox>

/** One thing that happened to a letter at the mail service: handed over,
 * refused, or taken. */
export type Event = { kind: 'handed' | 'refused' | 'sent'; line: string }

const NTH = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth']
let nth = (i: number) => NTH[i] ? `${NTH[i]} try` : `Try ${i + 1}`

let seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** What happened to one letter at the mail service, in order and in plain
 * words: each time the mail effect handed it over, and what the mail
 * service answered. A refusal is the mail service's answer, not a failure
 * here: the letter is kept, and the effect tries again on its own. */
export let happened = (tries: Try[]): Event[] =>
  tries.flatMap((t, i): Event[] => [
    {
      kind: 'handed',
      line: i
        ? `${nth(i)}, ${
          seconds(t.at - tries[i - 1].at)
        } later: the effect hands it over again, on its own.`
        : `${nth(0)}: the effect hands the letter to the mail service.`,
    },
    t.id ? { kind: 'sent', line: 'The mail service takes it: sent.' } : {
      kind: 'refused',
      line: `The mail service refuses it: ${t.said}. Nothing here failed; ${
        t.again
          ? `the letter is kept, and the effect tries again in ${
            seconds(t.again)
          }.`
          : 'the letter is kept.'
      }`,
    },
  ])

/** Why the outbox turns a letter away the first time. */
export const AWAY = 'the mail service is busy'

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
      let id = first ? undefined : `${kept.length + 1}@outbox.yak.sh`
      let { subject, from } = m
      tries.push({
        at: Date.now(),
        subject,
        from,
        to,
        ...(id ? { id } : { said: AWAY, again: wait }),
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
