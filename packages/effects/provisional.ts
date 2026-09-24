// The mark an entity wears while an asynchronous step about it has not
// finished: a value being sealed into a vault after its write committed, say.
// The entity sits where it always does, whole, and wears `provisional` beside
// its other components; the effect that finishes the step removes the mark.
//
// It is generic on purpose. What the step is, and what happens when it fails,
// are the registering package's to say; this names the mark once, so every
// reader can show "not settled yet" the same way, with the `note` line the
// step left for the person looking.

import type { VocabDoc } from '@yaks/vocab'
import { effectDoc } from './durable.ts'

/** The mark's component, by the name ./vocab.json declares it. */
export let PROVISIONAL = 'provisional'

/**
 * The mark on its own, for a vocabulary that wants it without the durable
 * ledger: `loadVocab([provisionalDoc, ...mine])`. {@link effectDoc} carries it
 * too, so a host loads one or the other, never both.
 */
export let provisionalDoc: VocabDoc = {
  title: PROVISIONAL,
  $defs: { [PROVISIONAL]: effectDoc.$defs![PROVISIONAL] },
}
