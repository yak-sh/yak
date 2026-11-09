// Historical channel rows retain their writer when assembled for a model.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { project } from '@yaks/session'
import { inputText } from '../../packages/harness/input_text.ts'
import { inputSource } from './operator-provenance.ts'

for (
  let [channel, more, from] of [
    ['wake', {}, 'the system (your wake-up)'],
    ['subscription', {}, 'the system (your subscription)'],
    ['voice', { operator_call: { asked: true } }, 'your voice on the call'],
    [
      'voice',
      { operator_call: { said: true }, notice: { own: true } },
      'your voice on the call',
    ],
    ['voice', { operator_call: { began: true }, notice: {} }, 'the system'],
  ] as const
) {
  test(`persisted ${channel} input names ${from} rather than its member actor`, () => {
    let entry: Bundle = {
      entity: { eid: 'entry' },
      entry: { session: 's' },
      content: { body: 'words' },
      created: { by: 'person', via: 's' },
      operator_channel: { channel },
      ...more,
    }
    equal(
      project([entry], [entry], new Map(), {
        inputText: inputText(
          [entry],
          new Map([['person', 'Jeff']]),
          inputSource,
        ),
      }),
      [{ kind: 'user', text: `From ${from}:\nwords` }],
    )
  })
}
