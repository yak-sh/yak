import './testing.ts'
import { assertEquals } from '@std/assert'
import { bundle, sweep } from './bundle.ts'

Deno.test('the app bundles into one browser module', async () => {
  let js = await bundle()
  assertEquals(/^import /m.test(js), false)
  assertEquals(js.length > 100_000, true)
})

// A pid that named a process a moment ago and names none now.
let gone = async () => {
  let child = new Deno.Command('true').spawn()
  await child.status
  return child.pid
}

let there = (path: string) => Deno.stat(path).then(() => true, () => false)

Deno.test({
  name: "a gone host's bundler is ended and its directory removed",
  ignore: Deno.build.os != 'linux',
  fn: async () => {
    let base = await Deno.makeTempDir()
    let dead = `${base}/yaks-web-${await gone()}-a`
    let mine = `${base}/yaks-web-${Deno.pid}-b`
    await Deno.mkdir(dead)
    await Deno.mkdir(mine)
    // Stands in for a bundler still writing into the dead host's directory.
    await Deno.writeTextFile(`${dead}/app.js`, 'setTimeout(() => {}, 60_000)')
    let left = new Deno.Command(Deno.execPath(), {
      args: ['run', `${dead}/app.js`],
    }).spawn()
    try {
      await sweep(base)
      assertEquals((await left.status).signal, 'SIGKILL')
      assertEquals(await there(dead), false)
      assertEquals(await there(mine), true)
    } finally {
      try {
        left.kill('SIGKILL')
      } catch { /* already ended */ }
      await Deno.remove(base, { recursive: true })
    }
  },
})
