import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { integrationEid } from '@yaks/connections'
import { platform } from './testing.ts'
import { directoryOf } from './directory.ts'
import { connectionsOf } from './connections.ts'
import { KERNEL } from './meta.ts'
import { operating } from './operator.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'

let { env } = platform('operator-connections')
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID()
let headers = { 'x-yak-person': person, 'x-yak-role': 'owner' }
let eid = await dir.mint(person, 'catalog', 'Catalog', headers)
let space = (await dir.at(eid))!
let integration = {
  name: 'youtube',
  title: 'YouTube',
  hosts: ['www.googleapis.com'],
  categories: ['video'],
  tagline: 'Watch and publish videos.',
  description: 'Channels and livestreams.',
  details: 'Read thumbnails, titles, descriptions and playlist series.',
  site: 'https://youtube.com',
  docs: 'https://developers.google.com/youtube/v3',
  connects: 'signin',
  broker: { name: 'nango', integration: 'youtube' },
}
await dir.apply({
  entities: [{
    entity: { eid: integrationEid(integration.name) },
    integration,
    unchecked: {},
  }],
}, KERNEL)
let operator = operating(
  operatorMemory(),
  env,
  operatorModel((req) =>
    Promise.resolve({ id: crypto.randomUUID(), model: req.model, items: [] })
  ),
)
let tools = await operator.tools({ person }, space)
let catalog = await tools.run('integration_list', {
  words: 'livestreams series',
})
let stranger = crypto.randomUUID()
await dir.apply({
  entities: [{
    entity: { eid: stranger },
    person: {},
  }, {
    entity: { eid: crypto.randomUUID() },
    member: { space: eid, person: stranger, role: 'viewer' },
  }],
}, KERNEL)
let viewer = await operator.tools({
  person: stranger,
}, space)

await tools.run('app_new', { slug: 'videos', title: 'Videos' })
await tools.run('connection_need', { app: 'videos', integration: 'youtube' })
let connections = await tools.run('connection_list', {})
let page = await connectionsOf(env, space, person)
let wanted = page.list.find((c) => c.integration == 'youtube')!
let source = 'export let sync = async (videos, save) => save(videos)\n'
await tools.run('app_files', {
  app: 'videos',
  path: 'sync.js',
  content: source,
})
let files = await tools.run('app_files', {
  app: 'videos',
  op: 'read',
  path: 'sync.js',
})

test('an Operator finds an unconnected catalog service by its integration details and reads its full description', () => {
  for (
    let text of [
      integration.title,
      integration.tagline,
      integration.description,
      integration.details,
      integration.site,
      integration.docs,
      integration.connects,
      integration.broker.name,
      'unchecked',
    ]
  ) assertStringIncludes(catalog, text)
})

test('the requested connection appears on the person’s Connections page while its app code can be built', () => {
  assertEquals(wanted.status, 'needed')
  assertEquals(wanted.apps.map((a) => a.slug), ['videos'])
  assertEquals(wanted.face.details, integration.details)
  assertEquals(wanted.keyed, false)
  assertStringIncludes(connections, 'youtube')
  assertStringIncludes(connections, 'needed')
  assertStringIncludes(files, source.trim())
})

let failures = await Promise.all([
  tools.run('store_connection_need', {
    app: 'videos',
    owner: stranger,
    integration: 'youtube',
  }),
  viewer.run('connection_need', { app: 'videos', integration: 'youtube' }),
].map((run) => run.catch((e) => String(e))))

test('Operator connection tools cannot request for another person or write for a viewer', () => {
  assertStringIncludes(
    failures[0],
    'owner must be the selected space or the caller',
  )
  assertStringIncludes(failures[1], 'There is no tool called connection_need')
})
