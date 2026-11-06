// A space's own number end to end through the connector (numbers.ts): found
// at its price, bought from the space's budget, its toll-free verification
// filed and read back, put on the space and then an app, and given back; and
// a number bought again, charged its next month, and released when its space
// is erased. The
// provider is Telnyx in memory: what is on offer, what is held, and every
// call, so nothing is bought.
import { test, until } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { next } from '@yaks/wake'
import { connector, fresh, seed, unique } from './probe.ts'
import { endpoints } from './endpoints.ts'
import { doomed, erase } from './erase.ts'
import { monthly } from './numbers.ts'
import type { Env } from './env.ts'

let FREE = '+18335550100'
let held = new Set<string>()
let calls: string[] = []
let filed: Record<string, unknown>[] = []
let telnyx = endpoints(globalThis).open(async (req) => {
  let url = new URL(req.url)
  let path = url.pathname
  calls.push(`${req.method} ${path}`)
  let body = req.method == 'GET' || req.method == 'DELETE'
    ? {}
    : await req.json()
  if (path == '/messaging_profiles') {
    return Response.json({ data: [{ id: 'profile-1' }] })
  }
  if (path == '/available_phone_numbers') {
    let want = url.searchParams.get('filter[phone_number][starts_with]')
    return Response.json({
      data: [FREE].filter((n) => !held.has(n) && (!want || n == want)).map(
        (phone_number) => ({
          phone_number,
          cost_information: {
            upfront_cost: '1.00000',
            monthly_cost: '1.00000',
            currency: 'USD',
          },
          features: [{ name: 'sms' }, { name: 'voice' }],
        }),
      ),
    })
  }
  if (path == '/number_orders') {
    held.add(body.phone_numbers[0].phone_number)
    return Response.json({ data: { id: 'order-1', status: 'success' } })
  }
  if (path == '/phone_numbers' && req.method == 'GET') {
    return Response.json({ data: [{ id: 'number-1' }] })
  }
  if (path == '/phone_numbers/number-1') {
    held.delete(FREE)
    return Response.json({ data: {} })
  }
  if (path.startsWith('/messaging_tollfree/verification/requests')) {
    if (req.method == 'POST') filed.push(body)
    return Response.json({
      id: 'tfv-1',
      verificationStatus: req.method == 'POST'
        ? 'In Progress'
        : 'Waiting For Customer',
      reason: req.method == 'POST' ? null : 'Add a picture of the sign-up card',
      phoneNumbers: [{ phoneNumber: FREE }],
    })
  }
  return Response.json({ errors: [{ detail: 'unknown' }] }, { status: 404 })
})

let church = {
  business: {
    name: 'Locust Grove Church',
    website: 'https://locustgrove.yaks.app',
    street: '1 Main St',
    city: 'Sturgis',
    state: 'MI',
    zip: '49091',
    entity: 'non_profit',
    ein: '12-3456789',
  },
  contact: {
    first: 'Ann',
    last: 'Lee',
    email: 'ann@example.org',
    phone: '+12695550142',
  },
  use_case: 'Religious Services',
  summary: 'Service times and prayer requests to members who signed up.',
  sample: 'Locust Grove: Service is at 10am Sunday. Reply STOP to opt out.',
  volume: '1,000',
  opt_in: 'Members sign up on a card at church.',
  opt_in_images: ['https://example.org/card.png'],
}

test('a space finds, buys, verifies, assigns and releases a toll-free number of its own', async () => {
  let env!: Env
  let k = await fresh({}, (e) => {
    env = e
    Object.assign(e, {
      PHONE_SENDER: { via: 'telnyx' },
      TELNYX_API: telnyx.url,
      TELNYX_API_KEY: 'a-key',
    })
  })
  try {
    let slug = unique('grove')
    let { cookie, eids, person } = await seed(k, [{ slug, apps: ['members'] }])
    let agent = connector(k, cookie)
    let tool = (name: string, args: Record<string, unknown> = {}) =>
      agent.tool(name, { space: slug, ...args })

    assertStringIncludes(
      await tool('number_find'),
      `${FREE} (833) 555-0100 — $1.00 up front and $1.00 a month`,
    )
    assertStringIncludes(
      await tool('number_buy', { number: FREE }),
      '$2.00 of it from this month',
    )
    assertEquals((await k.dir.at(eids[slug]))?.meter?.texts, 2)
    assertEquals(await tool('number_find'), 'No number on offer matches that.')
    await assertRejects(() => tool('number_buy', { number: FREE }))

    assertStringIncludes(
      await tool('number_verify', { number: FREE, ...church }),
      'Filed the toll-free verification for (833) 555-0100 (tfv-1): In Progress',
    )
    assertEquals(filed[0].useCase, 'Religious Services')
    assertEquals(filed[0].entityType, 'NON_PROFIT')
    assertEquals(filed[0].isvReseller, 'yaks.app')
    assertEquals(
      await tool('number_status'),
      '(833) 555-0100 — not assigned yet; $1.00 up front and $1.00 a month; ' +
        'verification needed (Waiting For Customer): Add a picture of the ' +
        'sign-up card',
    )

    await tool('number_assign', { number: FREE })
    assertEquals((await k.dir.textSpace(FREE))?.sender, {
      via: 'telnyx',
      number: FREE,
    })
    await tool('number_assign', { number: FREE, app: 'members' })
    assertEquals(await k.dir.textSpace(FREE), null)
    assertEquals((await k.dir.lined(FREE))?.app.slug, 'members')
    assertStringIncludes(
      await tool('number_status'),
      `texts for ${slug}/members`,
    )

    assertStringIncludes(
      await tool('number_release', { number: FREE }),
      'it costs nothing from now on',
    )
    assertEquals(held.size, 0)
    assertEquals(await k.dir.lined(FREE), null)
    assertStringIncludes(await tool('number_status'), 'holds no number')
    assertEquals(calls.filter((c) => !c.includes('messaging_profiles')), [
      'GET /available_phone_numbers',
      'GET /available_phone_numbers',
      'POST /number_orders',
      'GET /available_phone_numbers',
      'GET /available_phone_numbers',
      'POST /messaging_tollfree/verification/requests',
      'GET /messaging_tollfree/verification/requests/tfv-1',
      'GET /messaging_tollfree/verification/requests/tfv-1',
      'GET /phone_numbers',
      'DELETE /phone_numbers/number-1',
    ])

    // Bought again, its row wakes on that day next month and spends a month.
    let bought = Date.now()
    await tool('number_buy', { number: FREE })
    let [line] = await k.dir.read(`.phone_line.number=${FREE} ?wake`)
    let wake = line.wake as { every: string; at: string }
    assertEquals(wake.every, monthly(new Date(bought)))
    assert(Date.parse(wake.at) - bought > 27 * 86_400_000)
    await k.dir.stamp({
      entities: [{
        entity: line.entity,
        wake: { at: new Date().toISOString() },
      }],
    })
    await until(async () => (await k.dir.at(eids[slug]))?.meter?.texts == 5, {
      label: 'the next month spent',
    })
    let [after] = await k.dir.read(`.phone_line.number=${FREE} ?wake`)
    assertEquals(
      (after.wake as { at: string }).at,
      next(wake.every, Date.now()),
    )

    // Erasing the space gives the number back, and its row goes with it.
    let space = (await k.dir.space(slug))!
    await erase(env, k.dir, await doomed(k.dir, space), {
      person,
      role: 'owner',
    })
    assertEquals(held.size, 0)
    assertEquals(calls.at(-1), 'DELETE /phone_numbers/number-1')
    assertEquals(await k.dir.read(`.phone_line.number=${FREE}`), [])
  } finally {
    await k.stop()
    await telnyx.stop()
  }
})
