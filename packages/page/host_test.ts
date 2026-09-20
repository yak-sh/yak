// The archiver a config names, actually run. It is the one seam in this
// package that starts a process, so the check is a real one — a command, its
// output, its failures — against a file this test wrote and removes.

import { assertEquals, assertRejects } from '@std/assert'
import { archiver } from './host.ts'

let written = async (text: string) => {
  let path = await Deno.makeTempFile({ suffix: '.html' })
  await Deno.writeTextFile(path, text)
  return path
}

Deno.test('an archiver is the command a config names', async () => {
  let path = await written('<title>Local</title>')
  try {
    let said = await archiver({ run: ['cat', '{url}'] })(path)
    assertEquals(said.trim(), '<title>Local</title>')
    // where no argument mentions the address, the address is appended
    assertEquals((await archiver({ run: ['cat'] })(path)).trim(), said.trim())
  } finally {
    await Deno.remove(path)
  }
})

Deno.test('a capture that did not happen says so', async () => {
  // the tool's own words, not a shrug
  await assertRejects(
    () => archiver({ run: ['cat', '{url}'] })('/nowhere/at/all'),
    Error,
    'cat:',
  )
  // an empty answer archived nothing, and must not stamp a page frozen
  let empty = await written('')
  try {
    await assertRejects(
      () => archiver({ run: ['cat', '{url}'] })(empty),
      Error,
      'archived to nothing',
    )
  } finally {
    await Deno.remove(empty)
  }
  // and a tool that never finishes is not a capture either
  await assertRejects(() =>
    archiver({ run: ['sleep', '30'], timeout: 20 })('https://a.com/')
  )
})
