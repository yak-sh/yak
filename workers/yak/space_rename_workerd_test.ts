// A space moved with everything in it, in the runtime itself: its bucket,
// its Durable Objects and its email handler (space_rename_fixture.ts).
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import { renamed } from './space_rename_fixture.ts'

test('a space moves at any time in workerd, and the name it leaves is free to take', () =>
  renamed(workerd()))
