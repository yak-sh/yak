// An app's models, asked through its own store (D-40545): a page writes an
// entry asking for a turn and the answer lands beside it, a typed question is
// answered as an entry of its own, a model calls the commands the app marks
// for it and no others, as the person who asked, a visitor asks only an app
// that opens its models, and the account's budget moves by what a call cost
// until, past it, the transcript rests on the ceiling's sentence. Workers AI
// is a fake binding here; the directory and the stores are the platform's own.

import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import { begin, connect, need } from '@yaks/connections'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import type { Bundle, Comp } from '@yaks/graph'
import { appStore, directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { accounted, BUDGET, countedMedia, monthOf } from './meter.ts'
import { identityEid } from '@yaks/graph'
import {
  mediaReceipts,
  type MediaRecord,
  type Model,
  ModelError,
  weigh,
} from '@yaks/model'
import { records } from '@yaks/secrets'
import { vaultOf } from './vault.ts'
import { KERNEL, meta as appMeta, metaOf } from './meta.ts'
import { receiptPrefix } from './blob-key.ts'
import { type Binding, workersAi } from '@yaks/workers-ai'
import { artifactStore, memoryBlobs, objectBlobs } from '@yaks/blob'
import { assertRejects } from '@std/assert'

import { parseTools } from '@yaks/tools/declared'
import type { VocabDoc } from '@yaks/vocab'
import { embeds, platform } from './testing.ts'
import * as apps from './apps.ts'
import { ctxOf } from './connections.ts'
import { refusal } from './models.ts'
import { as as signedIn, visit } from './serving-probe.ts'
import { cleanup, test, until } from '@yaks/testing'
import { hosting } from './inference.ts'
import {
  type Env as ExecutorEnv,
  run as infer,
  submit,
} from '../model/worker.ts'
import type { Inference } from '@yaks/model'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let BOB = 'b0000000-0000-4000-8000-0000000000b0'
let FLASH = '@cf/zai-org/glm-5.3-flash'
let JEV = 'typesafe/jev'
let SEED = 'bytedance-seed/seed-audio-1-0'

type Asked = {
  model: string
  input: Record<string, unknown>
  options?: Parameters<Binding['run']>[2]
}

// A platform with one space, Ada's, holding one app, and Workers AI answering
// each call with what `answer` says. `access` is the app's; `manifest` is its
// vocab.json, deployed as its owner deploys one.
let vale = async (
  answer: (a: Asked, n: number) => unknown,
  {
    access = 'public',
    manifest = {} as unknown,
    models = 0,
    env = {} as Partial<Env>,
  } = {},
) => {
  let asked: Asked[] = []
  let AI = embeds({
    run: (model: string, input: unknown, options?: Asked['options']) => {
      let a = { model, input: input as Record<string, unknown>, options }
      asked.push(a)
      return Promise.resolve(answer(a, asked.length))
    },
    gateway: () => ({ getUrl: () => Promise.resolve('') }),
  })
  let p = platform(
    'a probe secret',
    {
      AI,
      MODEL_FETCH: () =>
        Promise.resolve(
          new Response(
            'Context Window | 100,000 tokens\nUnit Pricing | $0.15 per M input tokens, $0.5 per M output tokens, $0.03 per M cached input tokens',
          ),
        ),
      ...env,
    } as Partial<Env>,
  )
  let dir = directory({ fetch: (r) => dirPart.fetch(r, p.env) }, true)
  await dir.apply({
    entities: [
      { entity: { eid: ADA }, person: {} },
      {
        entity: { eid: '$space' },
        doc: { title: 'Ada' },
        space: { slug: 'ada', store: 'ada' },
        ...(models ? { meter: { month: monthOf(new Date()), models } } : {}),
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person: ADA, role: 'owner' },
      },
      {
        entity: { eid: '$app' },
        doc: { title: 'Vale' },
        app: { space: '$space', slug: 'vale', store: 'ada/vale', access },
      },
    ],
  }, { 'x-yak-role': 'owner' })
  let app = (await dir.app((await dir.space('ada'))!, 'vale'))!
  let store = p.env.STORE.get(p.env.STORE.idFromName('ada/vale'))
  let as = (person: string | null, via?: string) => ({
    'x-store': 'ada/vale',
    'x-yak-app': app.eid,
    'x-yak-access': access,
    ...(person ? { 'x-yak-person': person, 'x-yak-role': 'owner' } : {}),
    ...(via ? { 'x-yak-via': via } : {}),
  })
  // Sent as `person`, or signed out from the browser `via` names.
  let send = (
    path: string,
    body: unknown,
    person: string | null = ADA,
    via?: string,
  ) =>
    store.fetch(
      new Request(`http://store${path}`, {
        method: 'POST',
        headers: as(person, via),
        body: typeof body == 'string' ? body : JSON.stringify(body),
      }),
    )
  let read = async (q: string): Promise<Bundle[]> =>
    await (await store.fetch(
      new Request(`http://store/query?q=${encodeURIComponent(q)}`, {
        headers: as(ADA),
      }),
    )).json()
  // What a query answers once it answers anything: how a page watching the
  // store sees a reply land.
  let landed = (q: string) =>
    until(async () => {
      let rows = await read(q)
      return rows.length ? rows : null
    }, { label: q })
  // Deployed the way app_deploy deploys: its words, then its commands.
  assertEquals((await send('/vocab', manifest)).status, 200)
  let words = Object.entries((manifest as VocabDoc).$defs ?? {})
    .filter(([, d]) => d.component).map(([name]) => name)
  assertEquals(
    (await send('/tools', parseTools(manifest, words))).status,
    200,
  )
  // `./api/ai/run` at the app's own address, as a page posts it: signed in
  // as `person`, or signed out.
  let run = async (
    body: unknown,
    person: string | null = ADA,
    headers: Record<string, string> = {},
  ) => {
    let res = await apps.fetch(
      visit('/vale/api/ai/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(person ? { cookie: await signedIn(person) } : {}),
          ...headers,
        },
        body: JSON.stringify(body),
      }),
      p.env,
    )
    return { status: res.status, said: await res.json() }
  }
  return {
    asked,
    env: p.env,
    app,
    dir,
    send,
    run,
    read,
    landed,
    spent: async () => (await dir.space('ada'))!,
    settled: p.settled,
    close: p[Symbol.asyncDispose],
  }
}

// Ada's app with OpenRouter connected through its vault, a model allowance
// with 12.5 cents left, a builder's `call` in its store, and the hosted
// executor running each submission in this process: `dispatched` holds what
// it was handed, `workflows` its runs.
let hosted = async () => {
  let dispatched: Inference[] = []
  let workflows: Promise<unknown>[] = []
  let key = 'probe-openrouter-key'
  let vaultKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(4)))
  let v = await vale(() => ({ response: 'workers-only' }), {
    env: { VAULT: d1() as unknown as D1Like, VAULT_KEY: vaultKey },
    models: BUDGET.free - 0.125,
  })
  v.env.MODEL_RECEIPTS = v.env.BLOBS
  let executorEnv: ExecutorEnv = {
    RECEIPTS: v.env.MODEL_RECEIPTS,
    KERNEL: hosting(v.env),
    INFERENCES: {
      create: ({ id, params }) => {
        if (dispatched.some((sent) => sent.call === id)) {
          return Promise.reject(Error('exists'))
        }
        assertEquals(id, params.call)
        dispatched.push(params)
        workflows.push(
          infer(executorEnv, params, { do: (_name, _config, run) => run() }),
        )
        return Promise.resolve()
      },
      get: (id) =>
        Promise.resolve({
          status: () =>
            dispatched.some((sent) => sent.call === id)
              ? Promise.resolve({ status: 'running' })
              : Promise.reject(Error('missing')),
        }),
    },
  }
  v.env.MODEL = {
    version: () => Promise.resolve({ executor: 'yak-model-v1', id: 'live' }),
    submit: (job) => submit(executorEnv, job),
  }
  let c = ctxOf(v.env, { person: ADA, role: 'owner' })
  let space = (await v.dir.space('ada'))!
  let [connection] = await c.graph.apply(
    await need(c.graph.read, {
      owner: space.eid,
      app: v.app.eid,
      integration: 'openrouter',
    }),
  )
  c.fetch = () => Promise.resolve(Response.json({ key }))
  let { attempt } = await begin(c, connection.entity.eid)
  await connect(c, connection.entity.eid, {
    attempt,
    callback: 'https://yaks.app/connections/callback?code=probe',
  })
  let builder = crypto.randomUUID(), build = crypto.randomUUID()
  let call = crypto.randomUUID()
  assertEquals(
    (await v.send('/apply', [
      { entity: { eid: builder }, builder: { query: '' }, staged: {} },
      { entity: { eid: build }, build: { builder } },
      { entity: { eid: call }, call: { source: build } },
    ])).status,
    200,
  )
  // Until neither the stores nor the executor have anything left running, so
  // a read finds an answer instead of polling for it.
  let quiet = async () => {
    for (let runs = -1; runs != workflows.length;) {
      runs = workflows.length
      await Promise.all(workflows)
      await v.settled()
    }
  }
  await quiet()
  return { v, key, space, build, call, dispatched, workflows, quiet }
}

// Built when the file loads, so the case times its asks and not a platform's
// start; the case closes it, paying for what its asks leave running.
let openRouter = await hosted()

test('a connected OpenRouter model puts generated audio in the app store', async () => {
  let { v, key, space, build, call, dispatched, workflows, quiet } = openRouter
  cleanup(v.close)
  let bytes = new Uint8Array([
    0xff,
    0xfb,
    0x90,
    0x64,
    ...new Array(400).fill(0),
  ])
  let calls = 0
  let original = globalThis.fetch
  globalThis.fetch =
    (async (input: string | URL | Request, init?: RequestInit) => {
      let sent = new Request(input, init)
      if (sent.url.includes('/models')) {
        return Response.json({
          data: [{
            id: SEED,
            name: 'Seed',
            architecture: { output_modalities: ['speech'] },
          }],
        })
      }
      calls++
      if (sent.url.includes('/generation?')) {
        assertEquals(sent.headers.get('authorization'), 'Bearer ' + key)
        return Response.json({ data: { total_cost: 0.125 } })
      }
      assertEquals(sent.url, 'https://openrouter.ai/api/v1/audio/speech')
      assertEquals(sent.headers.get('authorization'), 'Bearer ' + key)
      assertEquals((await sent.json()).model, SEED)
      return new Response(bytes, {
        headers: {
          'content-type': 'audio/mpeg',
          'x-generation-id': 'gen-test',
        },
      })
    }) as typeof fetch
  try {
    let session = crypto.randomUUID()
    let request = asking(session, SEED)
    request[0] = { ...request[0], session: { source: call } }
    assertEquals((await v.send('/apply', request)).status, 200)
    await quiet()
    let [attachment] = await v.landed(`.entry.session=${session}&.attachment&*`)
    let eid = (attachment.attachment as Comp).artifact as string
    let [artifact] = await v.read(`.entity.eid=${eid}&.artifact&*`)
    assertEquals((artifact.artifact as Comp).media_type, 'audio/mpeg')
    let alias = await apps.fetch(
      visit(`/vale/api/blob/${eid}`, {
        headers: { cookie: await signedIn(ADA) },
      }),
      v.env,
    )
    assertEquals(alias.status, 302)
    let file = await apps.fetch(
      visit(new URL(alias.headers.get('location')!).pathname, {
        headers: { cookie: await signedIn(ADA) },
      }),
      v.env,
    )
    assertEquals(file.status, 200)
    assertEquals(file.headers.get('content-type'), 'audio/mpeg')
    assertEquals(new Uint8Array(await file.arrayBuffer()), bytes)
    assertEquals(calls, 2)
    assertEquals(dispatched.length, 1)
    await Promise.all(workflows)
    let job = dispatched[0]
    let host = hosting(v.env)
    assertEquals(await host.submitted(job), true)
    assertEquals(await host.claim(job), { claimed: false })
    await host.delivered(job)
    await host.delivered(job)
    assertEquals(
      (await v.send('/query?trusted=1&q=.inference', {})).status,
      400,
    )
    assert(
      !JSON.stringify(await v.read(`.entity.eid=${job.call}&*`)).includes(
        'inference/',
      ),
    )
    await assertRejects(() =>
      host.grants({ ...job, request: job.request + '-forged' })
    )
    await assertRejects(() => host.checkpoint(job, { submitted: { at: null } }))
    let frozen = await v.env.MODEL_RECEIPTS!.get(job.request)
    let privateRequest = JSON.parse(
      new TextDecoder().decode(await frozen!.arrayBuffer()),
    )
    assertEquals(privateRequest.request.call, job.call)
    assertEquals(privateRequest.app, v.app.eid)
    assert(!JSON.stringify(privateRequest).includes(key))
    // A text receipt has no media checkpoint, and an unknown price remains
    // unknown while the answer is still made available to its original ask.
    let store = metaOf(appStore(v.env.STORE, space, v.app, v.env), KERNEL)
    let reports: Bundle[][] = []
    v.env.ERRORS = {
      send: (rows) => {
        reports.push(rows)
        return Promise.resolve()
      },
    }
    // An ask of its own that the executor finished with `reply`: its frozen
    // request copied from the first, its receipt, and its rows to write.
    let receipted = async (reply: Comp, more: Comp = {}) => {
      let call = crypto.randomUUID(), session = crypto.randomUUID()
      let next = {
        ...job,
        call,
        request: `inference/${job.executor}/${call}/request`,
        receipt: `inference/${job.executor}/${call}/receipt`,
      }
      await v.env.MODEL_RECEIPTS!.put(
        next.request,
        JSON.stringify({
          ...privateRequest,
          call,
          request: { ...privateRequest.request, call },
        }),
      )
      await v.env.MODEL_RECEIPTS!.put(
        next.receipt,
        JSON.stringify({ call, reply: { model: SEED, ...reply } }),
      )
      return {
        job: next,
        rows: [
          { entity: { eid: session }, session: {} },
          {
            ...more,
            entity: { eid: call },
            entry: { session },
            ask: { to: identityEid('model', [SEED]) },
            inference: { executor: next.executor, request: next.request },
          },
        ],
      }
    }
    let texts = await Promise.all([0, undefined].map(async (cost) => ({
      cost,
      ...await receipted({
        id: 'text',
        items: [{ kind: 'assistant', text: 'saved answer' }],
        cost,
      }),
    })))
    await store.apply(texts.flatMap((text) => text.rows))
    for (let { cost, job: next } of texts) {
      await host.delivered(next)
      await host.delivered(next)
      let [ask] = await store.query(`.entity.eid=${next.call}&*`, {
        trusted: true,
      })
      assertEquals((ask.inference as Comp).receipt, next.receipt)
      assertEquals(
        ask.cost,
        cost === undefined ? undefined : { dollars: 0, reported: true },
      )
    }
    assertEquals(reports.length, 2)
    assertEquals(reports[0][0].entity.eid, reports[1][0].entity.eid)
    assertEquals((await v.spent()).meter!.models, BUDGET.free)
    let [cost] = await v.read(`.entry.session=${session}&.cost&*`)
    assertEquals(cost.cost, { dollars: 0.125, reported: true })
    let [built] = await v.read(`.entity.eid=${build}&.build&*`)
    assertEquals((built.build as Comp).cost, 0.125)
    let blocked = crypto.randomUUID()
    await v.send('/apply', asking(blocked, SEED))
    await quiet()
    let [error] = await v.landed(`.entry.session=${blocked}&.refusal&*`)
    assertEquals((error.refusal as Comp).code, 'limit')
    assertEquals(calls, 2)
    assertEquals(v.asked.length, 0)
    assertEquals((await v.spent()).meter!.models, BUDGET.free)
    assert(
      !JSON.stringify(await v.read(`.entry.session=${session}&*`))
        .includes(key),
    )
    // A paid receipt still owes the account even after the app is trashed.
    let { job: dormant, rows } = await receipted(
      { id: 'paid', items: [], cost: 0.02 },
      { submitted: { at: new Date().toISOString() } },
    )
    await store.apply(rows)
    await appMeta(v.env).apply([{
      entity: { eid: v.app.eid },
      trashed: { at: new Date().toISOString(), by: ADA },
    }], KERNEL)
    await until(async () => (await v.send('/query?q=.ask', {})).status === 404)
    for (let i = 0; i < 2; i++) {
      await assertRejects(() => host.delivered(dormant))
    }
    assertAlmostEquals((await v.spent()).meter!.models, BUDGET.free + 0.02)
    await host.report(dormant, {
      code: 'inference_delivery',
      reason: 'Awaiting restore',
      interrupted: false,
    })
    await assertRejects(() => host.grants(job))
    assertEquals(calls, 2)
  } finally {
    globalThis.fetch = original
  }
})

test('an app without the OpenRouter connection cannot ask its model', async () => {
  let v = await vale(() => ({ response: 'workers-only' }))
  let session = crypto.randomUUID()
  assertEquals((await v.send('/apply', asking(session, SEED))).status, 200)
  let [failed] = await v.landed(`.entry.session=${session}&.refusal&*`)
  assertEquals((failed.refusal as Comp).code, 'connection')
  assertEquals(v.asked.length, 0)
})

test('one app-store write completes seven model turns within its dispatch bound', async () => {
  let releases: (() => void)[] = []
  let active = 0, peak = 0
  let v = await vale(() => {
    active++
    peak = Math.max(peak, active)
    return new Promise((resolve) =>
      releases.push(() => {
        active--
        resolve({ response: 'answered' })
      })
    )
  })
  let sessions = Array.from({ length: 7 }, () => crypto.randomUUID())
  assertEquals(
    (await v.send('/apply', sessions.flatMap((s) => asking(s, FLASH)))).status,
    200,
  )
  for (let i = 0; i < sessions.length; i++) {
    await until(() => releases.length > i, { label: `model call ${i + 1}` })
    releases[i]()
  }
  await until(
    async () => (await v.read('.entry&.output&*')).length == sessions.length,
    { label: 'seven model answers' },
  )
  assertEquals(peak, 2)
  assertEquals(releases.length, sessions.length)
})

// A transcript and the entry that asks it for a turn, as a page writes them.
let asking = (
  session: string,
  model: string,
  more: Record<string, unknown> = {},
): Bundle[] => [
  { entity: { eid: session }, session: {} },
  {
    ...more,
    entity: { eid: crypto.randomUUID() },
    entry: { session },
    content: { body: 'a stranger comes to the forge' },
    using: {
      model,
      provider: identityEid('provider', [
        model.startsWith('@cf/') || model == JEV ? 'workers-ai' : 'openrouter',
      ]),
    },
  },
]

// A plain line in a transcript, which asks for a turn where `using` is in force.
let line = (session: string): Bundle[] => [{
  entity: { eid: crypto.randomUUID() },
  entry: { session },
  content: { body: 'and another thing' },
}]

let said = (b: Bundle) => (b.content as Comp | undefined)?.body

test('a page asks its store for a turn and the answer lands beside it', async () => {
  let v = await vale(() => ({
    response: 'Welcome, traveller.',
    usage: {
      prompt_tokens: 1_000,
      completion_tokens: 100,
      input_tokens_details: { cached_tokens: 800 },
    },
  }))
  let s = crypto.randomUUID()
  assertEquals((await v.send('/apply', asking(s, FLASH))).status, 200)
  let [reply] = await v.landed(`.entry.session=${s}&.output&*`)
  assertEquals(said(reply), 'Welcome, traveller.')
  assertEquals(v.asked[0].options, {
    extraHeaders: { 'x-session-affinity': s },
  })
  let [counted] = await v.read(`.entry.session=${s}&.usage&*`)
  assertEquals((counted.usage as Comp).cached_tokens, 800)
  assertEquals(v.asked.map((a) => a.model), [FLASH])
  // The space paid for it, at the model's price.
  let cost = weigh({ input: 0.15, cached: 0.03, output: 0.5 }, {
    input_tokens: 1_000,
    output_tokens: 100,
    cached_tokens: 800,
  })
  await until(async () => (await v.spent()).meter?.models)
  assertAlmostEquals((await v.spent()).meter!.models, cost)
  // And the transcript records it, on the ask and summed on the session.
  let [ask] = await v.landed(`.entry.session=${s}&.cost&*`)
  assertEquals((ask.cost as Comp).reported, false)
  assertAlmostEquals(Number((ask.cost as Comp).dollars), cost)
  let [session] = await v.landed(`.entity.eid=${s}&?session.cost&*`)
  assertAlmostEquals(Number((session.session as Comp).cost), cost)
})

test('a typed question comes back as an answer entry', async () => {
  let plan = {
    type: 'choice',
    choice: 'forge',
    confidence: 0.82,
    probabilities: { forge: 0.82, well: 0.18 },
  }
  let v = await vale(() => ({
    model: 'jev',
    answers: { plan },
    usage: { input_tokens: 380, output_tokens: 45 },
  }))
  let s = crypto.randomUUID()
  let questions = {
    asked: {
      plan: {
        type: 'choice',
        instructions: 'Where does the smith go next?',
        criteria: { forge: 'to work', well: 'to rest' },
      },
    },
  }
  await v.send('/apply', asking(s, JEV, { questions }))
  let [answer] = await v.landed('.answer.question=plan&*')
  let { choice, confidence, probabilities } = answer.answer as Comp
  assertEquals([choice, confidence, probabilities], [
    plan.choice,
    plan.confidence,
    plan.probabilities,
  ])
  assertEquals((answer.entry as Comp).session, s)
  assertEquals(v.asked[0].input.questions, questions.asked)
})

test('a model calls only the commands marked for it, as the person who asked', async () => {
  let manifest = {
    $defs: {
      mood: {
        component: true,
        type: 'object',
        properties: { feeling: { type: 'string' }, of: { type: 'string' } },
      },
      set_mood: {
        tool: true,
        model: true,
        description: 'Say how the smith feels',
        input: { feeling: { type: 'string' } },
        apply: {
          entity: { eid: '$m' },
          mood: { feeling: '$feeling', of: '$session' },
        },
      },
      moods: {
        tool: true,
        description: 'Every mood so far',
        query: '.mood',
      },
    },
  }
  let v = await vale((_, n) =>
    n == 1
      ? {
        response: '',
        tool_calls: [{ name: 'set_mood', arguments: { feeling: 'glad' } }],
      }
      : { response: 'The smith is glad.' }, { manifest })
  let s = crypto.randomUUID()
  await v.send('/apply', asking(s, FLASH))
  await until(
    async () =>
      (await v.read(`.entry.session=${s}&.output&*`)).some((b) =>
        said(b) == 'The smith is glad.'
      ),
    { label: 'the answer after the tool' },
  )
  let offered = v.asked[0].input.tools as { function: { name: string } }[]
  assertEquals(offered.map((t) => t.function.name), ['set_mood'])
  let [mood] = await v.read('.mood&*')
  // `$session` is the transcript whose turn made the call.
  assertEquals(mood.mood, { feeling: 'glad', of: s })
  assertEquals((mood.created as Comp).by, ADA)
  // And what it wrote came through that transcript, which no page can say.
  assertEquals((mood.created as Comp).via, s)
})

test('a visitor asks an app for a turn only where it opens its models', async () => {
  let answer = () => ({ response: 'hello' })
  let shut = await vale(answer, { access: 'open' })
  let refused = await shut.send(
    '/apply',
    asking(crypto.randomUUID(), FLASH),
    null,
  )
  assertEquals(refused.status, 403)
  assertEquals(shut.asked.length, 0)
  // Nor by a plain line in a member's transcript, whose `using` is in force.
  let ada = crypto.randomUUID()
  await shut.send('/apply', asking(ada, FLASH))
  await shut.landed(`.entry.session=${ada}&.output&*`)
  assertEquals((await shut.send('/apply', line(ada), null)).status, 403)

  let open = await vale(answer, {
    access: 'open',
    manifest: { models: 'open' },
  })
  let s = crypto.randomUUID(), guest = crypto.randomUUID()
  let sent = (b: Bundle[]) => open.send('/apply', b, null, guest)
  assertEquals((await sent(asking(s, FLASH))).status, 200)
  await until(async () =>
    (await open.read(`.entry.session=${s}&.output&*`)).some(said)
  )
  assertEquals((await sent(line(s))).status, 200)
  // Opened models are a visitor's to ask in their own transcript only.
  await open.send('/apply', asking(ada, FLASH))
  assertEquals((await sent(line(ada))).status, 403)
})

test('an account past its budget is told so, and the transcript rests', async () => {
  let v = await vale(() => ({ response: 'never' }), { models: BUDGET.free })
  let s = crypto.randomUUID()
  await v.send('/apply', asking(s, FLASH))
  let [stopped] = await v.landed(`.entry.session=${s}&.refusal&*`)
  assertEquals((stopped.refusal as Comp).code, 'limit')
  assert(String(said(stopped)).includes('account budget of $0.20'))
  assertEquals(v.asked.length, 0)
  let [session] = await v.read(`.entity.eid=${s}&*`)
  assertEquals((session.session as Comp).status, 'failed')
  // And a call asked outright is answered with the same sentence.
  let { status, said: no } = await v.run({ model: FLASH, input: {} })
  assertEquals(status, 429)
  assert(no.error.message.includes('account budget of $0.20'))
  assertEquals(v.asked.length, 0)
})

test('./api/ai/run answers what the model said, and the space pays for it', async () => {
  let usage = { prompt_tokens: 2_000, completion_tokens: 50 }
  let v = await vale(() => ({ response: 'Welcome.', usage }))
  let input = { messages: [{ role: 'user', content: 'hello' }] }
  assertEquals(await v.run({ model: FLASH, input }), {
    status: 200,
    said: { response: 'Welcome.', usage },
  })
  assertEquals(v.asked, [{ model: FLASH, input, options: undefined }])
  let cost = weigh({ input: 0.15, cached: 0.03, output: 0.5 }, {
    input_tokens: 2_000,
    output_tokens: 50,
  })
  assertAlmostEquals((await v.spent()).meter!.models, cost)
  // A release not previously requested goes straight to its provider.
  assertEquals(
    (await v.run({ model: '@cf/example/new-release', input })).status,
    200,
  )
  assertEquals(v.asked.length, 2)
})

test('./api/ai/run answers an input the model refuses as the caller’s, 400', () => {
  let schema = "5006: Error: oneOf at '/' not met, 0 matches"
  let [status, code, message] = refusal(new Error(schema), FLASH)!
  assertEquals([status, code], [400, 'bad_request'])
  assert(message.includes(schema))
  assertEquals(refusal(new Error('upstream down'), FLASH), null)
})

test('./api/ai/run answers a visitor only where the app opens its models', async () => {
  let body = { model: JEV, input: { prompt: 'hi' } }
  let answer = () => ({ response: 'hello' })
  let shut = await vale(answer, { access: 'open' })
  assertEquals((await shut.run(body, null)).status, 401)
  assertEquals((await shut.run(body, BOB)).status, 403)
  assertEquals(shut.asked.length, 0)
  let open = await vale(answer, {
    access: 'open',
    manifest: { models: 'open' },
  })
  assertEquals((await open.run(body, null)).status, 200)
  assertEquals((await open.run(body, BOB)).status, 200)
  // Opening the models opens them to whoever may write, and no further.
  let read = await vale(answer, {
    access: 'public',
    manifest: { models: 'open' },
  })
  assertEquals((await read.run(body, BOB)).status, 403)
})

test('./api/ai/run carries affinity through its metered binding', async () => {
  let p = await vale(() => ({
    response: 'ok',
    usage: {
      input_tokens: 1000,
      output_tokens: 10,
      input_tokens_details: { cached_tokens: 900 },
    },
  }))
  await p.run({ model: FLASH, input: {}, session_id: 'chat-body' })
  assertEquals(p.asked.at(-1)?.options, {
    extraHeaders: { 'x-session-affinity': 'chat-body' },
  })
  await p.run({ model: FLASH, input: {}, session_id: 'chat-body' }, ADA, {
    'x-session-affinity': 'chat-header',
  })
  assertEquals(p.asked.at(-1)?.options, {
    extraHeaders: { 'x-session-affinity': 'chat-header' },
  })
  await p.run({ model: FLASH, input: {} })
  assertEquals(p.asked.at(-1)?.options, undefined)
  let cost = weigh({ input: 0.15, cached: 0.03, output: 0.5 }, {
    input_tokens: 3000,
    output_tokens: 30,
    cached_tokens: 2700,
  })
  assertAlmostEquals((await p.spent()).meter!.models, cost)
})

test('raw Workers AI audio debits its tariff once and refuses at the account limit', async () => {
  let v = await vale(() => ({ audio: 'https://media.example/song.mp3' }), {
    models: BUDGET.free - 0.15,
  })
  let raw = workersAi(v.env.AI!, {
    media: { store: artifactStore(memoryBlobs()) },
    fetch: () =>
      Promise.resolve(
        new Response(
          new Uint8Array([
            0xff,
            0xfb,
            0x90,
            0x64,
            ...new Array(413).fill(0),
          ]),
        ),
      ),
  })
  let model = accounted(v.env, (dir) => dir.space('ada'), raw)
  let req = {
    model: 'minimax/music-2.6',
    input: { is_instrumental: true },
    items: [{ kind: 'user' as const, text: 'A quiet tune' }],
    tools: [],
  }
  let reply = await model(req)
  assertEquals(reply.cost, 0.15)
  assertEquals(reply.costReported, false)
  assertEquals(reply.artifacts?.[0].media_type, 'audio/mpeg')
  assertAlmostEquals((await v.spent()).meter!.models, BUDGET.free)
  await assertRejects(() => model(req), ModelError)
  assertEquals(v.asked.length, 1)
})

test('accounting preserves provider continuation metadata and passes requests whole', async () => {
  let v = await vale(() => ({}))
  let raw: Model = Object.assign((req: Parameters<Model>[0]) => {
    assertEquals(req.anchor, 'prior')
    req.onText?.({ index: 0, text: 'hello' })
    return Promise.resolve({
      id: 'reply',
      model: req.model,
      items: [],
      cost: 0,
    })
  }, {
    mark: () => ({ openrouter: { response_id: 'reply' } }),
    anchor: () => 'prior',
    vocab: { $defs: {} },
  })
  let model = accounted(v.env, (dir) => dir.space('ada'), raw)
  assertEquals(model.mark, raw.mark)
  assertEquals(model.anchor, raw.anchor)
  assertEquals(model.vocab, raw.vocab)
  let text = ''
  await model({
    model: 'fixture',
    items: [],
    tools: [],
    anchor: 'prior',
    onText: (delta) => text += delta.text,
  })
  assertEquals(text, 'hello')
})

test('raw partner calls carry configured gateway and affinity through the meter', async () => {
  let p = await vale(() => ({
    response: 'ok',
    usage: { prompt_tokens: 10, completion_tokens: 1 },
  }), { env: { AI_GATEWAY: 'music' } })
  await p.run({ model: 'typesafe/jev', input: {}, session_id: 'pilot' })
  assertEquals(p.asked.at(-1)?.options, {
    gateway: { id: 'music' },
    extraHeaders: { 'x-session-affinity': 'pilot' },
  })
})

// Recovery accounts an already generated recording, including one attached
// locally after a download failure. It never asks a provider to generate.
test('original media debit is atomic once across concurrent and repeated recovery', async () => {
  let v = await vale(() => {
    throw new Error('No paid calls')
  })
  let space = (await v.dir.space('ada'))!
  let call = crypto.randomUUID()
  await Promise.all(
    [1, 2, 3].map(() =>
      countedMedia({ STORE: v.env.STORE }, space, call, 0.45, true)
    ),
  )
  await countedMedia({ STORE: v.env.STORE }, space, call, 0.45, true)
  assertAlmostEquals((await v.spent()).meter!.models, 0.45)
  assertEquals(v.asked, [])
})

test('recovery door accounts an existing attachment without download or generation', async () => {
  let v = await vale(() => {
    throw new Error('No generation')
  }, {
    env: {
      VAULT: d1() as unknown as D1Like,
      VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(4))),
    },
  })
  let session = crypto.randomUUID(), call = crypto.randomUUID()
  let artifact = crypto.randomUUID()
  assertEquals(
    (await v.send('/apply', [
      { entity: { eid: session }, session: {} },
      {
        entity: { eid: call },
        entry: { session, seq: 1 },
        ask: {},
        cost: { dollars: 0.45, reported: true },
        attempt: { state: 'completed' },
      },
      {
        entity: { eid: artifact },
        artifact: {
          address: 'fixture-artifact',
          media_type: 'audio/mpeg',
          size: 576,
        },
      },
      {
        entity: { eid: crypto.randomUUID() },
        entry: { session, seq: 2 },
        attachment: { artifact },
        output: { source: call },
        content: { body: 'Fixture already recovered' },
      },
    ])).status,
    200,
  )
  let post = (person: string | null = ADA) =>
    apps.fetch(
      visit('/vale/api/ai/recover', {
        method: 'POST',
        headers: person ? { cookie: '' } : {},
        body: JSON.stringify({ call }),
      }),
      v.env,
    )
  // Anonymous callers cannot debit or recover another account's recordings.
  assertEquals((await post(null)).status, 401)
  let recover = async () =>
    apps.fetch(
      visit('/vale/api/ai/recover', {
        method: 'POST',
        headers: { cookie: await signedIn(ADA) },
        body: JSON.stringify({ call }),
      }),
      v.env,
    )
  assertEquals((await recover()).status, 200)
  assertEquals((await recover()).status, 200)
  assertAlmostEquals((await v.spent()).meter!.models, 0.45)
  assertEquals(v.asked, [])
  // A receipt without delivered artifacts must use the adapter that recorded it.
  let original = crypto.randomUUID()
  let space = (await v.dir.space('ada'))!
  let app = (await v.dir.app(space, 'vale'))!
  let store = mediaReceipts(
    records<MediaRecord>(
      {
        apply: (bundles) =>
          appMeta({ STORE: v.env.STORE }).apply(bundles, KERNEL),
      },
      vaultOf(v.env),
      'generated-media:' + app.eid + ':',
    ),
    objectBlobs(v.env.BLOBS, receiptPrefix(app)),
  )
  let bytes = new Uint8Array(576)
  bytes.set([255, 251, 180, 0])
  await store.save({
    call: original,
    id: 'or-generation',
    provider: 'openrouter',
    model: 'speech',
    input: {},
    cost: 0.04,
    response: {
      kind: 'speech',
      reply: { id: 'or-generation', model: 'speech', items: [] },
      audio: btoa(String.fromCharCode(...bytes)),
      mediaType: 'audio/mpeg',
      images: [],
      lookupCost: false,
    },
  })
  assertEquals(
    (await v.send('/apply', [{
      entity: { eid: original },
      entry: { session, seq: 3 },
      ask: {},
    }])).status,
    200,
  )
  call = original
  assertEquals((await recover()).status, 200)
  assertEquals(
    (await v.read(`.output.source=${original}&.attachment`)).length,
    1,
  )
  assertAlmostEquals((await v.spent()).meter!.models, 0.49)
  assertEquals(v.asked, [])
})

test('accounted recovery preserves cost and never debits a second time', async () => {
  let v = await vale(() => {
    throw new Error('No generation')
  })
  let call = crypto.randomUUID()
  let raw: Model = Object.assign(
    () => Promise.reject(new Error('No generation')),
    {
      recover: () =>
        Promise.resolve({
          id: 'same',
          model: 'fixture',
          items: [],
          cost: 0.45,
          costReported: true,
        }),
    },
  )
  let model = accounted(v.env, (dir) => dir.space('ada'), raw)
  assertEquals((await model.recover!(call)).cost, 0.45)
  await model.recover!(call)
  assertAlmostEquals((await v.spent()).meter!.models, 0.45)
  assertEquals(v.asked, [])
})
