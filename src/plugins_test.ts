// The loader is the ONE seam that runs third-party code, and it must be INERT
// until configured (D-18663 seam 1). Two things are proven here: with no config
// nothing loads, and a configured module's top-level registrars run — its
// renderer resolves and its own component typechecks + reaches the cache shape
// (seam 2, the open Ent). The plugin is written to a temp file and imported by
// URL — exactly the shape an operator points TASKS_PLUGINS at.
import { loadPlugins, pluginSpecifiers } from './plugins.ts'
import { resolve } from './components/registry.ts'
import { type Comps } from './live.ts'
import { type Ent } from './types.ts'
import { assertEquals } from '@std/assert'

let ent = (comps: Record<string, unknown>) =>
  ({ eid: 'x', num: 1, kind: '?', refs: [], kids: [], ...comps }) as Ent

Deno.test('inert until configured: no env, nothing loads', async () => {
  // The test suite runs without TASKS_PLUGINS, so the config is empty and the
  // load is a no-op that imports nothing.
  assertEquals(pluginSpecifiers(), [])
  assertEquals(await loadPlugins([]), [])
})

Deno.test('a configured module registers at import — renderer + open comp', async () => {
  // A plugin is a module that runs the registrars at its top level. Point the
  // loader at one that registers a renderer for its own `invoice` component.
  let registry = new URL('./components/registry.ts', import.meta.url).href
  let mod = await Deno.makeTempFile({ suffix: '.ts' })
  await Deno.writeTextFile(
    mod,
    `import { extend, has } from '${registry}'\n` +
      `extend([{ view: 'Invoice', match: has('doc', 'invoice'),` +
      ` Render: () => 'invoice-view' }])\n`,
  )
  try {
    let loaded = await loadPlugins([`file://${mod}`])
    assertEquals(loaded, [`file://${mod}`])
    // The renderer resolves for an entity carrying the plugin's component —
    // has('doc', 'invoice') typechecked (widened to string[]) and matched.
    assertEquals(
      resolve(ent({ doc: {}, invoice: {} }), 'Invoice').view,
      'Invoice',
    )
  } finally {
    await Deno.remove(mod)
  }

  // The open Ent (seam 2): a plugin component typechecks on the cache shape and
  // reads back as a real bag — this is what flows to the browser/TUI cache.
  let row: Comps = { invoice: { total: 5 } }
  assertEquals(row.invoice?.total, 5)
})
