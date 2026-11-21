// A space on the Pro plan, paid or comped, is given the one-time grant on top
// of what is left of its starter; a space on another plan, or one that had
// it, is left alone.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { PRO_GRANT, STARTER } from '@yaks/platform/plans'
import { proGrantMove } from './pro-grant-move.ts'

let now = new Date('2026-11-21T00:00:00.000Z')
let space = (more: Record<string, unknown>) => ({
  entity: { eid: 'x' },
  space: { slug: 'x' },
  ...more,
})
let given = (more: Record<string, unknown>) =>
  proGrantMove(space(more), now)[0]?.starter

test('a Pro space, paid or comped, is given the grant on its starter', () => {
  assertEquals(
    [
      given({ plan: { tier: 'pro' } }),
      given({ comp: { tier: 'pro' } }),
      given({ plan: { tier: 'pro' }, starter: { dollars: 0 } }),
      given({ plan: { tier: 'plus' } }),
      given({}),
    ],
    [
      { dollars: STARTER + PRO_GRANT },
      { dollars: STARTER + PRO_GRANT },
      { dollars: PRO_GRANT },
      undefined,
      undefined,
    ],
  )
})
