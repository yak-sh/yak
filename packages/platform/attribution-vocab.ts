// Guest-write registration and directory attribution declarations.
import type { VocabDoc } from '@yaks/vocab'
import attributionJson from './vocab/attribution.vocab.json' with {
  type: 'json',
}
import registrationJson from './vocab/registration.vocab.json' with {
  type: 'json',
}
export let attributionDoc: VocabDoc = attributionJson as VocabDoc
export let registrationDoc: VocabDoc = registrationJson as VocabDoc
export let docs: VocabDoc[] = [attributionDoc, registrationDoc]
