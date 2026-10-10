// A roster belongs to one door; an old combined cache moves without losing
// other doors or bringing a forgotten roster back.
import { equal, test } from '@yaks/testing'
import { cached, forget, remember } from './store.ts'

let one = { tools: [{ name: 'one' }] }, two = { tools: [{ name: 'two' }] }
test('rosters move to independent files and forgetting one keeps the others', async () => {
  let dir = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(
      `${dir}/tools.json`,
      JSON.stringify({
        'example.test/a': one,
        'example.test/b': two,
      }),
    )
    equal(await cached('example.test/a', dir), one)
    equal(await cached('example.test/b', dir), two)
    equal(await Deno.stat(`${dir}/tools.json`).catch(() => null), null)
    await forget('example.test/a', dir)
    equal(await cached('example.test/a', dir), null)
    equal(await cached('example.test/b', dir), two)
    await remember('example.test/a', two, dir)
    equal(await cached('example.test/a', dir), two)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
test('an interrupted roster move preserves newer destinations on retry', async () => {
  let dir = await Deno.makeTempDir()
  try {
    await remember('example.test/a', two, dir)
    await Deno.writeTextFile(
      `${dir}/tools.json`,
      JSON.stringify({
        'example.test/a': one,
        'example.test/b': one,
      }),
    )
    equal(await cached('example.test/a', dir), two)
    equal(await cached('example.test/b', dir), one)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
