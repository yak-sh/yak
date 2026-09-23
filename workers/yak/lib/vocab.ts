// The words an app's store may not declare, and the scalar type words a
// tools.json names an argument by. What is left of the fleet store's
// vocabulary module: the platform's own documents live in ../vocab.ts, and
// this keeps the fleet's reserved words (./fleet.ts) and the short type map
// the tool grammar (./tools.ts) still reads.
import { FLEET_COMPS, FLEET_STAMPED } from './fleet.ts'

/** A property's type, as the fleet's vocabulary wrote one. */
export type PropType =
  | 'text'
  | 'body'
  | 'number'
  | 'priority'
  | 'bool'
  | 'query'
  | 'time'
  | 'url'
  | { enum: readonly string[]; aliases?: Record<string, string> }
  | { eid: string; death: string }
  | { text: string }

// A store's own components: one typed column per entry.
export type Vocab = Record<string, Record<string, PropType>>

// The types an app may declare, and the SQLite affinity each stores as.
export let TYPES: Record<string, string> = {
  text: 'text',
  number: 'real',
  bool: 'integer',
  time: 'text',
  url: 'text',
}

// Every word the fleet said, in one sorted list: the writable vocabulary, the
// server-stamped half, and the spine. No store may redeclare one — `doc` means
// `doc` everywhere — so this is also what the guide prints under vocab.json
// (guide_test.ts holds the two in step).
export let RESERVED: string[] = [
  ...new Set([...FLEET_COMPS, ...FLEET_STAMPED, 'entity']),
].sort()

// A use as a vocabulary sees it: the word, with no columns of its own —
// those are the home's to say. Enough for a check that asks only whether the
// word is one this app may write (store.ts `tools`).
export let borrowed = (uses: Record<string, string>): Vocab =>
  Object.fromEntries(Object.keys(uses).map((name) => [name, {}]))
