import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { Unsent } from '@yaks/host/senders'
import { Blocked, Denied } from '@yaks/phone'
import { connected, numbers, TEXTING, voipms } from './mod.ts'
import { requester } from './request.ts'

// An account whose API answers every call with `said`, keeping what it was
// asked.
let account = (said: () => Response) => {
  let asked: URLSearchParams[] = []
  let line = voipms({
    user: 'jeff@example.com',
    key: 'pw',
    fetch: (url) => {
      asked.push(new URL(String(url)).searchParams)
      return Promise.resolve(said())
    },
  })
  return { line, asked }
}
let answering = (body: object) => () => Response.json(body)
let DIDS = {
  status: 'success',
  sms: 1,
  mms: 2,
  dids: [
    { did: '2695550199', sms_enabled: '0' },
    { did: '2695550100', sms_enabled: '1' },
  ],
}

test('a text goes from the first number that texts, as SMS up to 160 characters and MMS past it', async () => {
  let { line, asked } = account(answering(DIDS))
  assertEquals(await line.send({ to: '+12695550142', text: 'Hi' }), { id: '1' })
  assertEquals(await line.send({ to: '+12695550142', text: 'x'.repeat(161) }), {
    id: '2',
  })
  assertEquals(
    asked.map((q) => [q.get('method'), q.get('did')]),
    [['getDIDsInfo', null], ['sendSMS', '2695550100'], [
      'sendMMS',
      '2695550100',
    ]],
  )
})

test("voip.ms's refusals are told apart: a limit is Blocked, a key it refuses Denied, a 5xx Unsent", async () => {
  for (
    let [said, error] of [
      [answering({ status: 'limit_reached' }), Blocked],
      [answering({ status: 'ip_not_enabled' }), Denied],
      [answering({ status: 'invalid_credentials' }), Denied],
      [() => new Response('', { status: 503 }), Unsent],
      [answering({ status: 'sms_failed', message: 'no' }), Error],
    ] as const
  ) {
    let { line } = account(said)
    await assertRejects(
      () => line.send({ to: '+12695550142', text: 'Hi', from: '+12695550100' }),
      error,
    )
  }
})

test('a number whose sub-account voip.ms will not make is given back', async () => {
  let asked: string[] = []
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (url) => {
      let method = new URL(String(url)).searchParams.get('method')!
      asked.push(method)
      return Promise.resolve(Response.json(
        method == 'createSubAccount'
          ? { status: 'invalid_callerid' }
          : { status: 'success', accounts: [] },
      ))
    },
  })
  await assertRejects(() => shop.buy('+12695550100'), Error, 'invalid_callerid')
  assertEquals(asked, [
    'getDIDsInfo',
    'orderDID',
    'createSubAccount',
    'cancelDID',
    'getSubAccounts',
  ])
})

test('a slow sub-account reply leaves the confirmed DID held for voice upkeep', async () => {
  let time = clock()
  let asked: string[] = []
  let held = false
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (url, init) => {
      let method = new URL(String(url)).searchParams.get('method')!
      let signal = init!.signal!
      asked.push(method)
      let ok = (body: object = {}) =>
        Response.json({ status: 'success', ...body })
      if (method == 'orderDID') {
        return new Promise((answer) =>
          time.after(14_000, () => {
            held = true
            answer(ok())
          })
        )
      }
      if (method == 'createSubAccount') {
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start: (body) => {
                signal.addEventListener(
                  'abort',
                  () => body.error(signal.reason),
                )
              },
            }),
          ),
        )
      }
      if (method == 'cancelDID') held = false
      return Promise.resolve(ok())
    },
  }, time)
  let answer = shop.buy('+12695550100')
  await time.advance(14_000)
  assertEquals(held, true)
  await time.advance(14_000)
  assertEquals((await answer).status, 'held')
  assertEquals(held, true)
  assertEquals(asked, [
    'getDIDsInfo',
    'orderDID',
    'createSubAccount',
  ])
  assertEquals(time.pending(), 0)
})

test('a stalled purchase cleanup answers with the carrier state unconfirmed', async () => {
  let time = clock()
  let asked: string[] = []
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (url, init) => {
      let method = new URL(String(url)).searchParams.get('method')!
      asked.push(method)
      if (method == 'getDIDsInfo' || method == 'orderDID') {
        return Promise.resolve(Response.json({ status: 'success' }))
      }
      if (method == 'createSubAccount') {
        return Promise.resolve(Response.json({ status: 'invalid_callerid' }))
      }
      let signal = init!.signal!
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason))
      )
    },
  }, time)
  let answer = assertRejects(
    () => shop.buy('+12695550100'),
    Error,
    'Cleanup of +12695550100 could not be confirmed',
  )
  await time.advance(10_000)
  let error = await answer
  assertEquals(asked, [
    'getDIDsInfo',
    'orderDID',
    'createSubAccount',
    'cancelDID',
  ])
  assertEquals(time.pending(), 0)
  assertEquals((error.cause as AggregateError).errors.length, 2)
})

test('an unanswered order waits for the DID to appear without ordering it again', async () => {
  let placed = 0
  let held = false
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (url) => {
      let method = new URL(String(url)).searchParams.get('method')!
      if (method == 'orderDID') {
        placed++
        return Promise.resolve(new Response('', { status: 522 }))
      }
      return Promise.resolve(Response.json({
        status: 'success',
        dids: held ? [{ did: '2695550100', routing: 'sys:hangup' }] : [],
      }))
    },
  })
  let number = '+12695550100'
  assertEquals((await shop.buy(number)).status, 'pending')
  assertEquals(await shop.ordered!(number), false)
  held = true
  assertEquals(await shop.ordered!(number), true)
  assertEquals(placed, 1)
})

test('buying a number already held on the sub-account made for it completes it, quoted at its month alone', async () => {
  let asked: string[] = []
  let said: Record<string, object> = {
    searchDIDsUSA: { dids: [] },
    getDIDsInfo: {
      dids: [{
        did: '2695550100',
        description: 'BATTLE CRK, MI',
        routing: 'account:100_y2695550100',
      }],
    },
    getDIDsUSA: {
      dids: [{
        did: '2695550199',
        perminute_setup: '0.40',
        perminute_monthly: '1.10',
      }],
    },
  }
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (url) => {
      let method = new URL(String(url)).searchParams.get('method')!
      asked.push(method)
      return Promise.resolve(
        Response.json({ status: 'success', ...said[method] }),
      )
    },
  })
  let [offer] = await shop.find({ number: '+12695550100' })
  assertEquals([offer.upfront, offer.monthly, offer.place], [
    0,
    1.1,
    'BATTLE CRK, MI',
  ])
  assertEquals((await shop.buy('+12695550100')).status, 'held')
  assertEquals(asked.includes('orderDID'), false)
})

// A shop whose search hangs until aborted the first `slow` times it is asked.
let slowShop = (slow: number) => {
  let time = clock()
  let asked = 0
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (_url, init) => {
      if (asked++ >= slow) {
        return Promise.resolve(Response.json({
          status: 'success',
          dids: [{ did: '2692015487', state: 'MI', ratecenter: 'X', sms: 1 }],
        }))
      }
      let signal = init!.signal!
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start: (body) =>
              signal.addEventListener('abort', () => body.error(signal.reason)),
          }),
        ),
      )
    },
  }, time)
  return { shop, time }
}

test('a search voip.ms is slow to answer is asked once more, and a second slow answer is Unsent', async () => {
  let once = slowShop(1)
  let found = once.shop.find({ area: '269' })
  await once.time.advance(8_000)
  assertEquals((await found).map((o) => o.number), ['+12692015487'])

  let twice = slowShop(2)
  let refused = assertRejects(
    () => twice.shop.find({ area: '269' }),
    Unsent,
    'voip.ms is slow to answer searchDIDsUSA',
  )
  await twice.time.advance(8_000)
  await twice.time.advance(8_000)
  await refused
  assertEquals(twice.time.pending(), 0)
})

// An account whose API never answers, on a clock the test holds.
let silent = () => {
  let time = clock()
  let line = voipms({
    user: 'u',
    key: 'k',
    number: '+12695550100',
    fetch: (_url, init) => {
      let signal = init!.signal!
      return new Promise((_, no) =>
        signal.addEventListener('abort', () => no(signal.reason))
      )
    },
  }, time)
  return { line, time }
}

test('a method voip.ms is slow to answer is Unsent, but a text it may have taken is not', async () => {
  let reading = silent()
  let read = assertRejects(() => reading.line.lines(), Unsent)
  await reading.time.advance(16_000)
  await read

  let sending = silent()
  let sent = sending.line.send({ to: '+12695550142', text: 'Hi' })
    .then(() => null, (e) => e)
  await sending.time.advance(16_000)
  let error = await sent
  assertEquals(
    [error instanceof Unsent, error.message],
    [false, 'voip.ms did not answer sendSMS in time'],
  )
})

test("pointing a number's texts where they already go asks voip.ms nothing more", async () => {
  let asked: string[] = []
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (url) => {
      let method = new URL(String(url)).searchParams.get('method')!
      asked.push(method)
      return Promise.resolve(Response.json({
        status: 'success',
        dids: [{
          did: '2695550100',
          sms_enabled: '1',
          sms_url_callback_enabled: '1',
          sms_url_callback: 'https://host/voipms/t',
        }],
      }))
    },
  })
  await shop.point!('+12695550100', 'https://host/voipms/t')
  await shop.point!('+12695550100', 'https://host/voipms/other')
  assertEquals(asked, ['getDIDsInfo', 'getDIDsInfo', 'setSMS'])
})

test('a spent budget stops outbound calls and leaves the sign-in and inbound route in place', async () => {
  let sub = {
    id: '7',
    account: '100_y2695550100',
    username: 'y2695550100',
    password: 'sip-pw',
    enable_ip_restriction: '0',
    ip_restriction: '',
  }
  let did = { did: '2695550100', routing: 'account:100_y2695550100' }
  let set: Record<string, string>[] = []
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (url) => {
      let q = Object.fromEntries(new URL(String(url)).searchParams)
      let method = q.method
      if (method == 'setSubAccount') {
        set.push(q)
        Object.assign(sub, q)
      }
      if (method == 'setDIDRouting') did.routing = q.routing
      return Promise.resolve(Response.json({
        status: 'success',
        accounts: [sub],
        dids: [did],
      }))
    },
  })
  let ways = () => ({
    in: did.routing == 'account:100_y2695550100',
    out: sub.enable_ip_restriction == '0',
  })
  for (
    let want of [
      { in: true, out: false },
      { in: true, out: true },
      { in: true, out: true },
    ]
  ) {
    await shop.allow!('+12695550100', {
      ...want,
      seats: ['first'],
      legacy: 'first',
    })
    assertEquals(ways(), want)
  }
  assertEquals(set.map((q) => [q.id, q.password]), [['7', 'sip-pw'], [
    '7',
    'sip-pw',
  ]])
})

test('a trashed line stops calls out first, asking again on its own, then hangs up its calls in', async () => {
  let sub = {
    id: '7',
    account: '100_y2695550100',
    username: 'y2695550100',
    password: 'sip-pw',
    enable_ip_restriction: '0',
    ip_restriction: '',
  }
  let did = { did: '2695550100', routing: 'account:100_y2695550100' }
  let asked: string[] = []
  let refusals = 0
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (url) => {
      let q = Object.fromEntries(new URL(String(url)).searchParams)
      asked.push(q.method)
      if (q.method == 'setSubAccount' && refusals-- > 0) {
        return Promise.resolve(Response.json({ status: 'busy' }))
      }
      if (q.method == 'setSubAccount') Object.assign(sub, q)
      if (q.method == 'setDIDRouting') did.routing = q.routing
      return Promise.resolve(Response.json({
        status: 'success',
        accounts: [sub],
        dids: [did],
      }))
    },
  })
  let shut = { in: false, out: false, seats: ['first'], legacy: 'first' }
  let writes = () => asked.filter((m) => m.startsWith('set'))

  refusals = 1
  await shop.allow!('+12695550100', shut)
  assertEquals(writes(), ['setSubAccount', 'setSubAccount', 'setDIDRouting'])
  assertEquals([sub.enable_ip_restriction, sub.password], ['1', 'sip-pw'])
  assertEquals(did.routing, 'sys:hangup')

  // Refused both times, calls in are still hung up.
  Object.assign(sub, { enable_ip_restriction: '0', ip_restriction: '' })
  did.routing = 'account:100_y2695550100'
  asked = []
  refusals = 2
  await assertRejects(() => shop.allow!('+12695550100', shut), AggregateError)
  assertEquals(writes(), ['setSubAccount', 'setSubAccount', 'setDIDRouting'])
  assertEquals(did.routing, 'sys:hangup')
})

test('a late duplicate SIP account leaves the earlier sign-in in place', async () => {
  let first = {
    id: '1',
    account: '100_y2695550100',
    username: 'y2695550100',
    password: 'first-password',
  }
  let duplicate = { ...first, id: '2', password: 'late-password' }
  let accounts = [duplicate, first]
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (url) => {
      let q = new URL(String(url)).searchParams
      if (q.get('method') == 'delSubAccount') {
        accounts = accounts.filter((a) => a.id != q.get('id'))
      }
      return Promise.resolve(Response.json({
        status: 'success',
        accounts,
        servers: [{ server_hostname: 'sip.example' }],
        dids: [{ did: '2695550100', routing: 'account:100_y2695550100' }],
      }))
    },
  })
  let login = await shop.login!('+12695550100', 'first', {
    in: true,
    out: true,
    seats: ['first'],
    legacy: 'first',
  })
  assertEquals(login.password, first.password)
  assertEquals(accounts, [first])
})

test('permanent return cancels a DID even when SIP cleanup has to wait', async () => {
  let held = true
  let slow = true
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (url) => {
      let method = new URL(String(url)).searchParams.get('method')
      if (method == 'cancelDID') {
        let status = held ? 'success' : 'invalid_did'
        held = false
        return Promise.resolve(Response.json({ status }))
      }
      if (method == 'getSubAccounts' && slow) {
        return Promise.resolve(new Response('', { status: 522 }))
      }
      return Promise.resolve(Response.json({ status: 'success' }))
    },
  })
  let number = '+12695550100'
  await shop.release(number)
  assertEquals(held, false)
  await assertRejects(() => shop.cleanup!(number), Unsent)
  slow = false
  await shop.cleanup!(number)
})

test('a read voip.ms is slow to answer is asked once more, and a text is never sent twice', async () => {
  let time = clock()
  let asked: string[] = []
  let line = voipms({
    user: 'u',
    key: 'k',
    number: '+12695550100',
    fetch: (url) => {
      asked.push(new URL(String(url)).searchParams.get('method')!)
      return Promise.resolve(new Response('', { status: 503 }))
    },
  }, time)
  await assertRejects(() => line.lines(), Unsent, 'slow to answer getDIDsInfo')
  await assertRejects(
    () => line.send({ to: '+12695550142', text: 'Hi' }),
    Unsent,
  )
  assertEquals(asked, ['getDIDsInfo', 'getDIDsInfo', 'sendSMS'])
  assertEquals(time.pending(), 0)
})

test("a person's own account asks voip.ms for only its integration's methods, and holds no way to cancel or route a number", async () => {
  let asked: string[] = []
  let fetch = (url: string | URL | Request) => {
    asked.push(new URL(String(url)).searchParams.get('method')!)
    return Promise.resolve(Response.json(DIDS))
  }
  let own = (methods?: string[]) =>
    connected({ via: 'voipms', user: 'u', key: 'k', methods, fetch })
  let line = own(['getDIDsInfo', 'setSMS'])
  assertEquals(Object.keys(line).sort(), ['from', 'lines', 'point', 'send'])
  await line.point('+12695550100', 'https://yaks.app/voipms/t')
  await assertRejects(
    () => line.send({ to: '+12695550142', text: 'Hi', from: '+12695550100' }),
    Error,
    'cannot ask for sendSMS',
  )
  await assertRejects(() => own().lines(), Error, 'cannot ask for getDIDsInfo')
  assertEquals(asked, ['getDIDsInfo', 'setSMS'])
})

test('a client made from a method list sends voip.ms no other', async () => {
  let sent = 0
  let call = requester({
    user: 'u',
    key: 'k',
    methods: TEXTING,
    fetch: () => (sent++, Promise.resolve(Response.json(DIDS))),
  })
  for (let m of ['cancelDID', 'setDIDRouting', 'delSubAccount', 'orderDID']) {
    await assertRejects(() => call(m, { did: '2695550100' }), Error, m)
  }
  assertEquals(sent, 0)
})
