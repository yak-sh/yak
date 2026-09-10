import type { VocabDoc } from '@yaks/vocab'
import gitDoc from './vocab.json' with { type: 'json' }
export const checkoutDoc: VocabDoc = {
  title: 'git-checkout',
  $defs: Object.fromEntries(
    ['repository', 'worktree', 'ref', 'checkout'].map(
      (k) => [k, (gitDoc.$defs as Record<string, unknown>)[k]],
    ),
  ) as VocabDoc['$defs'],
}
