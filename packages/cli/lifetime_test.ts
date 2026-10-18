// File removal, replacement and starter death end a worker's reason to serve.
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
  let owner = new Deno.Command('sleep', { args: ['60'] }).spawn()
  try {
    let owned = await lifetime(':memory:', owner.pid)
    results.push(await owned())
    owner.kill('SIGTERM')
    await owner.status
    results.push(await owned())
  } finally {
    try {
      Deno.kill(owner.pid, 'SIGKILL')
    } catch (error) {
      assertEquals(error instanceof Deno.errors.NotFound, true)
    }
  }
} finally {
  await Deno.remove(dir, { recursive: true })
}
test('worker lifetime ends on graph replacement, removal or starter death', () => {
  assertEquals(results, [true, false, false, true, false])
})
