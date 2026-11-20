// The spaces an outreach trial writes to: people's, pilots included, never the
// platform's own accounts' or test accounts'.
import { equal, test } from '@yaks/testing'
import { factsOf } from './outreach.ts'
import type { Census } from './admin.ts'

let NOW = Date.parse('2026-11-20T00:00:00.000Z')

test("the platform's own accounts and test accounts get no letter; people do", () => {
  let person = (eid: string, address: string) => ({
    entity: { eid },
    person: {},
    email: { address },
  })
  let home = (eid: string, slug: string) => ({
    entity: { eid },
    space: { slug },
  })
  let seat = (space: string, person: string) => ({
    entity: { eid: `${space}-${person}` },
    member: { space, person, role: 'owner' },
  })
  let census = {
    people: [
      person('ann', 'ann@x.com'),
      person('admin', 'admin@bot.yak.sh'),
      person('probe', 'probe@bot.yak.sh'),
    ],
    spaces: [home('a', 'ann'), home('b', 'admin'), home('c', 'probe')],
    apps: [],
    seats: [seat('a', 'ann'), seat('b', 'admin'), seat('c', 'probe')],
    deploys: [],
    referrals: [],
    agents: [],
  } as unknown as Census
  equal(factsOf(census, new Date(NOW)).map((f) => f.slug), ['ann'])
})
