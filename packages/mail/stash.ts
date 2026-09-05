// The sender that sends nothing: it keeps the messages in a list.
//
// This is what a test uses, and it is also what a development environment
// wants — a club's whole invitation flow runs end to end, and the letters pile
// up somewhere you can read them instead of in somebody's inbox.

import type { Message, Receipt, Sender } from './send.ts'

/** A {@link Sender} that keeps what it was given. */
export type Stash = Sender & {
  /** every message handed over, in order */
  sent: Message[]
  /** the last one, for the common assertion */
  last: () => Message | undefined
}

/** How a stash behaves. */
export type Kept = {
  /** refuse every message with this reason, to exercise the bounce path */
  refuse?: string
}

/**
 * A sender that keeps messages in memory.
 *
 * ```ts
 * import { stash } from '@yaks/mail'
 *
 * let post = stash()
 * // … send a letter …
 * post.last()?.subject // 'You are invited'
 * ```
 *
 * Receipts are `stash-1`, `stash-2`, … so a test can assert on the `via` the
 * letter was stamped with.
 */
export let stash = ({ refuse }: Kept = {}): Stash => {
  let sent: Message[] = []
  return {
    sent,
    last: () => sent[sent.length - 1],
    send: (message: Message): Promise<Receipt> =>
      refuse
        ? Promise.reject(new Error(refuse))
        : Promise.resolve(sent.push(message)).then((n) => ({
          id: `stash-${n}`,
        })),
  }
}
