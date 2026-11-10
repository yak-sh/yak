// These messages were emitted by the source's ActiveSupport 8.1.3.1 with the
// public fixture key below. Tests verify interoperability without a Ruby process.
import { equal, test, throws } from '@yaks/testing'
import { rails, railsKeys } from '../apps/crayonbloom/rails.ts'
import fixture from './fixtures/crayonbloom-rails.json' with { type: 'json' }
import {
  legacyIdentity,
  legacyPage,
  type LegacyPrincipal,
} from '../apps/crayonbloom/legacy.ts'

let keys = await railsKeys('fixture key for Rails compatibility')
let verifier = await rails(keys)
let now = '2026-11-10T00:00:00Z'
let request = (cookies: Record<string, string>) =>
  new Request('https://fixture.test/', {
    headers: {
      cookie: Object.entries(cookies).map(([name, value]) =>
        `${name}=${encodeURIComponent(value)}`
      ).join('; '),
    },
  })

test('Source Rails sessions, guest cookies and resume cookies retain separate verified claims', async () => {
  equal(
    await verifier.identity(
      request({
        _coloring_book_maker_session: fixture.session,
        cb_guest: fixture.guest,
        fp_session: fixture.resume,
      }),
      now,
    ),
    { user: '123', guest: '456', resume: 'fixture-resume' },
  )
  equal(
    await verifier.identity(
      request({ _coloring_book_maker_session: fixture.session }),
      now,
    ),
    { user: '123' },
  )
})

test('Source ActiveStorage signed ids preserve purpose, expiry and authentic blob identity', async () => {
  equal(await verifier.blob(fixture.blob, now), '789')
  equal(await verifier.blob(fixture.guest, now), undefined)
  equal(await verifier.blob(fixture.blob, '2031-01-01'), undefined)
})

test('Expired, cross-purpose and tampered source credentials produce no authorization', async () => {
  equal(await verifier.signed(fixture.expired, 'cookie.cb_guest', now), null)
  equal(await verifier.signed(fixture.guest, 'cookie.fp_session', now), null)
  let tampered = fixture.guest.slice(0, -1) +
    (fixture.guest.endsWith('0') ? '1' : '0')
  equal(await verifier.signed(tampered, 'cookie.cb_guest', now), null)
  equal(
    await verifier.encrypted(
      fixture.session.slice(0, -1),
      'cookie._coloring_book_maker_session',
      now,
    ),
    null,
  )
})

test('A missing migration key is a configuration failure, never an anonymous credential fallback', async () => {
  await throws(
    () => rails({ ...keys, encrypted: new Uint8Array() }),
    'Invalid Rails migration key lengths',
  )
})

test('A source signature can bind only through a verified platform principal', async () => {
  let calls: unknown[] = []
  let caller = { owner: 'b0369c11-9034-4e65-86be-e7d4ff470dc2' }
  let ports = {
    credentials: verifier,
    bind: (claim: unknown, principal: LegacyPrincipal) => {
      calls.push({ claim, principal })
      return Promise.resolve(principal)
    },
  }
  equal(
    await legacyIdentity(
      request({ _coloring_book_maker_session: fixture.session }),
      caller,
      ports,
      now,
    ),
    caller,
  )
  equal(calls, [{ claim: { kind: 'user', id: '123' }, principal: caller }])
  await legacyIdentity(
    request({
      _coloring_book_maker_session: 'forged',
      email: 'reader@example.test',
    }),
    caller,
    ports,
    now,
  )
  await legacyIdentity(
    request({ _coloring_book_maker_session: fixture.session }),
    {},
    ports,
    now,
  )
  equal(calls.length, 1)
})

test('Original signed asset paths read exactly the verified copied blob without a store grant', async () => {
  let reads: string[] = []
  let db = {
    query: (q: string) =>
      Promise.resolve(
        q === '.legacy_asset.source_blob=789'
          ? [{
            entity: { eid: 'ec40946b-8943-49e0-b9a4-2aceb9f63199' },
            legacy_asset: {
              source_blob: '789',
              role: 'artwork',
              blob: 'fixture-blob',
              mime: 'image/png',
            },
          }]
          : [],
      ),
    apply: () => Promise.resolve(),
  }
  let ports = {
    credentials: verifier,
    asset: (blob: string) => {
      reads.push(blob)
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3])))
    },
  }
  let response = await legacyPage(
    new Request(
      'https://fixture.test/rails/active_storage/blobs/redirect/' +
        fixture.blob + '/original.png',
    ),
    db,
    {},
    now,
    ports,
  )
  equal(
    new Uint8Array(await response!.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  )
  equal(response!.headers.get('cache-control'), 'no-store, private')
  equal(reads, ['fixture-blob'])
  let denied = await legacyPage(
    new Request(
      'https://fixture.test/rails/active_storage/blobs/redirect/' +
        fixture.guest + '/original.png',
    ),
    db,
    {},
    now,
    ports,
  )
  equal(denied!.status, 404)
  equal(reads.length, 1)
})
