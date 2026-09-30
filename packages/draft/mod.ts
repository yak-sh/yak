/**
 * @yaks/draft: what a person has typed and not yet sent. A draft is graph
 * data, kept by the store like anything else, one per person and place, on an
 * entity whose eid both derive (`draftEid`), so every interface the person
 * uses (another tab, a terminal, another device) finds and shows the same one
 * until it is sent or discarded, which empties its text in the journal, where
 * it can be undone.
 *
 * - `draftDoc`, `docs`: `draft{by, place, text, rev}` and the `typed{over}`
 *   event (vocab.json).
 * - `drafts()`: the plugin a store composes; its hook (`merging`) merges a
 *   write over what another interface wrote meanwhile (plugin.ts).
 * - `merge(base, mine, theirs)`: two texts typed over one, made one, losing
 *   neither (merge.ts).
 * - `desk(client, opts)`: an interface's drafts, typed into at once, kept
 *   across a reload, written to the store at a pace (desk.ts).
 *
 * @module
 */

export { docs, draftDoc } from './vocab.ts'
export { drafts, merging } from './plugin.ts'
export { merge } from './merge.ts'
export {
  type Client,
  desk,
  type DeskOpts,
  draftEid,
  type Drafts,
  type Stash,
} from './desk.ts'
