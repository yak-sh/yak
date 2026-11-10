// An app and its platform in memory, with injected model provider responses.
import type { Bundle } from '@yaks/graph'
import type { Binding } from '@yaks/workers-ai'
import { parseTools } from '@yaks/tools/declared'
import type { VocabDoc } from '@yaks/vocab'
import { assertEquals } from '@std/assert'
import { until } from '@yaks/testing'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { monthOf } from './meter.ts'
import { embeds, platform } from './testing.ts'
import * as apps from './apps.ts'
import { as as signedIn, visit } from './serving-probe.ts'
let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let MONTH = 0.2

export type Asked = {
  model: string
  input: Record<string, unknown>
  options?: Parameters<Binding['run']>[2]
}

// A platform with one space, Ada's, holding one app, and Workers AI answering
// each call with what `answer` says. `access` is the app's; `manifest` is its
// vocab.json, deployed as its owner deploys one.
export let vale = async (
  answer: (a: Asked, n: number) => unknown,
  {
    access = 'public',
    manifest = {} as unknown,
    models = 0,
    env = {} as Partial<Env>,
    deploy = true,
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
      MODEL_FETCH: (url) =>
        Promise.resolve(
          new Response(
            String(url).includes('qwen3-embedding')
              ? 'Text Embeddings • Qwen\nContext Window | 8,192 tokens\nUnit Pricing | $0 per M input tokens'
              : 'Context Window | 100,000 tokens\nUnit Pricing | $0.15 per M input tokens, $0.5 per M output tokens, $0.03 per M cached input tokens',
          ),
        ),
      ...env,
    } as Partial<Env>,
  )
  let dir = directory({ fetch: (r) => dirPart.fetch(r, p.env) })
  await dir.stamp({
    entities: [
      { entity: { eid: ADA }, person: {} },
      {
        entity: { eid: '$space' },
        doc: { title: 'Ada' },
        space: { slug: 'ada', store: 'ada' },
        budget: { dollars: MONTH },
        starter: { dollars: 0 },
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
    'x-yak-policy': String(app.policy),
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
  let words = Object.entries((manifest as VocabDoc).$defs ?? {})
    .filter(([, d]) => d.component).map(([name]) => name)
  let deployed = async () => {
    assertEquals((await send('/vocab', manifest)).status, 200)
    assertEquals(
      (await send('/tools', parseTools(manifest, words))).status,
      200,
    )
    await p.settled()
  }
  if (deploy) await deployed()
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
    deployed,
    spent: async () => (await dir.space('ada'))!,
    settled: p.settled,
    close: p[Symbol.asyncDispose],
  }
}
