// The repo-wide rule the prelude only enforces if everyone goes through it:
// nothing imports '@db/sqlite' before a `sqlitepath.ts`.
//
// @db/sqlite downloads a prebuilt native library when nothing names one, and on
// Linux x86_64 that library segfaults inside `sqlite3_initialize` the moment it
// loads — no stderr, no stack, the process just dies. The prelude names the
// system library first, so a file that reaches the driver directly is a crash
// waiting for the first machine whose environment does not happen to carry
// DENO_SQLITE_PATH. That is what took the harness TUI down (T-34183): the
// packages imported the driver straight, and nobody saw it because an
// interactive shell on the box had the variable and every run inherited it.
//
// It guards the whole repo, not just this package: however many module graphs
// reach for the driver, they all land on one native library per process.
import { fileURLToPath } from 'node:url'
import { assertEquals } from '@std/assert'

let root = fileURLToPath(new URL('../../', import.meta.url))

// git names the tracked files that say it at all — one subprocess instead of
// reading a thousand sources to find the dozen that matter.
let mentions = async (): Promise<string[]> => {
  let git = new Deno.Command('git', {
    args: ['grep', '-l', '--', '@db/sqlite', '*.ts', '*.tsx'],
    cwd: root,
  })
  let { stdout } = await git.output()
  return new TextDecoder().decode(stdout).split('\n').filter(Boolean)
}

// Comments talk about the driver by name; only the specifiers count.
let code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let DRIVER = /from\s+'(?:jsr:)?@db\/sqlite/
let PRELUDE = /'[^']*sqlitepath\.ts'/

Deno.test('every @db/sqlite import is preceded by the path prelude', async () => {
  let bare: string[] = []
  for (let path of await mentions()) {
    let src = code(await Deno.readTextFile(root + path))
    let driver = src.search(DRIVER)
    if (driver < 0) continue
    let prelude = src.search(PRELUDE)
    if (prelude < 0 || prelude > driver) bare.push(path)
  }
  assertEquals(bare, [])
})
