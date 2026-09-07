import { assertEquals, assertNotEquals } from '@std/assert'
import { resourceName } from './bindings.ts'

Deno.test('app resources keep production names and isolate staging copies', async () => {
  let store = 'one/app.abc123'
  let name = 'DATA'
  let production = await resourceName(store, name)
  assertEquals(production, 'one-app-abc123-data-e9572d0272')
  assertEquals(production, await resourceName(store, name, 'yak-apps'))
  let staging = await resourceName(store, name, 'yak-apps-staging')
  assertNotEquals(staging, production)
  assertEquals(staging, await resourceName(store, name, 'yak-apps-staging'))
})
