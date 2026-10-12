// Executor availability controls admission; receipt access is independent of it.
import { equal, test } from '@yaks/testing'
import { lending, RELEASE } from './inference.ts'
import type { Stored } from './graph.ts'

for (
  let version of [undefined, {}, { executor: RELEASE }, {
    executor: 'another',
    id: 'live',
  }, { executor: RELEASE, id: 'live' }]
) {
  test(`hosted admission checks bound release ${JSON.stringify(version)}`, async () => {
    let at = {
      app: 'app',
      env: {
        MODEL_RECEIPTS: {},
        ...version
          ? { MODEL: { version: () => Promise.resolve(version) } }
          : {},
      },
    } as unknown as Stored
    let executor = await lending(at, 'openrouter')
    equal(
      await executor?.available?.(),
      !!version && 'id' in version && version.executor === RELEASE,
    )
    equal(await lending(at, 'workers-ai'), undefined)
  })
}
