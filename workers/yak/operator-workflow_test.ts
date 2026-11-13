import { cleanup, equal, ok, test } from '@yaks/testing'
import type { Item, Request } from '@yaks/model'
import type { Comp } from '@yaks/graph'
import { integrationEid } from '@yaks/connections'
import { tick } from '@yaks/wake'
import { evaluate } from '../../packages/code-mode/testing.ts'
import { compiler, platform } from './testing.ts'
import { cloudflare, vars } from './probe.ts'
import { appStore, directoryOf } from './directory.ts'
import { connectionsOf } from './connections.ts'
import { KERNEL, meta } from './meta.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { WINDOW } from './model-probe.ts'
import { operating } from './operator.ts'
import { drain } from './operator-store.ts'
import { handleChannels, receive } from './operator-channels.ts'
import { rootOf } from './operator-root.ts'
import { seenBy } from './operator-access.ts'

let message =
  'do operators have tools for looking through connections? searching, listing, etc. How would they get info about them. i want to ask menno, "if i connect youtube, could you sync each sermon livestream video into our sermons data? thumbnail, title, series, link, description, etc. can you automate new ones for every saturday?". and i want him to understand what i\'m talking about, start building the integration and it should be marked as requested for me. and then, he should be able to schedule a weekly task that spawns a helper to get the video for the week and update the sermons. alternatively, he should be able to write a script that runs instead of a helper. but, the helper might be a bit more robust. perhaps some combo; the script runs and the helper checks its correct. so, basically, let\'s ensure this use-case is supported'

let account = cloudflare()
cleanup(() => account.stop())
let { env } = platform('operator-workflow', {
  ...vars('operator-workflow', account.url),
  CODE_MODE: evaluate,
  ESBUILD: compiler(),
})
let person = crypto.randomUUID()
let dir = directoryOf(env.STORE)
let spaceId = await dir.mint(person, 'weekly-sermons', 'Weekly sermons', {
  'x-yak-person': person,
  'x-yak-role': 'owner',
})
let space = (await dir.at(spaceId))!
await meta(env).apply([{
  entity: { eid: integrationEid('youtube') },
  integration: {
    name: 'youtube',
    title: 'YouTube',
    hosts: ['www.googleapis.com'],
    categories: ['video'],
    description: 'Video channels and livestreams',
    details: 'Read videos, thumbnails and descriptions.',
    docs: 'https://developers.google.com/youtube/v3',
    connects: 'signin',
    broker: { name: 'nango', integration: 'youtube' },
  },
  unchecked: {},
}], KERNEL)

// App code is built while the connection is requested. The fixture supplies
// the API fetch boundary; it does not exercise an OAuth connection.
let source = `
export let videos = async (env, fetch = globalThis.fetch) => {
  let response = await fetch('https://www.googleapis.com/youtube/v3/search?part=snippet&eventType=completed&type=video&channelId=fixture-channel', {
    headers: {authorization: 'Bearer ' + env.YOUTUBE}
  });
  if (!response.ok) throw new Error('YouTube answered ' + response.status);
  return await response.json();
};
export default {fetch: async (request, env) => Response.json(await videos(env))};
`
let worker = await import(`data:text/javascript,${encodeURIComponent(source)}`)
let feed = {
  items: [{
    id: { videoId: 'sermon-2026-11-14' },
    snippet: {
      title: 'Hope for tomorrow',
      description: 'Series: Hope\nSaturday sermon livestream.',
      thumbnails: {
        high: { url: 'https://i.ytimg.com/vi/sermon-2026-11-14/hqdefault.jpg' },
      },
    },
  }],
}
let fetched: {
  url: string
  authorization: string | null
  person: string | null
  role: string | null
}[] = []
env.DISPATCH = {
  get: () => ({
    fetch: async (request: globalThis.Request) =>
      Response.json(
        await worker.videos(
          { YOUTUBE: 'fixture-sentinel' },
          (url: string, init: RequestInit) => {
            fetched.push({
              url,
              authorization: new Headers(init.headers).get('authorization'),
              person: request.headers.get('x-yak-person'),
              role: request.headers.get('x-yak-role'),
            })
            return Promise.resolve(Response.json(feed))
          },
        ),
      ),
  }),
}
let vocab = {
  $defs: {
    sermon: {
      component: true,
      type: 'object',
      properties: Object.fromEntries(
        ['video', 'title', 'series', 'link', 'description', 'thumbnail'].map((
          name,
        ) => [name, { type: 'string' }]),
      ),
    },
    youtube_videos: {
      tool: true,
      description:
        'Read completed livestream videos from the connected YouTube account.',
      floor: 'owner',
      worker: '/youtube-videos',
      input: {},
    },
  },
}
let script = `
let feed = await tools.yaks.command({app:'church',name:'youtube_videos'});
if (feed.isError) throw new Error(JSON.stringify(feed));
let videos = JSON.parse(feed.structuredContent.result[0].output.value.answer).items;
let existing = await tools.yaks.graph_query({q:'.sermon'});
if (existing.isError) throw new Error(JSON.stringify(existing));
let rows = existing.structuredContent.result;
let bundles = videos.map(({id,snippet}, index) => ({
  entity: {eid: rows.find(row => row.sermon.video === id.videoId)?.entity.eid ?? '$sermon'+index},
  sermon: {
    video: id.videoId,
    title: snippet.title,
    series: snippet.description.match(/^Series: (.+)/m)?.[1] ?? '',
    link: 'https://www.youtube.com/watch?v='+id.videoId,
    description: snippet.description,
    thumbnail: snippet.thumbnails.high.url,
  }
}));
let wrote = await tools.yaks.graph_apply({bundles});
if (wrote.isError) throw new Error(JSON.stringify(wrote));
return {videos:videos.length,upserted:bundles.length};
`
let helper =
  'Verify the weekly sermon import: inspect church sermon rows and report whether thumbnail, title, series, link and description are present.'
let plan: [string, object][] = [
  ['integration_list', { words: 'youtube' }],
  ['connection_list', {}],
  ['app_new', { slug: 'church', title: 'Church sermons' }],
  ['app_files', {
    app: 'church',
    files: [
      { path: 'vocab.json', content: JSON.stringify(vocab) },
      { path: 'worker.js', content: source },
    ],
  }],
  ['app_deploy', { app: 'church' }],
  ['connection_need', { app: 'church', integration: 'youtube' }],
  ['wake_set', {
    every: '0 9 * * 6 America/Detroit',
    tool: 'code_mode',
    args: { script },
    helper,
  }],
]
let call = (name: string, args: object): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let say = (text: string): Item[] => [{ kind: 'assistant', text }]
let asked: Request[] = []
let store = operatorMemory()
let operator = operating(
  store,
  env,
  operatorModel((request) => {
    asked.push(request)
    let at = request.items.findLastIndex((item) => item.kind == 'user')
    let words = String((request.items[at] as { text?: string })?.text ?? '')
    let calls = request.items.slice(at + 1).filter((item) =>
      item.kind == 'call'
    ).length
    let setup = words.includes('Set up weekly sermon sync')
    let verify = words.includes('Verify the weekly sermon import')
    let items = setup
      ? calls < plan.length ? call(...plan[calls]) : say(
        'YouTube is requested. The app is built and the weekly import and checking helper are scheduled.',
      )
      : verify
      ? calls
        ? say(
          'Checked: the sermon has thumbnail, title, series, link and description.',
        )
        : call('graph_query', { q: '.sermon' })
      : words.includes(message)
      ? calls
        ? say('I am setting up the connection request and weekly sermon sync.')
        : call('fork', {
          prompt:
            'Set up weekly sermon sync for the church app. Request YouTube and schedule the import and a helper to check it every Saturday.',
        })
      : say('The weekly import is ready.')
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: request.model,
      items,
      cost: 0.001,
    })
  }, { context: WINDOW, output: 32_000 }),
)
handleChannels(operator, env)
await receive(store, { space: spaceId, person, channel: 'chat' }, message)
await drain(store)
let requested = await connectionsOf(env, space, person)
let [schedule] = await store.g.read(`.wake.for=${person}&*`)
ok(schedule, 'The Operator did not create the weekly import schedule.')
let app = (await dir.apps(space)).find((app) => app.slug == 'church')!
let graph = appStore(env.STORE, space, app)
let read = async () => {
  let response = await graph(
    '/query?q=' + encodeURIComponent('.sermon ?created'),
    {},
    {
      'x-yak-person': person,
      'x-yak-role': 'owner',
    },
  )
  return await response.json() as {
    entity: { eid: string }
    sermon: Comp
    created: Comp
  }[]
}
let empty = await read()
let run = async (at: number) => {
  await store.g.apply([{
    entity: schedule.entity,
    wake: { at: new Date(at).toISOString() },
  }], { trusted: true })
  await tick(store.g, at)
  await drain(store)
  return await read()
}
let now = Date.now()
let first = await run(now - 60_000)
feed.items[0].snippet.title = 'Hope for tomorrow — edited'
let second = await run(now - 30_000)
let runs = await store.g.read('.occurrence&*')
let hidden = await seenBy(store, crypto.randomUUID()).read('.occurrence')
let checked = asked.filter((request) => {
  let last = request.items.findLast((item) => item.kind == 'user')
  return last?.kind == 'user' && last.text.includes(helper) &&
    request.items.at(-1)?.kind == 'result'
})
let root = rootOf(spaceId, person)

test('Jeff’s exact request builds against an unconnected requested catalog service and schedules Saturdays', () => {
  ok(
    asked.some((request) =>
      request.items.some((item) =>
        item.kind == 'user' && item.text.includes(message)
      )
    ),
  )
  let youtube = requested.list.find((connection) =>
    connection.integration == 'youtube'
  )!
  equal(youtube.status, 'needed')
  ok(youtube.apps.some((app) => app.slug == 'church'))
  equal(empty, [])
  equal((schedule.wake as Comp).every, '0 9 * * 6 America/Detroit')
  equal((schedule.wake as Comp).for, person)
  ok(
    asked.some((request) =>
      JSON.stringify(request.items).includes(
        'Read videos, thumbnails and descriptions.',
      )
    ),
  )
})

test('each weekly run reads fresh video data and upserts all sermon fields with the person’s permissions', () => {
  equal(fetched.length, 2)
  ok(
    fetched.every((request) =>
      request.url.startsWith('https://www.googleapis.com/youtube/v3/')
    ),
  )
  ok(
    fetched.every((request) =>
      request.authorization == 'Bearer fixture-sentinel' &&
      request.person == person && request.role == 'owner'
    ),
  )
  equal(first.length, 1)
  equal(second.length, 1)
  equal(first[0].entity.eid, second[0].entity.eid)
  equal(second[0].sermon, {
    video: 'sermon-2026-11-14',
    title: 'Hope for tomorrow — edited',
    series: 'Hope',
    link: 'https://www.youtube.com/watch?v=sermon-2026-11-14',
    description: 'Series: Hope\nSaturday sermon livestream.',
    thumbnail: 'https://i.ytimg.com/vi/sermon-2026-11-14/hqdefault.jpg',
  })
  equal(second[0].created.by, spaceId)
  ok(runs.every((run) => !(run.occurrence as Comp).error))
})

test('each occurrence has a visible private run and a separate checking helper', () => {
  equal(runs.length, 2)
  equal(hidden, [])
  ok(
    runs.every((run) => (run.occurrence as Comp).wake == schedule.entity.eid),
  )
  ok(
    runs.every((run) =>
      (run.operator_session as Comp).person == person &&
      (run.operator_session as Comp).space == spaceId
    ),
  )
  ok(runs.every((run) => run.entity.eid != root))
  equal(checked.length, 2)
  ok(
    checked.every((request) =>
      JSON.stringify(request.items).includes('upserted')
    ),
  )
  ok(
    checked.every((request) =>
      JSON.stringify(request.items.at(-1)).includes('thumbnail')
    ),
  )
})
