// The `yak` command: ./main.ts is what it runs, and this module is where it
// starts.
//
// A checkout changes under a running command: a landing rewrites main's
// checkout file by file, and Deno reads a module when something first imports
// it. A command loading from the checkout as it moved would join modules of
// two commits, one importing a name the other has yet to export. So a command
// started from a checkout loads only the land lock (@yaks/git/hold, whose one
// import is @yaks/file/io, which imports Node's alone), waits out a landing,
// loads the launcher and reads the checkout under that lock, held shared, and
// runs, in this process, the copy of this module in a snapshot of it
// (./runtime.ts `launch`), a tree nothing rewrites while a process runs from
// it. A release from JSR, an install without `.git`, and the snapshot itself
// never change, and run here.
//
//   yak task list           # the command, from its checkout's snapshot
//   yak serve --config yak.json

import { hold } from '@yaks/git/hold'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The Git directory every worktree of the checkout at `root` shares, read as
 * Git reads it: `.git` is that directory, or a file naming the worktree's
 * own, whose `commondir` names the shared one. Undefined when `root` is no
 * Git checkout. */
export let common = async (root: string): Promise<string | undefined> => {
  let dot = resolve(root, '.git')
  let found = await stat(dot).catch(() => undefined)
  if (!found?.isFile()) return found && dot
  let own = resolve(root, (await readFile(dot, 'utf8')).slice(8).trim())
  let shared = await readFile(`${own}/commondir`, 'utf8').catch(() => '.')
  return resolve(own, shared.trim())
}

/** Wait until no landing writes the checkout at `root`, and keep the next
 * from writing it until the returned release. Undefined when `root` is no Git
 * checkout. */
export let steady = async (
  root: string,
): Promise<(() => void) | undefined> => {
  let dir = await common(root)
  return dir ? hold(dir, false) : undefined
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
// `cut`), closes with the interrupt's code, and exits.
export let start = async (argv: string[]): Promise<void> => {
  let root = new URL('../../', import.meta.url)
  let pinned = Deno.env.get('YAK_RUNTIME_ROOT') == root.href.replace(/\/$/, '')
  let release = root.protocol == 'file:' && !pinned
    ? await steady(fileURLToPath(root))
    : undefined
  if (release) {
    let { launch } = await import('./runtime.ts').catch((error) => {
      release()
      throw error
    })
    return launch(argv, release)
  }
  let [system, { listen, wind }, { inspector }] = await Promise.all([
    import('@yaks/process/system'),
    import('@yaks/process/wind'),
    import('./runtime.ts'),
  ])
  listen()
  let port = system.env.get('YAK_WORK_INSPECT')
  if (port && argv.includes('work')) {
    let { open } = await import('node:inspector')
    open(inspector(port), '127.0.0.1')
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
