// Discovery is release metadata, never a reason to fetch an app Store.
import { r2RawObjects } from './lib/objects.ts'
import type { Env } from './env.ts'
import { commandsOf } from './probe.ts'
import { equal, ok, test } from '@yaks/testing'
import { connector, fresh, signIn, txt, vocabFile } from './probe.ts'
import { type Namespace, PLATFORM_STORE } from './door.ts'

let watched = async () => {
  let fetched: { store: string; path: string }[] = []
  let bindings: Env
  let k = await fresh({}, (env) => {
    bindings = env
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
  return { k, fetched, blobs: r2RawObjects(bindings!.BLOBS) }
}

test('MCP discovery fetches zero app Stores and a named write fetches only its app', async () => {
  let { k, fetched, blobs } = await watched()
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
    // A platform upgrade sees existing releases without snapshots. Discovery
    // must still find their words/commands without asking a Store to backfill.
    for (let key of await blobs.list(`${space}/.declarations/`)) {
      await blobs.delete(key)
    }
    fetched.length = 0
    await agent.call('tools/list')
    let commands = await commandsOf(agent)
    ok(commands.some((c) => c.name == 'add_recipes'))
    equal(fetched, [], 'existing releases must not fetch app Stores')
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

test('MCP discovers accepted retypes and retained words from legacy releases without waking Stores', async () => {
  let { k, fetched, blobs } = await watched()
  try {
    let person = await signIn(k)
    let agent = connector(k, person.cookie)
    let made = await agent.tool('app_new', { slug: 'arena', title: 'Arena' })
    let space = /https:\/\/([a-z0-9-]+)\.yaks\.app/.exec(made)![1]
    let app = { space, app: 'arena' }
    // The Store accepts a retype while that property has no values. Its
    // immutable deploy history is evidence of acceptance, not a new write.
    for (
      let content of [
        vocabFile({
          fight: { dealt: { type: 'string', format: 'json' }, notes: txt },
          memento: { name: txt },
        }, {
          old_fights: { description: 'List recorded fights', query: '.fight' },
        }),
        vocabFile({ fight: { dealt: { type: 'array' } } }, {
          current_fights: {
            description: 'List current fights',
            query: '.fight',
          },
        }),
      ]
    ) {
      await agent.tool('app_files', {
        ...app,
        files: [{ path: 'vocab.json', content }],
      })
      await agent.tool('app_deploy', app)
    }
    // Only this isolated kernel's snapshots are removed. File-only discovery
    // cannot know which retired columns were empty, so it preserves them.
    let snapshots = await blobs.list(`${space}/.declarations/`)
    ok(snapshots.length > 0)
    for (let key of snapshots) await blobs.delete(key)

    fetched.length = 0
    await agent.call('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'legacy-retype', version: '1' },
    })
    await agent.call('tools/list')
    equal(fetched, [], 'legacy discovery must not fetch app Stores')
    ok((await agent.tool('app_list')).includes('arena'))
    ok(fetched.every(({ path }) => path == '/query'))
    fetched.length = 0
    let schema = await agent.call('tools/call', {
      name: 'graph_schema',
      arguments: {},
    })
    let defs = schema.structuredContent.$defs
    equal(defs.fight.properties.dealt.type, 'array')
    equal(defs.fight.properties.notes.type, 'string')
    equal(defs.memento.properties.name.type, 'string')
    let commands = await commandsOf(agent, app)
    ok(commands.some((c) => c.name == 'current_fights'))
    ok(!commands.some((c) => c.name == 'old_fights'))
    let add = commands.find((c) => c.name == 'add_fight')!
    equal(
      (add.input as { properties: Record<string, { type: string }> })
        .properties.dealt.type,
      'array',
    )
    equal(fetched, [], 'legacy discovery must not fetch app Stores')
  } finally {
    await k.stop()
  }
})
