// What a text costs the space it is sent or heard for: the space's one budget
// (D-131886, M-42105), the dollars its models and voice spend. A text that
// leaves through a phone the platform pays for (phones.ts) is held on the
// budget before it goes, refused there when the budget cannot pay, and
// charged once it went; one that arrives is counted (meter.ts
// `countedTexts`, at `costOf`), never refused, since a text turned away at
// the door is somebody's words lost. A text through a
// number a person connected of their own (operator-line.ts) is theirs to pay
// and is counted nowhere here.
import type { Texter } from '@yaks/host/senders'
import { ModelError } from '@yaks/model'
import { CallError } from '@yaks/tools/errors'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { onHold } from './model-spend.ts'
import { refuse } from './tool.ts'

/** Dollars a segment of a text costs: Telnyx's US rate, $0.004 a segment
 * each way, with the carriers' pass-through fees (up to about $0.004) on
 * top. */
export let PER_SEGMENT = 0.008

/**
 * How many segments a carrier sends `text` as: 160 characters in one, 153 in
 * each of several, or 70 and 67 when it needs more than GSM's characters.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { segments } from './text-spend.ts'
 * equal(segments('Prayer meeting at 7.'), 1)
 * equal(segments('a'.repeat(161)), 2)
 * equal(segments('🙏'.repeat(71)), 2)
 * ```
 */
export let segments = (text: string) => {
  let gsm = /^[\n\r\x20-\x7e£¥èéùìòÇØøÅåÄÖÑÜäöñüà§¿¡]*$/.test(text)
  let [one, each] = gsm ? [160, 153] : [70, 67]
  let n = gsm ? text.length : [...text].length
  return n <= one ? 1 : Math.ceil(n / each)
}

/** The dollars `text` costs, sent or received. */
export let costOf = (text: string) => segments(text) * PER_SEGMENT

/** Whether `error` is a text refused for the space's budget (`charged`). */
export let unpaid = (error: unknown) =>
  error instanceof CallError && error.code == 'limit'

/**
 * `texter`, its texts paid from `space`'s budget: each held before it goes,
 * refused in the directory's own transaction when the budget cannot pay it
 * (model-spend.ts `onHold`), which rejects as a `limit` refusal in words for
 * the person, and charged once it went.
 */
export let charged = (env: Env, space: Space, texter: Texter): Texter => ({
  ...texter,
  send: (text) => {
    let cost = costOf(text.text)
    return onHold(env, space, cost, 'texts', async (spent) => {
      let receipt = await texter.send(text)
      spent(cost)
      return receipt
    }).catch((e) => {
      throw e instanceof ModelError && e.code == 'limit'
        ? refuse('limit', e.message)
        : e
    })
  },
})
