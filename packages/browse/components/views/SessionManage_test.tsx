// A line said to a session asks it for a turn by carrying a using
// (@yaks/session `session_run`), so one sent with no model chosen carries the
// using in force, as `yak session send` does.
import '../Entity.tsx'
import '../../domain-host.tsx'
import { test } from '@yaks/testing'
import { tick } from '../../testing.ts'
import { assertEquals } from '@std/assert'
import { act } from 'preact/test-utils'
import { h } from 'preact'
import { identityEid } from '@yaks/graph/identity'
import { bundlesOf } from '../../wire.ts'
import { cache, ent, useRoute } from '../../live.ts'
import { type Change } from '../../types.ts'
import { mount } from '../mount.ts'
import { SessionInput } from './SessionManage.tsx'

// Mounted, typed into and sent when the file loads; the case checks the write.
let provider = identityEid('provider', ['claude'])
let model = identityEid('model', ['haiku'])
let sent: Change[] = []
await (async () => {
  let eid = 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'
  cache.value = {
    [eid]: {
      entity: { eid },
      session: { eid, id: 'probe' },
      using: { eid, provider, model, effort: 'high' },
    },
    [provider]: {
      entity: { eid: provider },
      provider: { eid: provider, name: 'claude' },
    },
    [model]: { entity: { eid: model }, model: { eid: model, name: 'haiku' } },
  }
  let revision = 0
  let restore = useRoute((frame) => {
    if (
      frame && typeof frame == 'object' && 'apply' in frame &&
      Array.isArray(frame.apply)
    ) {
      sent.push(...frame.apply)
      let rows = bundlesOf(frame.apply)
      for (let b of rows) {
        if (b.draft && typeof b.draft == 'object') {
          b.draft = { ...b.draft, rev: ++revision }
        }
      }
      return Response.json(rows)
    }
  })
  let seen = mount(h(SessionInput, { e: ent(eid) }))
  try {
    let input = seen.root.querySelector('textarea') as HTMLTextAreaElement
    let Event = input.ownerDocument.defaultView!.Event
    await act(() => {
      input.value = 'And in autumn?'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(() => {
      seen.root.querySelector('form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })
    await tick()
  } finally {
    useRoute(restore)
    seen.free()
    cache.value = {}
  }
})()

test('a line sent with no model chosen carries the using in force', () =>
  assertEquals(
    sent.find((c) => c.name == 'using')?.comp,
    { provider, model, effort: 'high' },
    JSON.stringify(sent),
  ))
