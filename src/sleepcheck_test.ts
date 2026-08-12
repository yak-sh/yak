// The gate must read code, not prose: a sleep/delay named inside a string or a
// comment is not a fixed sleep (T-17053), and a slow() body may sleep freely.
// These drive scan() over source text so the false-positive stays fixed — the
// sleep()/delay() spellings below ride inside template literals, which the fix
// blanks, so this file's own tests pass the very gate it guards.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { scan } from './sleepcheck.ts'

Deno.test('scan: sleep/delay named in a string or a comment does not trip', () => {
  let src = `
    Deno.test('mentions only', () => {
      log('we used to delay(500) here')
      // sleep(5) was the old way
    })
  `
  assertEquals(scan(src), [])
})

Deno.test('scan: a real fixed sleep in a fast test is flagged', () => {
  let src = `
    Deno.test('waits', async () => {
      await sleep(200)
    })
  `
  let bad = scan(src, 'f.ts')
  assertEquals(bad.length, 1)
  assertStringIncludes(bad[0], 'sleep()/delay()')
})

Deno.test('scan: a slow() body may sleep', () => {
  let src = `
    slow('heavy', async () => {
      await delay(130)
    })
  `
  assertEquals(scan(src), [])
})
