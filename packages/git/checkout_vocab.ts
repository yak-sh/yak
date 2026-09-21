// The four components that describe checkouts on one machine — `repository`,
// `worktree`, `ref` and `checkout` — pulled out of ./vocab.json as a document
// of their own, for a graph that tracks checkouts but stores no Git objects.

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
