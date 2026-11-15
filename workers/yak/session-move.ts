// The hosted session shape's move: each app row still holding the old
// `using` properties is rewritten into `sending` by the bridge
// (@yaks/platform/lenses `sessionBridge`).
import type { Bundle, Comp } from '@yaks/graph'
import type { Mark } from '@yaks/platform/mover'
import { sessionBridge, sessionSource } from '@yaks/platform/lenses'
import type { Rule } from './mover.ts'

export let sessionMove = (): Rule => ({
  mark: 'yak/store/session-sending/2' as Mark,
  live: 'apps',
  stores: 'apps',
  source: sessionSource,
  drop: ['input', 'instructions', 'window', 'tools'].map((p) => `using.${p}`),
  find: sessionBridge().find(),
  move: (row: Bundle) => {
    let patch = sessionBridge().put([row])[0]
    for (let p of ['input', 'instructions', 'window', 'tools']) {
      if ((row.using as Comp | undefined)?.[p] != null) {
        patch.using = { ...patch.using as object, [p]: null }
      }
    }
    let using = row.using as Comp | undefined
    if (!['provider', 'model', 'effort'].some((p) => using?.[p] != null)) {
      patch.using = null
    }
    return [patch]
  },
})
