// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/phone/vocab`. It reaches no storage, no SQL
// and no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './package.json' with { type: 'json' }

/** The phone vocabulary: `phone{number}`, `sms_consent{person, consent,
 * at, space}` and `text{from, to, at, message_id, rcs}`, in the form
 * `loadVocab` accepts. */
export let phoneDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this package declares. */
export let docs: VocabDoc[] = [phoneDoc]
