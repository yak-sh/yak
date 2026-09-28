// Chat's slash form calls the commands declared by the app, with typed args.
import { assertEquals } from '@std/assert'
import { slash } from './slash.ts'

Deno.test('slash adapts declared app commands and leaves chat alone', () => {
  assertEquals(slash('hello /damage on'), null)
  assertEquals(slash('/damage on'), {
    command: { name: 'damage', args: { on: true } },
  })
  assertEquals(slash('/damage off'), {
    command: { name: 'damage', args: { on: false } },
  })
  assertEquals(slash('/teleport tombsands'), {
    command: { name: 'teleport', args: { level: 'tombsands' } },
  })
  assertEquals(slash('/teleport x=-1152 z=624'), {
    command: { name: 'teleport', args: { x: -1152, z: 624 } },
  })
  assertEquals(slash('/companion_progress directive=order'), {
    command: { name: 'companion_progress', args: { directive: 'order' } },
  })
  assertEquals(slash('/teleport x=Infinity z=624'), {
    error: 'x has the wrong value.',
  })
  assertEquals(slash('/damage maybe'), { error: 'on has the wrong value.' })
  assertEquals(slash('/unknown'), { error: 'Unknown command: /unknown.' })
})
