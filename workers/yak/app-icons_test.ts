import { equal, test } from '@yaks/testing'
import { type IconPage, ICONS } from '@yaks/platform/app-icon'
import { connector, fresh, seed } from './probe.ts'

let svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>'
let generated = new Uint8Array([1, 2, 3])
let custom = new Uint8Array([4, 5, 6])

test('releases and the backfill draw missing icons and serve them without replacing custom artwork', async () => {
  let asked: string[] = []
  let k = await fresh({
    OPENAI_OPERATOR_API_KEY: 'probe',
    MODEL_FETCH: async (input, init) => {
      let { instructions, input: words, model } = await new Request(input, init)
        .json()
      if (!instructions?.includes('Draw one app icon')) {
        throw new Error('Unexpected model call in icon test')
      }
      asked.push(JSON.stringify(words))
      let event = {
        type: 'response.completed',
        response: {
          id: 'icon',
          model,
          status: 'completed',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: svg }],
          }],
        },
      }
      return new Response(`data: ${JSON.stringify(event)}\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      })
    },
    RASTER: {
      fetch: async (req: Request) =>
        new Response((await req.text()) == svg ? generated : custom),
    },
  })
  try {
    let space = 'icon-fixture'
    let person = await seed(k, [{
      slug: space,
      apps: ['notes', 'recipes', 'legacy'],
    }])
    let agent = connector(k, person.cookie)
    let release = async (app: string, withIcon = false) => {
      await agent.tool('app_files', {
        app,
        space,
        files: [
          { path: 'index.html', content: '<p>Hello</p>' },
          ...withIcon
            ? [{ path: 'icon.svg', content: svg.replace('circle', 'rect') }]
            : [],
        ],
      })
      await agent.tool('app_deploy', { app, space })
    }
    await release('notes')
    await release('recipes', true)
    await k.dir.stamp({
      entities: [{
        entity: { eid: person.eids[`${space}/legacy`] },
        app: { version: 1 },
      }],
    })
    await k.settled()
    let icon = async (app: string, display = true) => {
      let r = await k.at(
        `${space}.${k.host}`,
        `/${app}/icon.png${display ? '?display' : ''}`,
        {
          headers: { cookie: person.cookie },
        },
      )
      equal(r.status, 200)
      return new Uint8Array(await r.arrayBuffer())
    }
    equal(await icon('notes'), generated)
    equal(await icon('notes', false), generated)
    equal(await icon('recipes'), custom)
    equal(asked.length, 1)

    let inventory = async (method: string): Promise<IconPage> => {
      let r = await k.at(k.host, `${ICONS}?owner_of=${space}`, {
        method,
        headers: { cookie: k.owner.cookie },
      })
      return await r.json()
    }
    equal(
      (await inventory('GET')).apps.map(({ app, icon }) => [app, icon]).sort(),
      [
        ['legacy', 'missing'],
        ['notes', 'generated'],
        ['recipes', 'authored'],
      ],
    )
    equal((await inventory('POST')).queued, 1)
    await k.settled()
    equal(await icon('legacy'), generated)
    equal((await inventory('POST')).queued, 0)
    equal(asked.length, 2)
  } finally {
    await k.stop()
  }
})
