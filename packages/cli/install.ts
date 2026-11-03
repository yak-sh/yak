// `deno run -A jsr:@yaks/cli/install`: puts `yak` on this machine at the
// release this module came from, so the command, every plugin a config names
// by package (./config.ts `located`) and the canvas it bundles are one set.
//
// A bare `deno install -g jsr:@yaks/cli/yak` is not that on the day a release
// publishes (./release.ts): the install takes the release before, and a `yak`
// pinned to the new one has every plugin it names refused until the day is
// out, since a global install's command keeps none of the flags it was
// installed with. What it does keep is a config, copied beside the command,
// so the config written here is the release's (./release.ts `released`).
//
// Run it with `--minimum-dependency-age=0` to install the release published
// today; without, it installs the newest release a day old, whole.

import cli from './deno.json' with { type: 'json' }
import { released } from './release.ts'

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
  `jsr:${cli.name}@${version}/yak`,
]

/** The `deno` arguments that run `yak` at `version` under `config`, with
 * `args`: what the installed command runs, without installing it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(run('1.2.3', '/tmp/c.json', ['help']).slice(-2), ['jsr:@yaks/cli@1.2.3/yak', 'help'])
 * ```
 */
export let run = (
  version: string,
  config: string,
  args: string[],
): string[] => [
  'run',
  '--allow-all',
  '--config',
  config,
  `jsr:${cli.name}@${version}/yak`,
  ...args,
]

/** A first `yak init` and `yak task list`, against a scratch graph in `dir`:
 * a command imports the plugins a config names by name, which `deno install`
 * never fetched, since it follows literal imports only. Run here, the wait to
 * fetch and compile them is part of installing, and a person's first command
 * finds them. */
export let warming = (dir: string): string[][] => [
  ['--config', `${dir}/warm/yak.json`, 'init', 'Warm'],
  ['--config', `${dir}/warm/yak.json`, 'task', 'list'],
]

let deno = (args: string[], cwd: string, quiet = false) =>
  new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    stdout: quiet ? 'null' : 'inherit',
    stderr: quiet ? 'piped' : 'inherit',
  }).output()

if (import.meta.main) {
  let dir = await Deno.makeTempDir({ prefix: 'yak-install-' })
  try {
    let config = `${dir}/deno.json`
    await Deno.writeTextFile(config, JSON.stringify(released))
    // Run from the empty directory, since `deno install` also folds in the
    // dependencies of any package.json it finds above where it runs.
    let { code } = await deno(install(cli.version, config), dir)
    if (code == 0) {
      console.log('fetching the plugins a first command needs…')
      for (let args of warming(dir)) {
        let warmed = await deno(run(cli.version, config, args), dir, true)
        // A warm-up that failed costs the first command its wait, and says
        // why; the install itself stands.
        if (!warmed.success) {
          console.error(new TextDecoder().decode(warmed.stderr).trim())
          break
        }
      }
      console.log(
        `yak ${cli.version} is installed. Next: yak init <your name>, ` +
          'which starts a graph on this machine',
      )
    }
    Deno.exitCode = code
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}
