// A space's own number end to end through the connector (numbers.ts): found
// at its price, bought from the space's budget, its toll-free verification
// filed and read back, put on the space and then an app, and given back on
// its owner's press on the letter number_release asks for; and
// a number bought again, charged its next month, and released when its space
// is erased. The
// provider is Telnyx in memory: what is on offer, what is held, and every
// call, so nothing is bought.
import { line as q } from '@yaks/query'
import { test, until } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { next } from '@yaks/wake'
import { connector, fresh, letters, seed, unique } from './probe.ts'
import { endpoints } from './endpoints.ts'
import { collected, doomed, erase, untrashSpace } from './erase.ts'
import { GRACE } from './directory.ts'
import { door, ticket } from './confirm.ts'
import { managePath } from '@yaks/platform/routes'
import { arrived } from './operator-texts.ts'
import { appTexter } from './app-texts.ts'
import { phoneOf } from './phones.ts'
import { rang } from './operator-calls.ts'
import { monthly, released } from './numbers.ts'
import { minutes, pointed } from './number-upkeep.ts'
import { usage } from '@yaks/platform/numbers'
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
  if (path == '/calls/retired/actions/reject') {
    return Response.json({ data: {} })
  }
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
      PHONE_SENDER: { via: 'telnyx', number: '+18005550199' },
      TELNYX_API: telnyx.url,
      TELNYX_API_KEY: 'a-key',
    })
  })
  try {
    let slug = unique('grove')
    let { cookie, eids, person, email } = await seed(k, [
      { slug, apps: ['members'] },
    ])
    let agent = connector(k, cookie)
    let tool = (name: string, args: Record<string, unknown> = {}) =>
      agent.tool(name, { space: slug, ...args })

    assertStringIncludes(
      await tool('number_find', { toll_free: true }),
      `${FREE} (833) 555-0100 — $1.00 up front and $4.00 a month`,
    )
    assertStringIncludes(
      await tool('number_buy', { number: FREE }),
      '$5.00 of it from this month',
    )
    assertEquals((await k.dir.at(eids[slug]))?.meter?.texts, 5)
    assertEquals(
      await tool('number_find', { toll_free: true }),
      'No number on offer matches that.',
    )
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
      '(833) 555-0100 — not assigned yet; $1.00 up front and $4.00 a month; ' +
        'verification needed (Waiting For Customer): Add a picture of the ' +
        'sign-up card; approved for calls, texts to people who know it',
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

    let space = (await k.dir.space(slug))!
    let [owned] = await k.dir.lines(space)
    let oldLink = door(
      slug,
      'number',
      owned.eid,
      await ticket('number', space, owned.eid, person, env.SESSION_SECRET!),
    )
    let post = (path: string, values: Record<string, string>) =>
      k.at('yaks.app', path, {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(values).toString(),
      })
    let trash = managePath('trash', slug)
    let readTrash = async () =>
      await (await k.at('yaks.app', trash, { headers: { cookie } })).text()
    let cached = appTexter(env, () => FREE, () => space.eid)

    assertStringIncludes(
      await tool('number_release', { number: FREE }),
      'is in the trash',
    )
    assertEquals(held.size, 1)
    assert((await k.dir.lines(space))[0].trashed)
    assertStringIncludes(
      await tool('number_status'),
      'in the trash',
    )
    await assertRejects(() => tool('number_assign', { number: FREE }))
    assertStringIncludes(await readTrash(), '(833) 555-0100')
    assertStringIncludes(await readTrash(), '$4.00 a month')
    await assertRejects(
      () => cached.send({ to: '+12695550142', text: 'Queued before release' }),
      Error,
      'This phone number is in the trash.',
    )
    let phone = await phoneOf(env, { via: 'telnyx', number: FREE })
    await assertRejects(
      () => phone.send({ to: '+12695550142', text: 'Still held' }),
      Error,
      'This phone number is in the trash.',
    )
    let before = calls.length
    for (let text of ['hello', 'STOP', 'HELP', 'START']) {
      await arrived(env, {
        via: 'telnyx',
        rcs: false,
        id: crypto.randomUUID(),
        from: '+12695550142',
        to: FREE,
        text,
        media: [],
        at: new Date().toISOString(),
      })
    }
    assertEquals(calls.length, before)
    await rang(env, 'telnyx', {
      id: 'retired',
      from: '+12695550142',
      to: FREE,
      at: new Date().toISOString(),
    })
    assertEquals(calls.at(-1), 'POST /calls/retired/actions/reject')

    // Restore keeps the number, assignment, verification and billing clock.
    await post(trash, { restore_number: owned.eid })
    assertEquals((await k.dir.lines(space))[0], owned)
    assertEquals((await k.dir.lined(FREE))?.app.slug, 'members')
    assertStringIncludes(await readTrash(), 'Trash is empty')
    let early = `/space/${slug}/confirm/numbererase/${owned.eid}`
    assertEquals((await post(early, { confirm: FREE })).status, 409)
    assertEquals(held.size, 1)

    // Links already in an inbox still trash rather than returning it early.
    let old = new URL(oldLink)
    assertStringIncludes(
      await (await k.at('yaks.app', old.pathname + old.search, {
        headers: { cookie },
      })).text(),
      'What stops until restored',
    )
    await post(old.pathname, { t: old.searchParams.get('t')! })
    assert((await k.dir.lines(space))[0].trashed)
    assertEquals(held.size, 1)

    // Asking again mails the irreversible act, and only its press returns it.
    assertStringIncludes(
      await tool('number_release', { number: FREE }),
      'nothing has happened yet',
    )
    let mail = await until(
      () => letters(k, email).findLast((l) => l.subject.includes('Return')),
      { label: 'the return letter' },
    )
    let page =
      /https:\/\/yaks\.app(\/space\/\S+\/confirm\/numbererase\/\S+)\?t=(\S+)/
        .exec(mail!.body)!
    assertStringIncludes(
      await (await k.at('yaks.app', page[1] + '?t=' + page[2], {
        headers: { cookie },
      })).text(),
      'What goes, for good',
    )
    assertEquals(held.size, 1)
    assertEquals((await post(page[1], { confirm: 'wrong' })).status, 400)
    let pressed = await post(page[1], { t: decodeURIComponent(page[2]) })
    assertStringIncludes(await pressed.text(), 'it costs nothing from now on')
    assertEquals(held.size, 0)
    assertEquals(await k.dir.lined(FREE), null)
    assertEquals(await k.dir.trash([owned.eid]), [])
    await assertRejects(
      () => cached.send({ to: '+12695550142', text: 'Returned' }),
      Error,
      'no longer assigned',
    )
    await arrived(env, {
      via: 'telnyx',
      rcs: false,
      id: crypto.randomUUID(),
      from: '+12695550142',
      to: FREE,
      text: 'HELP',
      media: [],
      at: new Date().toISOString(),
    })
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
      'POST /calls/retired/actions/reject',
      'GET /phone_numbers',
      'DELETE /phone_numbers/number-1',
    ])

    // Bought again, its row wakes on that day next month and spends a month.
    let bought = Date.now()
    await tool('number_buy', { number: FREE })
    let [line] = await k.dir.read(q`.phone_line.number=${FREE} ?wake`)
    let wake = line.wake as { every: string; at: string }
    assertEquals(wake.every, monthly(new Date(bought)))
    assert(Date.parse(wake.at) - bought > 27 * 86_400_000)
    await tool('number_release', { number: FREE })
    await k.dir.stamp({
      entities: [{
        entity: line.entity,
        wake: { at: new Date().toISOString() },
      }],
    })
    await until(async () => (await k.dir.at(eids[slug]))?.meter?.texts == 14, {
      label: 'the next month spent',
    })
    let [after] = await k.dir.read(q`.phone_line.number=${FREE} ?wake`)
    assertEquals(
      (after.wake as { at: string }).at,
      next(wake.every, Date.now()),
    )

    let mark = (await k.dir.lines(space))[0].trashed!
    let trashed = Date.parse(mark.at)
    await collected(env, new Date(trashed + GRACE - 1))
    assertEquals(held.size, 1)
    await collected(env, new Date(trashed + GRACE))
    assertEquals(held.size, 1)
    assert((await k.dir.lines(space))[0].trashed)
    // Only the confirmed purge releases the shared number.
    await released(env, (await k.dir.lines(space))[0])
    assertEquals(await k.dir.lines(space), [])

    // Space erasure also honors grace, preserving its ownership and budget.
    await tool('number_buy', { number: FREE })
    await tool('number_assign', { number: FREE })
    space = (await k.dir.space(slug))!
    let out = await erase(env, k.dir, await doomed(k.dir, space), {
      person,
      role: 'owner',
    })
    assert(out.trashed)
    assertEquals(held.size, 1)
    space = (await k.dir.space(slug))!
    assert(space.trashed)
    let count = calls.length
    await arrived(env, {
      via: 'telnyx',
      rcs: false,
      id: crypto.randomUUID(),
      from: '+12695550142',
      to: FREE,
      text: 'HELP',
      media: [],
      at: new Date().toISOString(),
    })
    assertEquals(calls.length, count)
    // A space restore recovers its still held line as well.
    await untrashSpace(env, k.dir, space, { person, role: 'owner' })
    assertEquals((await k.dir.textSpace(FREE))?.eid, space.eid)
    space = (await k.dir.space(slug))!
    await erase(env, k.dir, await doomed(k.dir, space), {
      person,
      role: 'owner',
    })
    space = (await k.dir.space(slug))!
    let deadline = Date.parse(space.trashed!.at) + GRACE
    await collected(env, new Date(deadline - 1))
    assertEquals(held.size, 1)
    await collected(env, new Date(deadline))
    assertEquals(held.size, 1)
    assertEquals((await k.dir.read(q`.phone_line.number=${FREE}`)).length, 1)
    assert((await k.dir.space(slug))?.trashed)
  } finally {
    await k.stop()
    await telnyx.stop()
  }
})

// voip.ms in memory: what is on offer, the sub-accounts and numbers held,
// where each number's texts go, and every method called.
let LOCAL = '+12692015487'
let vms = {
  held: new Map<string, { routing: string; callback?: string }>(),
  accounts: new Map<string, string>(),
  asked: [] as URLSearchParams[],
  cdr: [] as Record<string, string>[],
  slow: 0,
}
let voipmsApi = endpoints(globalThis).open((req) => {
  let q = new URL(req.url).searchParams
  vms.asked.push(q)
  let ok = (more: object = {}) => Response.json({ status: 'success', ...more })
  let did = (d: string) => ({
    did: d,
    ratecenter: d.startsWith('269') ? 'BATTLE CRK' : 'DETROITZN1',
    state: 'MI',
    perminute_setup: '0.40',
    perminute_monthly: '1.10',
    sms: 1,
  })
  let offered = ['2692015487', '3135550100']
    .filter((d) => !vms.held.has(d)).map(did)
  switch (q.get('method')) {
    case 'searchDIDsUSA':
      return ok({
        dids: offered.filter((d) => d.did.startsWith(q.get('query')!)),
      })
    case 'getRateCentersUSA':
      return ok({
        ratecenters: [{ ratecenter: 'BATTLE CRK' }, { ratecenter: 'GRANT' }],
      })
    case 'getDIDsUSA':
      return ok({
        dids: offered.filter((d) =>
          !q.get('ratecenter') || d.ratecenter == q.get('ratecenter')
        ),
      })
    case 'createSubAccount': {
      let id = String(vms.accounts.size + 1)
      vms.accounts.set(id, `100_${q.get('username')}`)
      return ok({ id, account: `100_${q.get('username')}` })
    }
    case 'delSubAccount':
      vms.accounts.delete(q.get('id')!)
      return ok()
    case 'getSubAccounts':
      return ok({
        accounts: [...vms.accounts].map(([id, account]) => ({
          id,
          account,
          password: 'sip-pw',
        })),
      })
    case 'getServersInfo':
      return ok({ servers: [{ server_hostname: 'chicago1.voip.ms' }] })
    case 'orderDID':
      vms.held.set(q.get('did')!, { routing: q.get('routing')! })
      return ok()
    case 'setDIDRouting':
      vms.held.get(q.get('did')!)!.routing = q.get('routing')!
      return ok()
    case 'getDIDsInfo': {
      let dids = [...vms.held].filter(([d]) =>
        !q.get('did') || d == q.get('did')
      )
        .map(([did, { routing }]) => ({ did, routing, sms_enabled: '1' }))
      return dids.length || !q.get('did')
        ? ok({ dids })
        : Response.json({ status: 'invalid_did' })
    }
    case 'setSMS':
      if (vms.slow > 0 && vms.slow--) return new Response('', { status: 503 })
      vms.held.get(q.get('did')!)!.callback = q.get('url_callback')!
      return ok()
    case 'cancelDID':
      vms.held.delete(q.get('did')!)
      return ok()
    case 'sendSMS':
      return ok({ sms: 7 })
    case 'getCDR':
      return ok({ cdr: vms.cdr })
  }
  return Response.json({ status: 'invalid_method' })
})

test('a space buys a local voip.ms number by area code at its price and our margin, hears texts at it, signs a softphone in and gives it back', async () => {
  let env!: Env
  let k = await fresh({}, (e) => {
    env = e
    Object.assign(e, {
      PHONE_SENDER: { via: 'telnyx', number: '+18005550199' },
      TELNYX_API: telnyx.url,
      TELNYX_API_KEY: 'a-key',
      VOIPMS_API: voipmsApi.url,
      VOIPMS_USERNAME: 'us@example.com',
      VOIPMS_API_PASSWORD: 'pw',
    })
  })
  try {
    let slug = unique('home')
    let { cookie, eids } = await seed(k, [{ slug, apps: [] }])
    let agent = connector(k, cookie)
    let tool = (name: string, args: Record<string, unknown> = {}) =>
      agent.tool(name, { space: slug, ...args })

    let offer = `${LOCAL} (269) 201-5487 (BATTLE CRK, MI) — ` +
      '$0.40 up front and $4.10 a month'
    assertStringIncludes(await tool('number_find', { area: '269' }), offer)
    assertStringIncludes(
      await tool('number_find', { state: 'MI', city: 'Battle Creek' }),
      offer,
    )
    await assertRejects(
      () => tool('number_buy', { number: '+12695550000' }),
      Error,
      `On offer in 269: ${LOCAL} ($0.40 up front and $4.10 a month)`,
    )
    assertStringIncludes(
      await tool('number_buy', { number: LOCAL }),
      '$4.50 of it from this month',
    )
    assertEquals((await k.dir.at(eids[slug]))?.meter?.texts, 4.5)
    assertEquals(vms.held.get('2692015487')?.routing, 'account:100_y2692015487')

    // voip.ms slow to set its texts: assigned all the same, and pointed by
    // the next hour's upkeep.
    vms.slow = 2
    assertStringIncludes(
      await tool('number_assign', { number: LOCAL }),
      'arrive once it has, within the hour',
    )
    assertEquals(vms.held.get('2692015487')?.callback, undefined)
    assertEquals(await pointed(env), 1)
    assert(vms.held.get('2692015487')?.callback)
    assertEquals((await k.dir.textSpace(LOCAL))?.sender, {
      via: 'voipms',
      number: LOCAL,
    })
    assertStringIncludes(
      await tool('number_status'),
      'approved for calls, texts to people who know it',
    )
    assertStringIncludes(
      await tool('number_status', { number: LOCAL, login: true }),
      'at chicago1.voip.ms as 100_y2692015487 with password sip-pw',
    )

    // A text to it reaches the space at the callback voip.ms was given; a
    // HELP is answered from the number itself.
    let callback = new URL(vms.held.get('2692015487')!.callback!)
    let path = callback.pathname
    let reach = (to: string, text: string) =>
      k.at(
        'yaks.app',
        `${path}?id=${crypto.randomUUID()}&from=2695550142&to=${to}&message=${text}`,
      )
    assertEquals((await reach('2695559999', 'HELP')).status, 403)
    assertEquals((await reach('2692015487', 'HELP')).status, 200)
    let sent = vms.asked.find((q) => q.get('method') == 'sendSMS')
    assertEquals(
      [sent?.get('did'), sent?.get('dst')],
      ['2692015487', '2695550142'],
    )
    assertEquals(
      (await k.at('yaks.app', '/voipms/not-a-ticket?id=1&to=1')).status,
      403,
    )

    // On a number approved only for texts to people who know it, a
    // stranger's text is told to the space's owner, and nobody answers it.
    let texts = vms.asked.filter((q) => q.get('method') == 'sendSMS').length
    assertEquals(
      (await reach('2692015487', 'Your%20code%20is%20123')).status,
      200,
    )
    let home = (await k.dir.space(slug))!
    let [owner] = await k.dir.owners(home)
    let updates = async () =>
      (await (await k.builder(home.eid).fetch(
        new Request('https://builder/operator/updates', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-yak-person': owner,
            'x-space-eid': home.eid,
          },
          body: '{}',
        }),
      )).json()).updates as { words: string; subject?: string }[]
    let told = await until(
      async () => (await updates()).find((u) => u.words == 'Your code is 123'),
      { label: 'the owner told of the text' },
    )
    assertEquals(told.subject, 'Text to (269) 201-5487 from (269) 555-0142')
    assertEquals(
      vms.asked.filter((q) => q.get('method') == 'sendSMS').length,
      texts,
    )

    await tool('number_assign', { number: LOCAL, campaign: 'CX1' })
    assertStringIncludes(
      await tool('number_status'),
      'texts to many people (10DLC campaign CX1)',
    )

    // Its calls are charged once each, at voip.ms's price and our share.
    let spent = async () => (await k.dir.at(eids[slug]))?.meter?.texts ?? 0
    let before = await spent()
    let soon = new Date(Date.now() + 60_000).toISOString()
    vms.cdr = [
      { destination: '2692015487', account: '100', total: '0.0072' },
      { destination: '2695550142', account: '100_y2692015487', total: '0.01' },
      { destination: '2695550100', account: '100_other', total: '5' },
    ].map((c, i) => ({
      ...c,
      uniqueid: String(i),
      seconds: '60',
      date: soon.slice(0, 19).replace('T', ' '),
    }))
    assertEquals(await minutes(env, new Date()), 2)
    assertEquals(await minutes(env, new Date()), 0)
    assertEquals(
      Number((await spent() - before).toFixed(6)),
      usage(0.0072) + usage(0.01),
    )

    let space = (await k.dir.space(slug))!
    await tool('number_release', { number: LOCAL })
    await released(env, (await k.dir.lines(space))[0])
    assertEquals(vms.held.size, 0)
    assertEquals(vms.accounts.size, 0)
  } finally {
    await k.stop()
    await voipmsApi.stop()
  }
})
