/// <reference lib="deno.ns" />
// This repository is a plugin marketplace (T-34666): `.agents/plugins/
// marketplace.json` offers one plugin, `plugins/yaks.app/`, and ChatGPT and
// Codex install it straight from GitHub — `codex plugin marketplace add
// yak-sh/yak`, or a workspace importing the same repository — with no
// submission portal in the way.
//
// `deno task content --check` already refuses a stale package. What it cannot
// see is whether the package is COHERENT, and three facts hold it together:
//
//   - the plugin's name, its folder name and the marketplace entry's name are
//     one name. Codex resolves a local `source.path` against the REPO root
//     rather than the manifest's own directory (core-plugins marketplace.rs
//     `resolve_local_plugin_source_path`), so a rename that misses one of the
//     three offers a plugin that is not there.
//   - the address it hands out is THE address (route.ts `MCP`). A package that
//     drifted to another host would be this product wearing a stranger's door.
//   - every asset the manifest names is a file in the package. OpenAI's own
//     validator refuses a logo that points at nothing, and it refuses it after
//     the submission rather than here.
import { assert, assertEquals } from '@std/assert'
import market from '../../.agents/plugins/marketplace.json' with {
  type: 'json',
}
import manifest from '../../plugins/yaks.app/.codex-plugin/plugin.json' with {
  type: 'json',
}
import servers from '../../plugins/yaks.app/.mcp.json' with { type: 'json' }
import { MCP } from './route.ts'
import { PAGES } from './content.ts'

let inPackage = (path: string) =>
  new URL(`../../plugins/${manifest.name}/${path}`, import.meta.url)

Deno.test('the marketplace offers one plugin, and it is where it says', () => {
  assertEquals(market.plugins.length, 1)
  let [entry] = market.plugins
  assertEquals(entry.name, manifest.name)
  assertEquals(entry.source.path, `./plugins/${manifest.name}`)
  assert(Deno.statSync(inPackage('.codex-plugin/plugin.json')).isFile)
})

Deno.test("the plugin hands out this platform's own address", () => {
  assertEquals(Object.values(servers.mcpServers).map((s) => s.url), [MCP])
})

Deno.test('every asset the manifest names is in the package', () => {
  for (let path of [manifest.interface.logo, manifest.interface.composerIcon]) {
    assert(path.startsWith('./'), `${path} must be relative to the package`)
    assert(Deno.statSync(inPackage(path)).isFile, `${path} is missing`)
  }
})

Deno.test('a skill travels for every guide page', () => {
  assertEquals(
    [...Deno.readDirSync(inPackage('skills'))].map((e) => e.name).sort(),
    Object.keys(PAGES).sort(),
  )
})
