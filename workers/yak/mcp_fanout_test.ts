// Discovery is release metadata, never a reason to fetch an app Store.
import { equal, ok, test } from '@yaks/testing'
import {
  commandsOf,
  connector,
  fresh,
  signIn,
  txt,
  vocabFile,
} from './probe.ts'
import { type Namespace, PLATFORM_STORE } from './door.ts'

let watched = async () => {
  let fetched: { store: string; path: string }[] = []
  let k = await fresh({}, (env) => {
    let real = env.STORE
    env.STORE = {
      idFromName: (name) => name,
      get: (name) => ({
        fetch: (req) => {
          if (String(name) != PLATFORM_STORE) {
            fetched.push({
              store: String(name),
              path: new URL(req.url).pathname,
            })
          }
          return real.get(real.idFromName(String(name))).fetch(req)
        },
      }),
    } satisfies Namespace
  })
  return { k, fetched }
}

test('MCP discovery fetches zero app Stores and a named write fetches only its app', async () => {
  let { k, fetched } = await watched()
  try {
    let person = await signIn(k)
    let agent = connector(k, person.cookie)
    let space = ''
    for (let app of ['recipes', 'chores', 'garden']) {
      let made = await agent.tool('app_new', { slug: app, title: app })
      space ||= /https:\/\/([a-z0-9-]+)\.yaks\.app/.exec(made)![1]
      await agent.tool('app_files', {
        space,
        app,
        files: [{
          path: 'vocab.json',
          content: vocabFile({ [app]: { name: txt } }),
        }],
      })
      await agent.tool('app_deploy', { space, app })
    }
    // A deploy's commit is minted after it answers; what is counted below is
    // discovery alone.
    await k.settled!()
    for (let method of ['tools/list', 'initialize', 'tools/list']) {
      fetched.length = 0
      await agent.call(
        method,
        method == 'initialize'
          ? {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'fanout', version: '1' },
          }
          : {},
      )
      equal(fetched, [], `${method} must not fetch app Stores`)
    }
    fetched.length = 0
    let commands = await commandsOf(agent)
    ok(commands.some((c) => c.name == 'add_recipes'))
    equal(fetched, [], 'commands must not fetch app Stores')
    // Redeployment must replace discovery, not an isolate cache, and an
    // undeployed draft must leave discovery unchanged.
    await agent.tool('app_files', {
      space,
      app: 'recipes',
      files: [
        {
          path: 'vocab.json',
          content: vocabFile({ recipes: { name: txt, ingredient: txt } }),
        },
      ],
    })
    let before = await commandsOf(agent, { space, app: 'recipes' })
    ok(!JSON.stringify(before).includes('ingredient'))
    await agent.tool('app_deploy', { space, app: 'recipes' })
    await k.settled!()
    fetched.length = 0
    let after = await commandsOf(agent, { space, app: 'recipes' })
    ok(JSON.stringify(after).includes('ingredient'))
    equal(fetched, [])
    fetched.length = 0
    await agent.tool('graph_apply', {
      space,
      app: 'recipes',
      bundles: [{
        entity: { eid: crypto.randomUUID() },
        recipes: { name: 'Soup' },
      }],
    })
    ok(fetched.length > 0)
    ok(
      fetched.every(({ store }) => store.startsWith(`${space}/recipes.`)),
      JSON.stringify(fetched),
    )
  } finally {
    await k.stop()
  }
})
