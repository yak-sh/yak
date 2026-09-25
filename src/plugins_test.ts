// The loader is the ONE seam that runs third-party code, and it must be INERT
// until configured (D-18663 seam 1): with no config nothing loads.
import { loadPlugins, pluginSpecifiers } from './plugins.ts'
import { assertEquals } from '@std/assert'

Deno.test('inert until configured: no env, nothing loads', async () => {
  // The test suite runs without TASKS_PLUGINS, so the config is empty and the
  // load is a no-op that imports nothing.
  assertEquals(pluginSpecifiers(), [])
  assertEquals(await loadPlugins([]), [])
})
