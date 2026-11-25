import type { Plugin } from '@yaks/graph'

/** What tells the Operator's store of its own commits, for the
 * subscriptions over it: `stirred` after each commit beyond the scheduler's
 * own (one of wakes alone, as a look that rests writes), so a look never
 * stirs another. */
export let ownCommits = (stirred: () => void): Plugin => ({
  name: 'yak/subscriptions',
  hooks: {
    effect: (bundles) => {
      if (bundles.some((b) => !b.wake)) stirred()
      return bundles
    },
  },
})
