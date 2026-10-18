// The hosted session shape bridge. Kept pages speak the release they loaded;
// pending rows expand at the graph door until the bounded mover consumes them.
import type { VocabDoc } from '@yaks/vocab'
import { compile, lensesIn, versions } from '@yaks/lens'
import { packageEid } from '@yaks/lens'
import session from '../../packages/session/vocab.json' with { type: 'json' }

export let sessionStep = 20261018010000
export let sessionPackage = packageEid('@yaks/session')
export let sessionLens: VocabDoc = {
  package: '@yaks/session',
  $defs: {
    session_sending: {
      lens: true,
      live: false,
      step: sessionStep,
      ops: ['input', 'instructions', 'window', 'tools'].map((p) => ({
        rename: { from: `using.${p}`, to: `sending.${p}` },
      })),
    },
  },
}
export let sessionSource: VocabDoc = {
  $defs: {
    using: {
      component: true,
      type: 'object',
      extends: true,
      properties: session.$defs.sending.properties,
    },
  },
}
export let sessionRows = () => lensesIn([sessionLens])
export let sessionVersions = () => versions([sessionLens])
export let sessionBridge = () => compile(sessionRows(), { [sessionPackage]: 0 })

export let sessionMove = (): import('./mover.ts').Rule => ({
  mark: 'yak/store/session-sending/2' as import('./mover.ts').Mark,
  live: 'apps',
  source: sessionSource,
  drop: ['input', 'instructions', 'window', 'tools'].map((p) => `using.${p}`),
  find: sessionBridge().find(),
  move: (row: import('@yaks/graph').Bundle) => {
    let patch = sessionBridge().put([row])[0]
    for (let p of ['input', 'instructions', 'window', 'tools']) {
      if ((row.using as import('@yaks/graph').Comp | undefined)?.[p] != null) {
        patch.using = { ...patch.using as object, [p]: null }
      }
    }
    let using = row.using as import('@yaks/graph').Comp | undefined
    if (!['provider', 'model', 'effort'].some((p) => using?.[p] != null)) {
      patch.using = null
    }
    return [patch]
  },
})
