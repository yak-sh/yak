import { assertEquals } from '@std/assert'
import { letters, mailed, readyAddress } from './probe.ts'

Deno.test('mailed waits for a new delivery rather than returning a spent code', async () => {
  let log = Deno.makeTempFileSync()
  let k = { log }
  let to = 'probe@example.test'
  let sent = (code: string) =>
    `yak-mail ${JSON.stringify({ to, subject: `Code ${code}`, body: '' })}\n`
  try {
    Deno.writeTextFileSync(log, sent('111111'))
    let received = letters(k, to).length
    let code = mailed(k, to, received)
    // The next log line arrives after the waiter has seen the old delivery.
    Deno.writeTextFileSync(log, sent('222222'), { append: true })
    assertEquals(await code, '222222')
  } finally {
    Deno.removeSync(log)
  }
})

Deno.test('a probe waits for its own runtime readiness and bound port', () => {
  assertEquals(readyAddress('Starting local server...'), '')
  assertEquals(readyAddress('GET / 404 Not Found'), '')
  assertEquals(
    readyAddress('[wrangler:info] Ready on http://127.0.0.1:49152\n'),
    'http://127.0.0.1:49152',
  )
})
