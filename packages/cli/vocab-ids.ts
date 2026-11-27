// The vocab formatter: mints a `$id` into each vocabulary document of a
// checkout's packages (a `vocab.json` or `*.vocab.json`) for every word that
// has none (@yaks/vocab/minted), like a lockfile, for the author to commit
// with the word. `yak serve` runs it on the checkout it starts from,
// `deno task test` on the one it tests, and `deno task vocab` by hand. Nobody
// writes a `$id` by hand.
//
// An app's source (a directory with an `index.html`, such as @yaks/game's
// starter) is left alone, since its deploy mints its words' ids, and so are
// test fixtures.
//
//   deno task vocab    # prints each file it wrote, and formats it

import { mint } from '@yaks/graph/mint'
import * as disk from '@yaks/file/io'
import { minted } from '@yaks/vocab/minted'

let SKIP = new Set(['node_modules', 'fixtures'])

// The vocabulary documents under `dir`, a directory's URL, relative to `root`.
let documents = async (root: URL, dir: URL): Promise<string[]> => {
  let entries = await Array.fromAsync(disk.readDir(dir))
    .catch((e) => disk.isNotFound(e) ? [] : Promise.reject(e))
  if (entries.some((e) => e.name == 'index.html')) return []
  let found: string[] = []
  for (let { name, isDirectory, isFile } of entries) {
    if (name.startsWith('.') || SKIP.has(name)) continue
    if (isDirectory) {
      found.push(...await documents(root, new URL(`${name}/`, dir)))
    } else if (
      isFile && (name == 'vocab.json' || name.endsWith('.vocab.json'))
    ) {
      found.push(new URL(name, dir).href.slice(root.href.length))
    }
  }
  return found
}

/** Mint the missing `$id`s into every vocabulary document under packages/ in
 * the checkout at `root`, a directory's URL, and the files written, relative
 * to it. */
export let mintIds = async (root: URL): Promise<string[]> => {
  let wrote: string[] = []
  for (let file of await documents(root, new URL('packages/', root))) {
    let text = await disk.readTextFile(new URL(file, root))
    let next = minted(text, mint)
    if (next == text) continue
    await disk.writeTextFile(new URL(file, root), next)
    wrote.push(file)
  }
  return wrote.sort()
}

if (import.meta.main) {
  let { command } = await import('@yaks/process/command')
  let { execPath } = await import('@yaks/process/system')
  let wrote = await mintIds(new URL('../../', import.meta.url))
  for (let file of wrote) console.log(file)
  if (wrote.length) {
    await command(execPath(), { args: ['fmt', '--quiet', ...wrote] }).output()
  }
}
