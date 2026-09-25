// The pure seams of the platform client: where a store answers, what a
// session says about itself, which letter carries the code, and how a tool's
// reply reads once the envelope is off.
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import type { And } from '@yaks/query'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail/vocab'
import { CallError } from '@yaks/tools'
import {
  claimsOf,
  codeFor,
  codeIn,
  cookieOf,
  feeNow,
  listedOn,
  plain,
  renewing,
  rpc,
  saidBy,
  saidOn,
  storeQuery,
  storeUrl,
  timing,
} from './api.ts'

let letter = (title: string, to: string, at: string): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  doc: { title },
  mail: { to, at },
})

Deno.test('an app store answers under its space, the front page at the root', () => {
  assertEquals(
    storeUrl('jeff/recipes', '/query', 'yaks.app'),
    'https://jeff.yaks.app/recipes/api/query',
  )
  assertEquals(
    storeUrl('jeff', '/apply', 'yaks.app'),
    'https://jeff.yaks.app/api/apply',
  )
  for (let at of ['', '.email', 'jeff/.email', 'jeff/recipes/more']) {
    let error = assertThrows(
      () => storeUrl(at, '/query', 'yaks.app'),
      CallError,
      'not a space or space/app',
    )
    assertEquals(error.code, 'where')
  }
})

Deno.test('a session says whose it is without the secret', () => {
  let body = btoa(JSON.stringify({ person: 'p-1', space: null, exp: 42 }))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  assertEquals(claimsOf(`${body}.mac`), { person: 'p-1', space: null, exp: 42 })
  assertEquals(claimsOf('not-a-token'), null)
  assertEquals(claimsOf(''), null)
})

Deno.test('the session is read off the card’s own set-cookie', () => {
  assertEquals(
    cookieOf('yak_session=tok.en; Domain=yaks.app; Path=/; HttpOnly'),
    'tok.en',
  )
  assertEquals(cookieOf('other=1; Path=/'), null)
  assertEquals(cookieOf(null), null)
})

Deno.test('the code is the newest letter to THIS address since the ask', () => {
  let letters = [
    letter(
      '111111 is your yaks.app code',
      'probe@bot.yak.sh',
      '2026-09-04T12:00:00Z',
    ),
    letter(
      '222222 is your yaks.app code',
      'probe@bot.yak.sh',
      '2026-09-04T12:05:00Z',
    ),
    letter(
      '333333 is your yaks.app code',
      'other@bot.yak.sh',
      '2026-09-04T12:06:00Z',
    ),
    letter(
      'a letter about nothing',
      'probe@bot.yak.sh',
      '2026-09-04T12:07:00Z',
    ),
  ]
  let since = Date.parse('2026-09-04T11:59:00Z')
  assertEquals(codeIn(letters, 'probe@bot.yak.sh', since), '222222')
  // A code that predates the ask is a stale one: it would fail its own mac.
  assertEquals(
    codeIn(letters, 'probe@bot.yak.sh', Date.parse('2026-09-04T12:06:00Z')),
    null,
  )
  assertEquals(codeIn(letters, 'nobody@bot.yak.sh', since), null)
  assertEquals(codeIn([], 'probe@bot.yak.sh', since), null)
})

// An in-memory graph holding the letters, answering the query as a store
// does: the recipient and the window select, and the limit keeps what it
// keeps.
let entity: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
  },
}

let mailbox = async (letters: Bundle[]) => {
  let vocab = loadVocab([entity, docDoc, mailDoc])
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply(letters)
  return (q: And) => g.read(q)
}

Deno.test('the code is found by its address among many newer letters', async () => {
  let since = Date.parse('2026-09-04T12:00:00Z')
  let ours = letter(
    '444444 is your yaks.app code',
    'probe@bot.yak.sh',
    '2026-09-04T12:00:05Z',
  )
  let others = Array.from({ length: 50 }, (_, i) =>
    letter(
      `${100000 + i} is your yaks.app code`,
      `other${i}@bot.yak.sh`,
      '2026-09-04T12:00:09Z',
    ))
  let old = letter(
    '555555 is your yaks.app code',
    'probe@bot.yak.sh',
    '2026-09-04T11:00:00Z',
  )
  let read = await mailbox([old, ours, ...others])
  assertEquals(
    await codeFor(read, 'probe@bot.yak.sh', since, { wait: 0 }),
    '444444',
  )
})

Deno.test('a tool answers its words, and an erring one throws them', () => {
  assertEquals(
    saidBy({ content: [{ type: 'text', text: 'made notes' }] }),
    'made notes',
  )
  assertEquals(saidBy({}), '')
  let no = assertThrows(
    () =>
      saidBy({
        content: [{ type: 'text', text: 'no space notes' }],
        isError: true,
      }),
    CallError,
  )
  assertStringIncludes((no as Error).message, 'no space notes')
  assertEquals((no as CallError).code, 'mcp_tool')
})

Deno.test('a kernel page is read back as the words it says', () => {
  // The shape workers/yak/pages.ts `shell` renders, with everything it
  // interpolated escaped on the way out (T-33166).
  let page =
    '<body><main><h1>That&#39;s done.</h1><p>shoplab.yaks.app is gone: 1 ' +
    'app, 2 files, everything they saved.</p>' +
    '<ol><li>The Shop (https://shoplab.yaks.app/shop/)</li>' +
    '<li>dana &amp; sam lose their way in</li></ol></main></body>'
  assertStringIncludes(plain(saidOn(page).title), "That's done.")
  assertStringIncludes(plain(saidOn(page).lead), 'shoplab.yaks.app is gone')
  assertEquals(listedOn(page).map(plain), [
    'The Shop (https://shoplab.yaks.app/shop/)',
    'dana & sam lose their way in',
  ])
  assertEquals(saidOn('not a page'), { title: '', lead: '' })
})

// The sliding session, this end (T-35380): the platform re-mints a cookie past
// half its life, so any answer may carry a new value for the same account and
// the box must write it down — ./tools.ts keeps it in the vault behind
// `renewing`. The fetch is stubbed, and the answer is as little of one as the
// client reads: what it says, and the header a renewal would arrive in. A web
// `Response` would cost this process its whole fetch warm-up for a test that
// never leaves it.
let fee = (set?: string) => ({
  ok: true,
  status: 200,
  headers: {
    get: (name: string) => (name == 'set-cookie' ? set ?? null : null),
  },
  text: () => Promise.resolve('{"bps":250,"rate":"2.5%"}'),
})

let answering = (res: ReturnType<typeof fee>) => {
  let real = globalThis.fetch
  let sent: Record<string, string>[] = []
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    sent.push(init.headers as Record<string, string>)
    return Promise.resolve(res)
  }) as unknown as typeof fetch
  return { sent, done: () => void (globalThis.fetch = real) }
}

Deno.test('a renewed cookie is handed on, and an ordinary answer is quiet', async () => {
  let fresh: string[] = []
  renewing((v) => fresh.push(v))
  let renewed = answering(
    fee('yak_session=slid.token; Domain=yaks.app; Path=/; Max-Age=7776000'),
  )
  try {
    await feeNow('old.token')
    assertEquals(renewed.sent[0].cookie, 'yak_session=old.token')
    assertEquals(fresh, ['slid.token'])
  } finally {
    renewed.done()
  }
  // Nothing set, and the very cookie that was sent echoed back: neither is a
  // renewal, and neither touches the account.
  for (let set of [undefined, 'yak_session=old.token; Path=/']) {
    let quiet = answering(fee(set))
    try {
      await feeNow('old.token')
      assertEquals(fresh, ['slid.token'])
    } finally {
      quiet.done()
    }
  }
  renewing(() => {})
})

Deno.test('an expired MCP session is a refusal, not a defect', async () => {
  let stub = answering({
    ...fee(),
    ok: false,
    status: 401,
    text: () =>
      Promise.resolve(JSON.stringify({
        error: {
          code: 'unauthorized',
          message: 'sign in at https://yaks.app/login to reach your apps',
        },
      })),
  })
  try {
    let error = await assertRejects(
      () =>
        rpc('expired.token')('tools/call', {
          name: 'app_list',
          arguments: {},
        }),
      CallError,
      'sign in at https://yaks.app/login',
    )
    assertEquals(error.code, 'unauthorized')
  } finally {
    stub.done()
  }
})

Deno.test("an app store's refusal keeps its code, rather than becoming a defect", async () => {
  let stub = answering({
    ...fee(),
    ok: false,
    status: 403,
    text: () =>
      Promise.resolve(JSON.stringify({
        error: {
          code: 'not_a_reader',
          message: "this app is its owner's — they can let you in",
        },
      })),
  })
  try {
    let error = await assertRejects(
      () => storeQuery('someone.token', 'mom/recipe-box', ['.recipe']),
      CallError,
      "this app is its owner's",
    )
    assertEquals(error.code, 'not_a_reader')
  } finally {
    stub.done()
  }
})

Deno.test("a missing app's HTML 404 is a missing refusal, not a defect", async () => {
  let stub = answering({
    ...fee(),
    ok: false,
    status: 404,
    text: () =>
      Promise.resolve(
        '<!doctype html><html><body><h1>Nothing here yet.</h1>' +
          '<p>There are no apps at this address yet.</p></body></html>',
      ),
  })
  try {
    let error = await assertRejects(
      () => storeQuery('someone.token', 'sbx37901/nosuchapp', ['.entity']),
      CallError,
      '404 Nothing here yet. There are no apps at this address yet.',
    )
    assertEquals(error.code, 'missing')
    assertEquals(error.message.includes('<'), false)
  } finally {
    stub.done()
  }
})

// `yak --timing`, this end: the account's calls do not go through the
// connector door, so `sent` says the same line for them (@yaks/api `timed`).
// The stub answers the header a platform answer would carry.
Deno.test('--timing says one line per account call, and none without', async () => {
  let said: string[] = []
  let say = timing.say
  timing.say = (line) => said.push(line)
  let stub = answering({
    ...fee(),
    headers: {
      get: (name: string) =>
        name == 'server-timing' ? 'hops;dur=2, total;dur=31' : null,
    },
  })
  try {
    timing.on = true
    await feeNow('a.token')
    timing.on = false
    await feeNow('a.token')
  } finally {
    timing.say = say
    stub.done()
  }
  assertEquals(said, ['GET /api/fee 200  hops;dur=2, total;dur=31'])
})
