import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  advance,
  check,
  command,
  envValue,
  page,
  probe,
  probes,
  report,
} from './yak-watch.ts'

let config = '[{"app":"jeff/recipes"},{"app":"mom/recipe-box","login":true}]'
let [publicApp, privateApp] = probes(config)

Deno.test('watch: app list resolves each space hostname and explicit login policy', () => {
  assertEquals(probes(config), [
    {
      app: 'jeff/recipes',
      url: 'https://jeff.yaks.app/recipes/',
      login: false,
      page: true,
    },
    {
      app: 'mom/recipe-box',
      url: 'https://mom.yaks.app/recipe-box/',
      login: true,
      page: true,
    },
  ])
  for (
    let bad of [
      'null',
      '{}',
      '[]',
      '["jeff/recipes"]',
      '[{"app":"jeff/recipes","login":"yes"}]',
      '[{"app":"jeff/recipes","login":null}]',
      '[{"app":"jeff/recipes","typo":true}]',
      '[{"app":"jeff/recipes","page":"no"}]',
      '[{"app":"jeff/recipes","apex":"yaks.fyi"}]',
      '[{"apex":"yaks.fyi","login":true}]',
      '[{"apex":"https://yaks.fyi"}]',
      '[{"apex":"yaks.fyi/path"}]',
      '[{"apex":"yaks.fyi"},{"apex":"yaks.fyi"}]',
      '[{"app":"jeff/recipes"},{"app":"jeff/recipes"}]',
      ...[
        'jeff',
        '/recipes',
        '../recipes',
        'jeff/recipes/',
        'Jeff/recipes',
        'jeff/x?y=1',
      ]
        .map((app) => JSON.stringify([{ app }])),
    ]
  ) assertThrows(() => probes(bad), Error)
})

Deno.test('watch: checked-in probes page for production and only report staging', async () => {
  let text = await Deno.readTextFile(
    new URL('../workers/yak/watch.json', import.meta.url),
  )
  let list = probes(text)
  assertEquals(list.filter((p) => p.page).map((p) => p.app), [
    'jeff/recipes',
    'yourname/bookclub',
    'mom/recipe-box',
  ])
  assertEquals(list.filter((p) => !p.page), [{
    apex: 'yaks.fyi',
    url: 'https://yaks.fyi/',
    login: false,
    page: false,
  }])
})

let reply = (status: number, location?: string) =>
  ((_url, init) => {
    assertEquals(init?.redirect, 'manual')
    assertEquals(init?.signal instanceof AbortSignal, true)
    return Promise.resolve(
      new Response('', {
        status,
        headers: location ? { location } : {},
      }),
    )
  }) as typeof fetch

Deno.test('watch: staging failures report without opening or contaminating a page', async () => {
  let list = probes('[{"app":"jeff/recipes"},{"apex":"yaks.fyi","page":false}]')
  let run = () => Promise.resolve({ ok: true, text: '' })
  for (let production of [200, 503]) {
    let get = ((url, init) =>
      reply(String(url).includes('yaks.fyi') ? 503 : production)(
        url,
        init,
      )) as typeof fetch
    let result = await check(list, run, get)
    assertEquals(result.warnings, ['https://yaks.fyi/: HTTP 503, want 200'])
    assertEquals(
      result.faults,
      production == 200
        ? []
        : ['https://jeff.yaks.app/recipes/: HTTP 503, want 200'],
    )
    let letters: string[] = []
    let state = await report(advance(null, result.faults, 100), (body) => {
      letters.push(body)
      return Promise.resolve()
    })
    assertEquals(state.paged, production != 200)
    assertEquals(letters.length, production == 200 ? 0 : 1)
    assertEquals(
      letters.some((body) =>
        body.includes('yaks.fyi')
      ),
      false,
    )
  }
})

Deno.test('watch: only the private app accepts its exact login redirect', async () => {
  let login = `https://yaks.app/login?return=${
    encodeURIComponent(privateApp.url)
  }`
  assertEquals(await probe(publicApp, reply(200)), null)
  assertEquals(await probe(privateApp, reply(303, login)), null)
  for (
    let [app, status, location] of [
      [publicApp, 500],
      [publicApp, 404],
      [publicApp, 303, login],
      [privateApp, 200],
      [privateApp, 302, login],
      [privateApp, 303, login.replace('yaks.app/login', 'foreign.test/login')],
      [privateApp, 303, login.replace('recipe-box', 'other')],
      [privateApp, 303, 'https://yaks.app/login'],
    ] as const
  ) {
    assertEquals(
      (await probe(app, reply(status, location)))?.startsWith(app.url),
      true,
    )
  }
  let failed = (() => Promise.reject(new Error('timed out'))) as typeof fetch
  assertEquals(await probe(publicApp, failed), `${publicApp.url}: timed out`)
})

Deno.test('watch: a hung verifier is killed and reported', async () => {
  let result = await command(['eval', 'setInterval(() => {}, 1000)'], 100)
  assertEquals(result, {
    ok: false,
    text: 'verify-deploy timed out after 0.1s',
  })
})

Deno.test('watch: one page per continuous outage; recovery re-arms', async () => {
  let letters: string[] = []
  let send = (body: string) => {
    letters.push(body)
    return Promise.resolve()
  }
  let state = advance(null, ['down'], 100)
  state = await report(state, send)
  state = await report(advance(state, ['different symptom'], 200), send)
  assertEquals([state.first, state.last, state.count, letters.length], [
    100,
    200,
    2,
    1,
  ])
  state = await report(advance(state, [], 300), send)
  assertEquals([state.first, state.count, state.paged, letters.length], [
    null,
    0,
    false,
    1,
  ])
  state = await report(advance(state, ['down again'], 400), send)
  assertEquals([state.first, state.count, letters.length], [400, 1, 2])
})

Deno.test('watch: a failed page stays owed on the next pass', async () => {
  let state = advance(null, ['down'], 100)
  await assertRejects(() =>
    report(state, () => Promise.reject(new Error('mail down')))
  )
  assertEquals(state.paged, false)
  state = await report(advance(state, ['down'], 200), () => Promise.resolve())
  assertEquals([state.first, state.count, state.paged], [100, 2, true])
})

Deno.test('watch: mail requires owner delivery or an older receipt without statuses', async () => {
  let cfg = {
    owner: 'owner@example.test',
    token: 'test',
    account: 'test',
    api: 'https://mail.test',
  }
  let send = (response: unknown, status = 200) =>
    ((_url, init) => {
      let letter = JSON.parse(String(init?.body))
      assertEquals(letter.to, ['owner@example.test'])
      assertEquals(letter.text, '<fault>')
      assertEquals(letter.html, '<pre>&lt;fault&gt;</pre>')
      return Promise.resolve(Response.json(response, { status }))
    }) as typeof fetch
  for (
    let failed of [
      {},
      { success: false, result: { delivered: [cfg.owner] } },
      { success: true },
      ...[
        { message_id: '' },
        { message_id: ' ' },
        { message_id: 123 },
        { delivered: [], queued: [], permanent_bounces: [] },
        { delivered: ['other@example.test'] },
        { queued: ['other@example.test'] },
        { permanent_bounces: [cfg.owner] },
        { suppressed_recipients: [cfg.owner] },
        { delivered: [cfg.owner], permanent_bounces: [cfg.owner] },
        { queued: [cfg.owner], permanent_bounces: [cfg.owner] },
        { delivered: [cfg.owner], suppressed_recipients: [cfg.owner] },
        { message_id: 'receipt', permanent_bounces: [cfg.owner] },
        { message_id: 'receipt', suppressed_recipients: [cfg.owner] },
        { message_id: 'receipt', delivered: ['other@example.test'] },
        { message_id: 'receipt', queued: [] },
      ].map((result) => ({ success: true, result })),
    ]
  ) {
    await assertRejects(
      () => page(cfg, '<fault>', send(failed)),
      Error,
      'not accepted',
    )
  }
  await assertRejects(
    () => page(cfg, '<fault>', send({}, 503)),
    Error,
    'HTTP 503',
  )
  for (
    let result of [
      { message_id: 'receipt' },
      { delivered: [cfg.owner], queued: [], permanent_bounces: [] },
      { delivered: [], queued: [cfg.owner], permanent_bounces: [] },
    ]
  ) await page(cfg, '<fault>', send({ success: true, result }))
})

Deno.test('watch: dotenv reads values without executing shell syntax', () => {
  let text =
    '# TOKEN=wrong\nexport TOKEN="abc"\nACCOUNT = 123\nOTHER=$(echo ignored)'
  assertEquals(envValue(text, 'TOKEN'), 'abc')
  assertEquals(envValue(text, 'ACCOUNT'), '123')
  assertEquals(envValue(text, 'MISSING'), undefined)
  assertEquals(envValue(text, 'OTHER'), '$(echo ignored)')
})
