import { equal, ok, test } from '@yaks/testing'
import type { Arrival } from '@yaks/phone'
import { lineArrived } from './operator-line.ts'
import { bucket } from './binding-probe.ts'
import { space } from './directory-fixture.ts'
import { attached } from './attachments.ts'
import type { Env } from './env.ts'
import type { File } from './operator-files.ts'

let media = [
  { type: 'image/png', url: 'data:image/png;base64,aW1hZ2U=' },
  { type: 'text/plain', url: 'data:text/plain,Tuesday%20at%203' },
]
let arrival: Arrival & { via: string } = {
  id: 'reply-with-files',
  at: '2026-11-18T08:00:00.000Z',
  from: '+12695550142',
  to: '+12695550111',
  text: 'Here are the files.',
  rcs: false,
  media,
  via: 'test-phone',
}
let mine = space({ eid: crypto.randomUUID(), store: 'line-media' })
let other = space({ eid: crypto.randomUUID(), store: 'other-line' })
let sender = crypto.randomUUID()
let fixture = (match = mine.eid, stopped = false) => {
  let replies: { space: string; person: string; say: string; files: File[] }[] =
    []
  let blobs = bucket()
  let env = {
    BLOBS: blobs.r2,
    BUILDER: {
      idFromName: (name: string) => name,
      get: (id: unknown) => ({
        fetch: async (req: Request) => {
          let path = new URL(req.url).pathname
          if (path == '/operator/letter') {
            return new Response(null, { status: id == match ? 200 : 404 })
          }
          if (path == '/operator/control') return Response.json({ stopped })
          let body = await req.json() as {
            say: string
            request: { files: File[] }
          }
          replies.push({
            space: String(id),
            person: req.headers.get('x-yak-person')!,
            say: body.say,
            files: body.request.files,
          })
          return new Response(null, { status: 202 })
        },
      }),
    },
  } as unknown as Env
  return { env, blobs, replies }
}

let kept = fixture()
let result = await lineArrived(kept.env, [other, mine], arrival, sender)
let [reply] = kept.replies
let bytes = await Promise.all(
  reply.files.map((file) =>
    attached(kept.env, mine, file.key.split('/').at(-1)!)
  ),
)

test('a connected-line reply keeps every media file in the matching space and hands it to the Operator', () => {
  equal(result, { space: mine, fresh: true })
  equal([reply.space, reply.person, reply.say], [
    mine.eid,
    sender,
    arrival.text,
  ])
  equal(reply.files.map((file) => [file.name, file.mime, file.size]), [
    ['text-1.png', 'image/png', 5],
    ['text-2.plain', 'text/plain', 12],
  ])
  equal(bytes.map((body) => body && new TextDecoder().decode(body)), [
    'image',
    'Tuesday at 3',
  ])
  equal(
    reply.files.every((file) => file.key.startsWith(mine.store + '/')),
    true,
  )
  equal(kept.blobs.held.size, 2)
})

let unmatched = fixture('no-match')
let ignored = await lineArrived(unmatched.env, [other], arrival, sender)
let blocked = fixture(mine.eid, true)
await lineArrived(blocked.env, [mine], arrival, sender)

test('an unmatched or opted-out connected-line reply stores no media and asks no Operator', () => {
  equal(ignored, null)
  for (let f of [unmatched, blocked]) {
    equal(f.replies, [])
    equal(f.blobs.held.size, 0)
  }
})

let damaged = fixture()
await lineArrived(damaged.env, [mine], {
  ...arrival,
  id: 'reply-with-missing-file',
  media: [{ type: 'image/png', url: 'data:bad' }, media[1]],
}, sender)
test('a connected-line reply keeps the words and later files when one media fetch fails', () => {
  let [reply] = damaged.replies
  ok(reply.say.startsWith(arrival.text + '\n\n'))
  ok(reply.say.includes('Attachment text-1.png did not come through:'))
  equal(reply.files.map((file) => file.name), ['text-2.plain'])
  equal(damaged.blobs.held.size, 1)
})
