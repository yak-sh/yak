import { assertThrows } from '@std/assert'
import { local } from './local.ts'
import { harness } from './testing.ts'

Deno.test('agent rejects a spread harness', async () => {
  let h = await harness()
  try {
    assertThrows(
      // @ts-expect-error A Harness belongs under h, including when spread.
      () => local({ ...h, name: 'fake', tools: [] }),
      TypeError,
      'Pass the harness as local({ h: hosted(host) })',
    )
  } finally {
    h.close()
  }
})
