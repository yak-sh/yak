// The `yak` command: ./main.ts is what it runs, and this module is where it
// starts.
//
// A checkout changes under a running command: a landing rewrites main's
// checkout file by file, and Deno reads a module when something first imports
// it. A command loading from the checkout as it moved would join modules of
// two commits, one importing a name the other has yet to export. So a command
// started from a checkout loads only the land lock (@yaks/git/hold, whose one
// import is @yaks/file/io, which imports Node's alone), waits out a landing,
// loads the launcher under that lock, held shared, and runs from a snapshot
// of the checkout (./runtime.ts), a tree nothing rewrites while a process
// runs from it. A release from JSR, an install without `.git`, and the
// snapshot itself never change, and run here.
//
//   yak task list           # a launcher, and the command in its snapshot
//   yak serve --config yak.json

import { hold } from '@yaks/git/hold'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

/** Wait until no landing writes the checkout at `root`, and keep the next
 * from writing it until the returned release. Undefined when `root` is no Git
 * checkout. */
export let steady = async (
  root: string,
): Promise<(() => void) | undefined> => {
  let found = await promisify(execFile)(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: root },
  ).catch(() => undefined)
  return found && hold(found.stdout.trim(), false)
}

// The command, from argv to its exit.
//
// An interrupt winds the command down rather than cutting it off
// (@yaks/process/wind). The command holds the process open: the first
// interrupt stops every graph it opened (./held.ts `stop`), so `yak serve`
// takes no new request, no new effect and no new step, and the command
// finishes what it started and closes the way it always does, for as long as
// that takes. A command with nothing open has nothing to finish, and ends at
// once. A second interrupt ends its duty threads where they stand (./held.ts
// `cut`), closes with the interrupt's code, and exits. A launcher forwards
// its interrupts to the command in its snapshot (./runtime.ts `runtime`).
let start = async (argv: string[]) => {
  let root = new URL('../../', import.meta.url)
  let pinned = Deno.env.get('YAK_RUNTIME_ROOT') == root.href.replace(/\/$/, '')
  let release = root.protocol == 'file:' && !pinned
    ? await steady(fileURLToPath(root))
    : undefined
  let [system, { listen, wind }, { runtime }] = await Promise.all([
    import('@yaks/process/system'),
    import('@yaks/process/wind'),
    import('./runtime.ts'),
  ]).finally(release)
  listen()
  if (release || pinned) {
    let code = await runtime(argv)
    if (code !== undefined) return system.exit(code)
  }
  let [{ closeAccounts }, held, { main }] = await Promise.all([
    import('./accounts.ts'),
    import('./held.ts'),
    import('./main.ts'),
  ])
  let ran = main(argv)
  wind.hold({
    drain: () => held.stop() ? ran : undefined,
    force: () => held.cut(),
  })
  wind.done.then(async (code) => {
    await held.close(code)
    await closeAccounts()
    system.exit(code)
  })
  ran.then(system.exit)
}

if (import.meta.main) start(Deno.args)
