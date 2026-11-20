// A provider's batch API, the same for every provider: many one-turn requests
// sent as one, answered within a day at half the price. Requests that begin
// with the same system text share their provider's cache of it, so a long
// prefix every request carries is paid in full once and read cheaply by the
// rest. Each provider implements it over its own wire (@yaks/anthropic/batches,
// @yaks/openai/batches).
import type { Usage } from './vocab.ts'

/** What a batch costs against the same requests sent one by one. */
export let BATCH = 0.5

/** One request of a batch: the system text it shares with the others, then
 * its own text, answered by `model` in at most `max` tokens. `id` names its
 * answer, which comes back in any order. `cache` names the shared prefix,
 * where a provider routes requests by it. */
export type Asked = {
  id: string
  model: string
  system: string
  text: string
  max: number
  cache?: string
}

/** One request's answer: its text and what it used, or why there is none. */
export type Answered =
  | { id: string; text: string; usage: Usage }
  | { id: string; error: string }

/** A provider's batches: send one, ask whether it has ended, read its
 * answers. */
export type Batches = {
  /** sends the requests as one batch, and answers its id */
  submit: (asked: Asked[]) => Promise<string>
  ended: (id: string) => Promise<boolean>
  results: (id: string) => Promise<Answered[]>
}
