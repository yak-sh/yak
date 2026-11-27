// The four components that describe checkouts on one machine — `repository`,
// `worktree`, `ref` and `checkout` — pulled out of ./vocab.json as a document
// of their own, for a graph that tracks checkouts but stores no Git objects.

import { pick, type VocabDoc } from '@yaks/vocab/runtime'
import gitDoc from './vocab.json' with { type: 'json' }
export const checkoutDoc: VocabDoc = pick(
  gitDoc as VocabDoc,
  ['repository', 'worktree', 'ref', 'checkout'],
  'git-checkout',
)
