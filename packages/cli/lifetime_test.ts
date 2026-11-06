// File removal and replacement, or the starter's end, end a worker's reason
// to serve.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { lifetime } from './lifetime.ts'

let dir = await Deno.makeTempDir({ prefix: 'yak-lifetime-' })
let results: boolean[] = []
try {
  let path = `${dir}/graph.db`
  await Deno.writeTextFile(path, '')
  let lives = await lifetime(path)
  results.push(await lives())
  await Deno.rename(path, `${dir}/old.db`)
  await Deno.writeTextFile(path, '')
  results.push(await lives())
  let replaced = await lifetime(path)
  await Deno.remove(path)
  results.push(await replaced())
} finally {
  await Deno.remove(dir, { recursive: true })
}
test('worker lifetime ends on graph replacement or removal', () => {
  assertEquals(results, [true, false, false])
})

let tethered = async (end: (w: WritableStream<Uint8Array>) => unknown) => {
  let { readable, writable } = new TransformStream<Uint8Array>()
  let lives = await lifetime(':memory:', readable)
  let before = await lives()
  await end(writable)
  await new Promise((done) => setTimeout(done, 0))
  return [before, await lives()]
}
test('worker lifetime ends when its starter closes or drops the tether', async () => {
  assertEquals(await tethered((w) => w.close()), [true, false])
  assertEquals(await tethered((w) => w.abort()), [true, false])
})
