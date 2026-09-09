import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { slow, until } from './testing.ts'
import { drain, report } from './turn.ts'
import { watchVault } from './vault_watch.ts'

slow(
  'vault watches only the theme file and spool across theme replacements',
  async () => {
    let dir = Deno.makeTempDirSync()
    let css = `${dir}/theme.css`
    let watched: (string | string[])[] = []
    let watchFs = Deno.watchFs
    using _watch = stub(Deno, 'watchFs', (paths, options) => {
      watched.push(paths)
      return watchFs(paths, options)
    })
    let themes = 0
    let turns: string[] = []
    let path = `${dir}/spool/turns.jsonl`
    let stop = watchVault(dir, () => themes++, () => {
      drain((t) => turns.push(t.sid), path)
    }, 10)
    try {
      assertEquals(watched, [`${dir}/spool`])
      // Database churn never enters a watched directory; absence of a theme
      // must not prevent the very first hook from waking the drain.
      for (let file of ['tasks.db', 'tasks.db-wal', 'tasks.db-shm']) {
        Deno.writeTextFileSync(`${dir}/${file}`, 'not a database')
      }
      report({ hook_event_name: 'Stop', session_id: 'first' }, path)
      await until(() => turns.length == 1)
      assertEquals(turns, ['first'])
      assertEquals(themes, 0)

      Deno.writeTextFileSync(css, ':root { --color: red }')
      await until(() => themes > 0 && watched.includes(css))
      let before = themes
      Deno.writeTextFileSync(css, ':root { --color: blue }')
      await until(() => themes > before)

      // Atomic save replaces the watched inode. Its successor must be watched,
      // not just noticed once; a later edit still hot-swaps.
      let watches = watched.length
      Deno.writeTextFileSync(`${dir}/new.css`, ':root { --color: green }')
      Deno.renameSync(`${dir}/new.css`, css)
      await until(() => watched.length > watches)
      before = themes
      Deno.writeTextFileSync(css, ':root { --color: yellow }')
      await until(() => themes > before)
      before = themes
      Deno.removeSync(css)
      await until(() => themes > before)
      // Let the absence probe run before recreating the file.
      await new Promise((r) => setTimeout(r, 30))
      watches = watched.length
      Deno.writeTextFileSync(css, '')
      await until(() => watched.length > watches)

      // The server's own reads and empty drains must settle, not spin.
      await new Promise((r) => setTimeout(r, 30))
      before = themes
      Deno.readTextFileSync(css)
      drain(() => {}, path)
      await new Promise((r) => setTimeout(r, 30))
      assertEquals(themes, before)
      assertEquals(turns, ['first'])
      assert(watched.every((p) => p == css || p == `${dir}/spool`))
    } finally {
      stop()
      Deno.removeSync(dir, { recursive: true })
    }
  },
)
