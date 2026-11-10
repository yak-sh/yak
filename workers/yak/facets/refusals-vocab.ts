// The directory's refusal report declaration (refusals.ts): what its hourly
// wake owes.
import type { VocabDoc } from '@yaks/vocab'
export let docs: VocabDoc[] = [{
  $defs: {
    report_refusals: {
      effect: true,
      created: ['fired'],
      changed: ['fired'],
      target: '.sweep.kind=refusals',
      description:
        'count the tool refusals no report has counted into one letter to TaskMaster, at the hour its wake fires',
    },
  },
}]
