// The $49 plan keeps its subscriptions, dates and allowances while its tier
// becomes Pro. Only the platform's plan rows move; an app's own word is its own.
import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Rule } from './mover.ts'

export let proMove = (row: Bundle): Bundle[] =>
  (row.plan as Comp | undefined)?.tier == 'organization'
    ? [{
      entity: { eid: row.entity.eid },
      plan: { tier: 'pro' },
      $was: { plan: { tier: token('organization') } },
    }]
    : []

export let proRule: Rule = {
  mark: 'yak/store/pro-plan/1',
  stores: [PLATFORM_STORE],
  core: ['plan'],
  find: '.plan.tier=organization&*',
  move: proMove,
}
