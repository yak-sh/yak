import { clock, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  RegionalAuthority,
  type RegionalDoor,
  type RegionalJournal,
  regionalLook,
} from './regional-route.ts'
import { REGIONAL_LEASE_MS } from './regional-serving-copy.ts'

test('an empty regional copy may be filled but an unreachable copy is left alone', async () => {
  let time = clock()
  assertEquals(await regionalLook(() => Promise.resolve(null), time), {
    reachable: true,
    answer: null,
  })
  let waiting = regionalLook(() => new Promise(() => {}), time)
  await time.advance(120)
  assertEquals(await waiting, { reachable: false, answer: null })
})

test('the authority drains outstanding grants after restart before committing a privacy change', async () => {
  let time = clock()
  let journal: RegionalJournal | undefined
  let revision = 1
  let down = false
  let door: RegionalDoor = {
    regionalRead: () => Promise.resolve(null),
    regionalPublish: (lease) => {
      assertEquals(journal?.until.oc, lease.until)
      return Promise.resolve(true)
    },
    regionalInvalidate: () =>
      down
        ? Promise.reject(new Error('region unavailable'))
        : Promise.resolve(),
  }
  let make = () =>
    new RegionalAuthority({
      read: () => journal,
      write: (next) => journal = next,
      committed: () => revision,
      door: () => door,
      clock: time,
    })
  assertEquals(await make().publish('oc', 1, 'page', 'public'), true)
  let until = journal!.until.oc
  let restarted = make()
  down = true
  let release = restarted.hold()
  let changed = restarted.fence().then(() => {
    revision = 2
    release()
  })
  assertEquals(await restarted.publish('oc', 1, 'page', 'public'), false)
  await time.advance(REGIONAL_LEASE_MS - 1)
  assertEquals([revision, journal?.until.oc], [1, until])
  await time.advance(1)
  await changed
  assertEquals(journal, { epoch: 1, until: {} })
  assertEquals(await restarted.publish('oc', 1, 'page', 'old'), false)
})
