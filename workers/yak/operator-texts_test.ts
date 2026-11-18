import { cleanup, clock, equal, ok, test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import { FILES } from '@yaks/platform/plans'
import { spent } from '@yaks/platform/meter'
import { platform } from './directory-rows-probe.ts'
import { space as spaceOf } from './directory-fixture.ts'
import { endpoints } from './endpoints.ts'
import { within } from './defects.ts'
import type { File } from './operator-files.ts'
import { textedOperator } from './operator-texts.ts'

let runtime = platform('operator-text-media')
let oversized = new Uint8Array(16 * 1024 * 1024 + 1)
let media = endpoints(globalThis).open((req) => {
  switch (new URL(req.url).pathname) {
    case '/http':
      return new Response(null, { status: 404 })
    case '/network':
      throw new Error('Media connection lost')
    case '/body':
      return new Response(
        new ReadableStream({
          start: (c) => c.error(new Error('Media body interrupted')),
        }),
      )
    case '/large':
      return new Response(oversized)
    default:
      return new Response('a picture')
  }
})
cleanup(media.stop)

let scenario = (
  paths: string[],
  text = 'Use these pictures for the invitation.',
) => {
  let reports: Bundle[] = []
  let received: { say: string; request: { files: File[] } }[] = []
  let eid = crypto.randomUUID(), person = crypto.randomUUID()
  let space = spaceOf({ eid, store: eid })
  let env = {
    ...runtime.env,
    ERRORS: {
      send: (rows: Bundle[]) => (reports.push(...rows), Promise.resolve()),
    },
    BUILDER: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (req: Request) => {
          equal(new URL(req.url).pathname, '/operator/receive')
          equal(req.headers.get('x-yak-person'), person)
          received.push(await req.json())
          return new Response(null)
        },
      }),
    },
  }
  let arrival = {
    via: 'telnyx',
    id: crypto.randomUUID(),
    from: '+12695550142',
    to: '+18005550100',
    at: '2026-11-18T08:00:00Z',
    text,
    rcs: false,
    media: paths.map((p) => ({ url: media.url + p, type: 'image/png' })),
  }
  return {
    env,
    space,
    reports,
    received,
    run: () =>
      within(
        env,
        {},
        () => textedOperator(env, space, person, arrival),
        clock(),
      ),
  }
}

for (
  let [path, reason] of [
    ['/http', 'Text media answered 404'],
    ['/network', 'Media connection lost'],
    ['/body', 'Media body interrupted'],
    ['/large', 'Operator attachments support files up to 16 MiB.'],
  ]
) {
  let s = scenario(['/ok', path, '/ok'])
  test(`text intake keeps words and other pictures when media fails at ${path}`, async () => {
    await s.run()
    equal(s.received.length, 1)
    let { say, request: { files } } = s.received[0]
    equal(
      say,
      'Use these pictures for the invitation.\n\n' +
        `Attachment text-2.png did not come through: ${reason}`,
    )
    equal(files.map((f) => f.name), ['text-1.png', 'text-3.png'])
    let bytes = await (await s.env.BLOBS.get(files[1].key))!.arrayBuffer()
    equal(new TextDecoder().decode(bytes), 'a picture')
    equal(s.reports.length, 1)
    equal((s.reports[0].exception as Comp).value, reason)
    equal((s.reports[0].error as Comp).tags, {
      request: 'operator-texts.pictures',
      space: s.space.eid,
      file: 'text-2.png',
    })
  })
}

let full = scenario(['/ok'])
full.space.meter = { ...spent(full.space), files: FILES.free }
full.env.BLOBS = {
  ...full.env.BLOBS,
  list: () =>
    Promise.resolve({
      objects: [{
        key: full.space.store + '/existing',
        size: FILES.free,
        uploaded: new Date(),
      }],
      truncated: false,
    }),
}
test('a full space keeps the text and reports its refused attachment', async () => {
  await full.run()
  equal(full.received[0].request.files, [])
  ok(
    full.received[0].say.startsWith(
      'Use these pictures for the invitation.\n\n',
    ),
  )
  ok(
    full.received[0].say.includes(
      'Attachment text-1.png did not come through:',
    ),
  )
  equal(full.reports.length, 1)
  equal((full.reports[0].exception as Comp).type, 'CallError')
})

let bare = scenario([])
test('text intake without media preserves the words exactly', async () => {
  await bare.run()
  equal(bare.received[0].say, 'Use these pictures for the invitation.')
  equal(bare.received[0].request.files, [])
  equal(bare.reports, [])
})

let only = scenario(['/http', '/network'], '')
test('a media-only text still tells the Operator every file that failed', async () => {
  await only.run()
  equal(
    only.received[0].say,
    'Attachment text-1.png did not come through: Text media answered 404\n\n' +
      'Attachment text-2.png did not come through: Media connection lost',
  )
  equal(only.received[0].request.files, [])
  equal(only.reports.length, 2)
})
