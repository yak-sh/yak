import { equal, test } from '@yaks/testing'
import * as disk from '@yaks/file/io'
import { mintIds } from './vocab-ids.ts'

let word = JSON.stringify({ $defs: { pin: { component: true } } })

// A checkout holding each file, and what mintIds wrote there.
let minting = async (files: string[]) => {
  let at = await disk.makeTempDir({ prefix: 'yaks-vocab-ids-' })
  let root = disk.pathToFileURL(`${at}/`)
  try {
    for (let file of files) {
      let url = new URL(file, root)
      await disk.mkdir(new URL('.', url), { recursive: true })
      await disk.writeTextFile(url, file.endsWith('.html') ? '' : word)
    }
    let wrote = await mintIds(root)
    equal(await mintIds(root), [])
    return wrote
  } finally {
    await disk.remove(at, { recursive: true })
  }
}

test('a package’s vocabulary documents get ids; apps and fixtures do not', async () => {
  equal(
    await minting([
      'packages/a/vocab.json',
      'packages/a/vocab/b.vocab.json',
      'packages/a/meta/c.vocab.json',
      'packages/a/other.json',
      'packages/a/starter/index.html',
      'packages/a/starter/vocab.json',
      'packages/a/fixtures/app/vocab.json',
      'packages/a/node_modules/x/vocab.json',
      'apps/d/vocab.json',
    ]),
    [
      'packages/a/meta/c.vocab.json',
      'packages/a/vocab.json',
      'packages/a/vocab/b.vocab.json',
    ],
  )
})
