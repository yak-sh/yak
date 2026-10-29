import { equal, test } from '@yaks/testing'
import { cloudflare, endpoint, letters, mailed } from './probe.ts'

test('mailed returns the new delivery rather than a spent code', async () => {
  let log = crypto.randomUUID()
  let cf = cloudflare(log)
  let k = { log }
  let to = 'probe@example.test'
  let sent = (code: string) => cf.binding.send({ to, subject: `Code ${code}` })
  try {
    await sent('111111')
    let received = letters(k, to).length
    await sent('222222')
    equal(await mailed(k, to, received), '222222')
  } finally {
    await cf.stop()
  }
})

test('a delivered letter does not wait for an unrelated shared-kernel alarm', async () => {
  let log = crypto.randomUUID()
  let cf = cloudflare(log)
  let to = 'delivery@example.test'
  try {
    await cf.binding.send({ to, subject: 'Code 654321' })
    let k = { log, settled: () => new Promise<void>(() => {}) }
    equal(await mailed(k, to), '654321')
  } finally {
    await cf.stop()
  }
})

test('a delivery observer waits for this request without waiting for platform alarms', async () => {
  let log = crypto.randomUUID()
  let cf = cloudflare(log)
  let to = 'invite@example.test'
  let seen = 0
  try {
    let k = {
      log,
      settled: () => new Promise<void>(() => {}),
      deliveries: () => {
        seen++
        return cf.binding.send({ to, subject: 'Code 777777' }).then(() => {})
      },
    }
    equal(await mailed(k, to), '777777')
    equal(seen, 1)
  } finally {
    await cf.stop()
  }
})

test('an in-process endpoint receives request headers and binary bodies', async () => {
  let wire = endpoint(async (req) =>
    Response.json({
      cookie: req.headers.get('cookie'),
      body: [...new Uint8Array(await req.arrayBuffer())],
    })
  )
  try {
    let response = await fetch(wire.url, {
      method: 'POST',
      headers: { cookie: 'yak_session=probe' },
      body: new Uint8Array([255, 0, 13, 10]),
    })
    equal(await response.json(), {
      cookie: 'yak_session=probe',
      body: [255, 0, 13, 10],
    })
  } finally {
    await wire.stop()
  }
})
