// The sender that sends nothing: it keeps the texts in an array, for tests
// and for a box with no provider.

import { Blocked, type Receipt, type Sender, type Text } from './text.ts'

/** A {@link Sender} that keeps what it was given. */
export type Stash = Sender & {
  /** every text handed over, in order */
  sent: Text[]
  /** the last one */
  last: () => Text | undefined
}

/**
 * A sender that keeps texts in memory. Receipts are `stash-1`, `stash-2`, ….
 * `refuse` rejects every text with that reason, and `block` rejects it as
 * {@link Blocked}, the way a carrier refuses an unregistered number.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { stash } from '@yaks/phone'
 * let texts = stash()
 * equal(await texts.send({ to: '+12695550142', text: 'Hi' }), { id: 'stash-1' })
 * equal(texts.last()?.text, 'Hi')
 * ```
 */
export let stash = (
  { refuse, block }: { refuse?: string; block?: string } = {},
): Stash => {
  let sent: Text[] = []
  return {
    sent,
    last: () => sent.at(-1),
    send: (text: Text): Promise<Receipt> =>
      block
        ? Promise.reject(new Blocked(block))
        : refuse
        ? Promise.reject(new Error(refuse))
        : Promise.resolve({ id: `stash-${sent.push(text)}` }),
  }
}
