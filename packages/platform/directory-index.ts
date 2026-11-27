// A directory write keeps the keys its published lists page through, and the
// figures a list counts a space by (`holds`), so a page reads only its own
// rows. The source rows still say what happened: the keys follow the
// transaction, including removals, restores and changes to a seat's person or
// space.
import { after, each } from '@yaks/fp'
import { type Bundle, type Comp, type Plugin, type Tx } from '@yaks/graph'
import { line } from '@yaks/query'
import { isTestAddress, isTestNumber } from './bots.ts'
import { PLATFORM_SPACE } from './names.ts'

let part = (r: Bundle | undefined, name: string) =>
  r?.[name] as Comp | undefined
let ref = (r: Bundle | undefined, name: string, prop: string) =>
  String(part(r, name)?.[prop] ?? '')
let id = (r: Bundle) => r.entity.eid
let unique = (keys: string[]) => [...new Set(keys.filter(Boolean))]
let byId = (rows: Bundle[]) => new Map(rows.map((r) => [id(r), r]))
let writes = (b: Bundle, parts: string[]) =>
  parts.some((name) => b[name] !== undefined)

export let testEvidence = (row?: Bundle): boolean => {
  let client = part(row, 'newcomer')?.client
  return isTestAddress(ref(row, 'email', 'address')) ||
    isTestNumber(ref(row, 'phone', 'number')) ||
    client != null && client != 'browser'
}

let explicit = (row?: Bundle) => !!row?.test && !part(row, 'test')?.inferred
let testOf = (row?: Bundle) =>
  !!row?.person && (explicit(row) || testEvidence(row))

let latest = (...times: unknown[]) =>
  times.reduce<string | null>(
    (at, time) => typeof time == 'string' && (!at || time > at) ? time : at,
    null,
  )
let used = (r?: Bundle) => part(r, 'used')?.at
let ordered = (row: Bundle, kind: string, test: boolean, at: string | null) => {
  let order = part(row, 'directory_order')
  let visible = test ? null : kind
  return order?.kind == kind && (order.visible_kind ?? null) == visible &&
      (order.at ?? null) == at
    ? undefined
    : { kind, visible_kind: visible, at }
}
let marked = (row: Bundle, test: boolean) =>
  test == !!row.test ? undefined : test ? { inferred: true } : null

let patch = (row: Bundle, words: Record<string, Comp | null | undefined>) =>
  Object.values(words).some((p) => p !== undefined)
    ? [{
      entity: row.entity,
      ...Object.fromEntries(
        Object.entries(words).filter(([, value]) => value !== undefined),
      ),
    }]
    : []

let write = (tx: Tx, made: Bundle[], rows: Bundle[]) =>
  rows.length
    ? after(tx.patch(rows), () => {
      made.push(...rows.map((r) => ({ ...r, $quiet: true })))
    })
    : undefined

let PARTS = [
  'person',
  'email',
  'phone',
  'newcomer',
  'test',
  'used',
  'signed_in',
  'space',
  'app',
  'trashed',
  'member',
  'referral',
  'directory_order',
]

let readBy = (tx: Tx, eids: string[], comps: string[]) =>
  eids.length ? tx.get(eids, comps) : []

let changed = (
  tx: Tx,
  before: Map<string, Bundle | undefined>,
  rows: Bundle[],
  made: Bundle[],
) => {
  let now = byId(rows)
  let old = [...before.values()].flatMap((r) => r ? [r] : [])
  let touched = [...old, ...rows]
  let accounts = unique(touched.filter((r) => r.person).map(id))
  let moved = accounts.filter((eid) => {
    let was = before.get(eid), has = now.get(eid)
    return testOf(has) != !!was?.test || !!was?.person != !!has?.person
  })
  let places = unique(touched.flatMap((r) => [
    r.space ? id(r) : '',
    ref(r, 'member', 'space'),
    ref(r, 'app', 'space'),
  ]))
  let owners = unique(
    touched.filter((r) => part(r, 'member')?.role == 'owner')
      .map((r) => ref(r, 'member', 'person')),
  )
  return after(
    moved.length ? tx.read(line`.member.person=${moved}`, {}, ['member']) : [],
    (seats) =>
      after(
        indexSpaces(
          tx,
          unique([...places, ...seats.map((s) => ref(s, 'member', 'space'))]),
          made,
        ),
        ({ people, apps }) =>
          after(
            indexPeople(tx, unique([...accounts, ...owners, ...people]), made),
            () =>
              after(
                indexApps(
                  tx,
                  unique([...rows.filter((r) => r.app).map(id), ...apps]),
                  made,
                ),
                () =>
                  indexInvites(tx, rows.filter((r) => r.referral), moved, made),
              ),
          ),
      ),
  )
}

let indexSpaces = (tx: Tx, spaces: string[], made: Bundle[]) =>
  each(
    spaces,
    { people: [] as string[], apps: [] as string[] },
    (out, eid) =>
      after(
        tx.get([eid], ['space', 'used', 'test', 'directory_order', 'holds']),
        ([r]) => {
          if (!r?.space) return out
          return after(
            tx.read(
              line`.member.space=${eid}`,
              {},
              ['member'],
            ),
            (seats) =>
              after(
                readBy(
                  tx,
                  unique(seats.map((s) => ref(s, 'member', 'person'))),
                  [
                    'person',
                    'email',
                    'phone',
                    'newcomer',
                    'test',
                  ],
                ),
                (members) =>
                  after(
                    tx.read(line`.app.space=${eid}`, {}, ['used', 'trashed']),
                    (apps) => {
                      let by = byId(members)
                      let live = apps.filter((a) => !a.trashed)
                      let test = seats.length > 0 &&
                        seats.every((s) =>
                          testOf(by.get(ref(s, 'member', 'person')))
                        )
                      let at = latest(
                        used(r),
                        ...live.map(used),
                      )
                      let order = ordered(r, 'space', test, at)
                      if (test != !!r.test) out.apps.push(...apps.map(id))
                      if (
                        order && part(r, 'directory_order')?.at != at &&
                        part(r, 'space')?.slug != PLATFORM_SPACE
                      ) {
                        out.people.push(
                          ...seats.filter((s) =>
                            part(s, 'member')?.role == 'owner'
                          )
                            .map((s) => ref(s, 'member', 'person')),
                        )
                      }
                      return after(
                        write(
                          tx,
                          made,
                          patch(r, {
                            test: marked(r, test),
                            directory_order: order,
                            holds: part(r, 'holds')?.apps == live.length
                              ? undefined
                              : { apps: live.length },
                          }),
                        ),
                        () => out,
                      )
                    },
                  ),
              ),
          )
        },
      ),
  )

let indexPeople = (tx: Tx, people: string[], made: Bundle[]) =>
  after(
    readBy(tx, people, PARTS),
    (rows) =>
      each<Bundle, void>(rows.filter((r) => r.person), undefined, (_, r) =>
        after(
          tx.read(
            line`.member.person=${id(r)}&.member.role=owner`,
            {},
            ['member'],
          ),
          (seats) =>
            after(
              readBy(tx, unique(seats.map((s) => ref(s, 'member', 'space'))), [
                'space',
                'directory_order',
              ]),
              (spaces) => {
                let test = testOf(r)
                let at = latest(
                  used(r),
                  part(r, 'signed_in')?.at,
                  ...spaces.filter((s) =>
                    part(s, 'space')?.slug != PLATFORM_SPACE
                  )
                    .map((s) => part(s, 'directory_order')?.at),
                )
                return write(
                  tx,
                  made,
                  patch(r, {
                    test: marked(r, test),
                    directory_order: ordered(r, 'person', test, at),
                  }),
                )
              },
            ),
        )),
  )

let indexApps = (tx: Tx, apps: string[], made: Bundle[]) =>
  after(
    readBy(tx, apps, ['app', 'test', 'used', 'directory_order']),
    (rows) =>
      after(
        readBy(tx, unique(rows.map((r) => ref(r, 'app', 'space'))), [
          'space',
          'test',
        ]),
        (spaces) => {
          let by = byId(spaces)
          return write(
            tx,
            made,
            rows.filter((r) => r.app).flatMap((r) => {
              let space = by.get(ref(r, 'app', 'space'))
              let test = !space?.space || !!space.test
              return patch(r, {
                test: marked(r, test),
                directory_order: ordered(r, 'app', test, latest(used(r))),
              })
            }),
          )
        },
      ),
  )

let indexInvites = (tx: Tx, own: Bundle[], moved: string[], made: Bundle[]) =>
  after(
    moved.length
      ? tx.read(
        line`.referral.inviter=${moved}|.referral.invitee=${moved}`,
        {},
        ['referral', 'test', 'directory_order'],
      )
      : [],
    (found) => {
      let rows = [...byId([...own, ...found]).values()]
      let parties = (r: Bundle) => [
        ref(r, 'referral', 'invitee'),
        ref(r, 'referral', 'inviter'),
      ]
      return after(
        readBy(tx, unique(rows.flatMap(parties)), ['person', 'test']),
        (people) => {
          let by = byId(people)
          return write(
            tx,
            made,
            rows.flatMap((r) =>
              patch(r, {
                test: marked(
                  r,
                  parties(r).some((p) =>
                    !by.get(p)?.person || !!by.get(p)?.test
                  ),
                ),
                directory_order: ordered(r, 'referral', false, null),
              })
            ),
          )
        },
      )
    },
  )

export let directoryIndex = (): Plugin => ({
  name: 'directory-index',
  track: (tx) => {
    let before = new Map<string, Bundle | undefined>()
    let see = (eids: string[]) => {
      let fresh = unique(eids).filter((eid) => !before.has(eid))
      return after(readBy(tx, fresh, PARTS), (rows) => {
        let by = byId(rows)
        for (let eid of fresh) before.set(eid, by.get(eid))
      })
    }
    return {
      tx: {
        ...tx,
        patch: (rows) =>
          after(
            see(rows.filter((r) => writes(r, PARTS)).map(id)),
            () => tx.patch(rows),
          ),
        remove: (rows) =>
          after(see(rows.map((r) => r.eid)), () => tx.remove(rows)),
      },
      flush: (bundles) => {
        if (!before.size) return bundles
        let was = before
        before = new Map()
        return after(tx.get([...was.keys()], PARTS), (rows) => {
          let made: Bundle[] = []
          return after(
            changed(tx, was, rows, made),
            () => [...bundles, ...made],
          )
        })
      },
    }
  },
})
