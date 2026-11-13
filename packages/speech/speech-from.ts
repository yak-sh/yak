// How a persona speaks aloud (`speech{voice, pace, model, backend}`,
// ./vocab.json): its own, each property it lacks its base persona's, and what
// none of them holds the host's to choose.

/** A persona's `speech{}`: each property an id the host knows, or none. */
export type Speech = {
  voice?: string | null
  pace?: string | null
  model?: string | null
  backend?: string | null
}

let KEYS = ['voice', 'pace', 'model', 'backend'] as const

/** The speech of the first row in `chain` (a persona, then the persona it is
 * worn on, and so on) that holds each property; a property none holds is
 * absent, for the host's own.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { speechFrom } from './speech-from.ts'
 * equal(
 *   speechFrom({ speech: { pace: 'relaxed', voice: null } }, { speech: { voice: 'ash' } }),
 *   { voice: 'ash', pace: 'relaxed' },
 * )
 * equal(speechFrom(undefined, {}), {})
 * ```
 */
export let speechFrom = (
  ...chain: (Record<string, unknown> | undefined)[]
): Speech =>
  Object.fromEntries(KEYS.flatMap((k) => {
    let v = chain.map((row) => (row?.speech as Speech | undefined)?.[k])
      .find((v) => v != null)
    return v == null ? [] : [[k, v]]
  }))
