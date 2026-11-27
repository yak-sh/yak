// The vocab formatter: mints a `$id` into each packages/*/vocab.json of a
// checkout for every word that has none (@yaks/vocab/minted), like a lockfile,
// for the author to commit with the word. `yak serve` runs it on the checkout
// it starts from, `deno task test` on the one it tests, and `deno task vocab`
// by hand. Nobody writes a `$id` by hand.
//
//   deno task vocab    # prints each file it wrote

import { mint } from '@yaks/graph/mint'
import * as disk from '@yaks/file/io'
import { minted } from '@yaks/vocab/minted'

/** Mint the missing `$id`s into every packages/*\/vocab.json of the checkout
 * at `root`, a directory's URL, and the files written, relative to it. */
export let mintIds = async (root: URL): Promise<string[]> => {
  let wrote: string[] = []
  let dirs = await Array.fromAsync(disk.readDir(new URL('packages/', root)))
    .catch((e) => disk.isNotFound(e) ? [] : Promise.reject(e))
  for (let { name, isDirectory } of dirs) {
    if (!isDirectory) continue
    let file = `packages/${name}/vocab.json`
    let text = await disk.readTextFile(new URL(file, root)).catch((e) =>
      disk.isNotFound(e) ? undefined : Promise.reject(e)
    )
    if (text == undefined) continue
    let next = minted(text, mint)
    if (next == text) continue
    await disk.writeTextFile(new URL(file, root), next)
    wrote.push(file)
  }
  return wrote.sort()
}

if (import.meta.main) {
  for (let file of await mintIds(new URL('../../', import.meta.url))) {
    console.log(file)
  }
}
