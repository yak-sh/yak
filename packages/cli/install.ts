// `deno run -A jsr:@yaks/cli/install`: puts `yak` on this machine at the
// release this module came from, so the command, every plugin a config names
// by package (./config.ts `located`) and the canvas it bundles are one set.
//
// A bare `deno install -g jsr:@yaks/cli/yak` is not that on the day a release
// publishes (./release.ts): the install takes the release before, and a `yak`
// pinned to the new one has every plugin it names refused until the day is
// out, since a global install's command keeps none of the flags it was
// installed with. What it does keep is a config, copied beside the command,
// so the config written here is the release's `exempt`.
//
// Run it with `--minimum-dependency-age=0` to install the release published
// today; without, it installs the newest release a day old, whole.

import cli from './deno.json' with { type: 'json' }
import { released, SCOPE } from './release.ts'

/** The `deno` arguments that install `yak` at `version` under `config`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(install('1.2.3', '/tmp/c.json').at(-1), 'jsr:@yaks/cli@1.2.3/yak')
 * ```
 */
export let install = (version: string, config: string): string[] => [
  'install',
  '--global',
  '--allow-all',
  '--force',
  '--name',
  'yak',
  '--config',
  config,
  `jsr:@${SCOPE}/cli@${version}/yak`,
]

if (import.meta.main) {
  let dir = await Deno.makeTempDir({ prefix: 'yak-install-' })
  try {
    let config = `${dir}/deno.json`
    await Deno.writeTextFile(config, JSON.stringify(await released(SCOPE)))
    // Run from the empty directory, since `deno install` also folds in the
    // dependencies of any package.json it finds above where it runs.
    let { code } = await new Deno.Command(Deno.execPath(), {
      args: install(cli.version, config),
      cwd: dir,
      stdout: 'inherit',
      stderr: 'inherit',
    }).spawn().status
    if (code == 0) {
      console.log(`yak ${cli.version} is installed: next, yak init`)
    }
    Deno.exitCode = code
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}
