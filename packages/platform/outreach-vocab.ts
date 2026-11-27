// The directory's outreach trials (./outreach.ts, ./outreach-trial.ts): what every space's Operator
// would write its people, given what changed lately, kept as rows for the
// platform admin to read and never sent.
import type { VocabDoc } from '@yaks/vocab'
import outreachJson from './vocab/outreach.vocab.json' with { type: 'json' }

export let docs: VocabDoc[] = [outreachJson as VocabDoc]
