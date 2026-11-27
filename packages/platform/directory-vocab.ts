// The directory's store words, beside platformDoc's.
import { type VocabDoc } from '@yaks/vocab'
import { mcpRetirementDoc, sweepDoc } from './sweep-vocab.ts'
import { appPermissionsWords } from './app-friends.ts'
import directoryJson from './vocab/directory.vocab.json' with { type: 'json' }
import useJson from './vocab/use.vocab.json' with { type: 'json' }
import servingJson from './vocab/serving.vocab.json' with { type: 'json' }
import referralJson from './vocab/referral.vocab.json' with { type: 'json' }
import previewJson from './vocab/preview.vocab.json' with { type: 'json' }
import presenceJson from './vocab/presence.vocab.json' with { type: 'json' }
import sweepInstallJson from './vocab/sweep-install.vocab.json' with {
  type: 'json',
}
export let directoryDoc: VocabDoc = directoryJson as VocabDoc
export let useDoc: VocabDoc = useJson as VocabDoc
// How the directory serves an app, in words no app's manifest needs kept
// from it: they only ever sit on the directory's own app rows.
export let servingDoc: VocabDoc = servingJson as VocabDoc
// A person's own invite to yaks.app (referral.ts, D-136811): words only the
// directory keeps, about people, so no app's manifest needs them kept from it.
export let referralDoc: VocabDoc = referralJson as VocabDoc
// A draft's preview link (@yaks/platform/preview, workers/yak preview.ts):
// the short random code its address carries, `/<app>/~<code>/`, and what the
// link opens, as whom and until when. The code is the credential; deleting
// the row revokes the link.
export let previewDoc: VocabDoc = previewJson as VocabDoc
// The setting lives on a person in the directory. Apps can declare their
// own presence components for live cursors and other page activity.
let presenceDoc: VocabDoc = presenceJson as VocabDoc
export let docs: VocabDoc[] = [
  appPermissionsWords,
  directoryDoc,
  presenceDoc,
  previewDoc,
  referralDoc,
  sweepDoc,
  mcpRetirementDoc,
  useDoc,
  servingDoc,
  // The release's start-up work that seeds the schedules (directory-effects.ts).
  sweepInstallJson as VocabDoc,
]
