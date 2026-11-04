import * as system from '@yaks/process/system'
import * as disk from '@yaks/file/io'
import { command as launchCommand } from '@yaks/process/command'
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
// today; without, it installs the newest release a day old, whole. Deno keeps
// the release list it fetched, so an update adds `--reload=jsr:@yaks/cli`,
// or it installs the release it found before.

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
  // Deno's own lines as a first command fetches modules say nothing to whoever
  // ran it; its errors print all the same.
  '--quiet',
  // TODO: drop once Deno honors deno.json's "no-legacy-abort" (2.9.1 does not)
  '--unstable-no-legacy-abort',
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

/** A first `yak serve` on that scratch graph, at `port`, asked for its canvas
 * and then stopped: serving imports the facets of the web role and bundles the
 * page, which no command before it fetched, so a person's first `yak serve`
 * would otherwise download them as it starts.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(serving('/tmp/i', 9).slice(-3), ['serve', '--port', '9'])
 * ```
 */
export let serving = (dir: string, port: number): string[] => [
  '--config',
  `${dir}/warm/yak.json`,
  'serve',
  '--port',
  String(port),
]

/** What a warm-up of `yak serve` asks for once it listens. */
export let CANVAS = ['/', '/web/app.js']

// A port nothing listens on, from the system, released for serve to take.
let free = () => {
  let listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let { port } = listener.addr as Deno.NetAddr
  listener.close()
  return port
}

// The answer to `url`, once something listens there, or an error at `by`.
let answered = async (url: string, by: number) => {
  for (;;) {
    try {
      let res = await fetch(url)
      await res.body?.cancel()
      if (res.ok) return
      throw new Error(`${url} answered ${res.status}`)
    } catch (error) {
      if (!(error instanceof TypeError) || Date.now() > by) throw error
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}

let deno = (args: string[], cwd: string, quiet = false) =>
  launchCommand(system.execPath(), {
    args,
    cwd,
    stdout: quiet ? 'null' : 'inherit',
    stderr: quiet ? 'piped' : 'inherit',
  }).output()

if (system.main(import.meta.url)) {
  let dir = await disk.makeTempDir({ prefix: 'yak-install-' })
  try {
    let config = `${dir}/deno.json`
    await disk.writeTextFile(config, JSON.stringify(released))
    // Run from the empty directory, since `deno install` also folds in the
    // dependencies of any package.json it finds above where it runs.
    let { code } = await deno(install(cli.version, config), dir)
    if (code == 0) {
      console.log('fetching the plugins a first command needs…')
      let warm = true
      for (let args of warming(dir)) {
        let warmed = await deno(run(cli.version, config, args), dir, true)
        // A warm-up that failed costs the first command its wait, and says
        // why; the install itself stands.
        if (!warmed.success) {
          console.error(new TextDecoder().decode(warmed.stderr).trim())
          warm = false
          break
        }
      }
      if (warm) {
        let port = free()
        let server = launchCommand(system.execPath(), {
          args: run(cli.version, config, serving(dir, port)),
          cwd: dir,
          stdout: 'null',
          stderr: 'null',
        }).spawn()
        try {
          let by = Date.now() + 120_000
          for (let path of CANVAS) {
            await answered(`http://127.0.0.1:${port}${path}`, by)
          }
        } catch (error) {
          console.error(`yak serve could not be warmed: ${error}`)
        } finally {
          server.kill('SIGINT')
          await server.status
        }
      }
      console.log(
        `yak ${cli.version} is installed. Next: yak init <your name>, ` +
          'which starts a graph on this machine',
      )
    }
    system.setExitCode(code)
  } finally {
    await disk.remove(dir, { recursive: true })
  }
}
