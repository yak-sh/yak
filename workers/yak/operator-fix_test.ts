// An app's break starts its space's Operator on fixing it (T-136297): a page
// writing a component its vocab.json never declared is one break, however
// often it happens, and one Operator run declares it, deploys, and says so
// beside the break on the dashboard.
import { test, until } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { connector, fresh, meta, seed, unique } from './probe.ts'
import { ai, type Turn } from './testing.ts'
import type { Env } from './env.ts'

let vocab = (defs: Record<string, unknown>) => JSON.stringify({ $defs: defs })
let recipe = { recipe: { properties: { serves: { type: 'number' } } } }
let share = { asm_share: { properties: { code: { type: 'string' } } } }

test('a break starts one Operator run that fixes the app', async () => {
  let script: Turn[] = [
    {
      calls: [{
        name: 'app_files',
        arguments: {
          app: 'msp',
          files: [{
            path: 'vocab.json',
            content: vocab({ ...recipe, ...share }),
          }],
        },
      }],
    },
    { calls: [{ name: 'app_deploy', arguments: { app: 'msp' } }] },
    { text: 'Declared asm_share in vocab.json and deployed.' },
  ]
  let model = ai(script)
  // A builder that, while `away`, cannot take a request: a break that
  // happens then reaches the Operator when its owner next opens the
  // dashboard.
  let away = false
  let k = await fresh({ AI: model as Env['AI'] }, (env) => {
    let builders = env.BUILDER
    env.BUILDER = {
      ...builders,
      get: (id: Parameters<Env['BUILDER']['get']>[0]) => {
        let one = builders.get(id)
        return {
          ...one,
          fetch: (r: Request) =>
            away && new URL(r.url).pathname == '/operator/receive'
              ? Promise.resolve(new Response(null, { status: 409 }))
              : one.fetch(r),
        }
      },
    } as Env['BUILDER']
  })
  try {
    let slug = unique('fixme')
    let { cookie, eids } = await seed(k, [{ slug, apps: ['msp'] }])
    let agent = connector(k, cookie)
    let app = { space: slug, app: 'msp' }
    await agent.tool('app_files', {
      ...app,
      files: [
        { path: 'index.html', content: '<h1>MSP430</h1>' },
        { path: 'vocab.json', content: vocab(recipe) },
      ],
    })
    await agent.tool('app_deploy', app)

    let write = () =>
      k.at(`${slug}.yaks.app`, '/msp/api/apply', {
        method: 'POST',
        headers: {
          cookie,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        body: JSON.stringify([{
          entity: { eid: crypto.randomUUID() },
          asm_share: { code: 'mov #1, r4' },
        }]),
      })
    // The page breaks twice: one break, one run.
    let refused = await Promise.all([write(), write()])
    for (let r of refused) {
      assertEquals(r.status, 400)
      assertStringIncludes(await r.text(), 'asm_share')
    }

    // The dashboard says what the Operator did, beside the break, once it
    // has done it.
    // The dashboard's row for the break that says this.
    let row = async (said: string) => {
      let page = await (await k.at('yaks.app', `/manage?space=${slug}`, {
        headers: { cookie },
      })).text()
      let at = page.indexOf(said)
      return at < 0
        ? ''
        : page.slice(page.lastIndexOf('<li', at), page.indexOf('</li>', at))
    }
    // Until the Operator answered beside it, or said why it could not.
    let answered = (said: string) =>
      until(async () => {
        await k.settled()
        let shown = await row(said)
        return /The Operator(:| could not)/.test(shown) ? shown : null
      }, { timeout: 10_000 })
    let said = await answered('unknown component: asm_share')
    assertStringIncludes(
      said,
      'The Operator: Declared asm_share in vocab.json and deployed.',
    )
    assertEquals(model.asked.length, script.length, 'one run, three turns')
    let tasks = JSON.parse(
      String((await agent.answer('operator_read', { space: slug })).text),
    ).tasks
    assertEquals(tasks.length, 1)

    // The app keeps what it was refused before.
    assertEquals((await write()).status, 200)

    // A break the Operator was never told of is started as the dashboard
    // shows it, once.
    away = true
    let missing = await k.at(`${slug}.yaks.app`, '/msp/api/query?.nothing', {
      headers: { cookie, 'sec-fetch-site': 'same-origin' },
    })
    assertEquals(missing.status, 400)
    await missing.body?.cancel()
    // Filed after the answer: the builder is back only once it was turned
    // away.
    await k.settled()
    away = false
    let unheard = () => row('unknown prop: .nothing')
    assertStringIncludes(
      await unheard(),
      'The Operator is fixing it.',
      JSON.stringify(k.reported.filter((r) => r.exception).slice(-3)),
    )
    await answered('unknown prop: .nothing')
    assertEquals(
      JSON.parse(
        String((await agent.answer('operator_read', { space: slug })).text),
      ).tasks.length,
      2,
    )
    let files = await agent.tool('app_files', {
      ...app,
      op: 'read',
      path: 'vocab.json',
    })
    assertStringIncludes(files, 'asm_share')

    // A space that spent its month's model budget: the Operator still takes
    // the break, and says beside it why it stopped.
    await meta(k).apply([{
      entity: { eid: eids[slug] },
      meter: { month: new Date().toISOString().slice(0, 7), models: 1000 },
    }])
    let broke = await k.at(`${slug}.yaks.app`, '/msp/api/query?.spent', {
      headers: { cookie, 'sec-fetch-site': 'same-origin' },
    })
    await broke.body?.cancel()
    let spent = await answered('unknown prop: .spent')
    assertStringIncludes(spent, 'for models and voice this month is spent')
  } finally {
    await k.stop()
  }
})
