import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { letters, mailed } from './probe.ts'

test('mailed waits for a new delivery rather than returning a spent code', async () => {
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

test('a delivered letter does not wait for an unrelated shared-kernel alarm', async () => {
  let log = Deno.makeTempFileSync()
  let to = 'delivery@example.test'
  try {
    Deno.writeTextFileSync(
      log,
      `yak-mail ${
        JSON.stringify({
          to,
          subject: 'Code 654321',
          body: '',
        })
      }\n`,
    )
    let k = { log, settled: () => new Promise<void>(() => {}) }
    assertEquals(await mailed(k, to), '654321')
  } finally {
    Deno.removeSync(log)
  }
})
