// An invitation is nothing until its person accepts it (invite.ts, T-37880).
// Before T-37880 `member_add` wrote the seat outright, so naming a stranger's
// address put the inviter's space in the stranger's listing, their agent's
// instructions, and behind a bare app name their agent would say.
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import {
  accept,
  acceptLink,
  door,
  invitedWords,
  placeOf,
  SUBJECT,
} from './invite.ts'
import {
  again,
  invitedHere,
  refusedSaid,
  shared,
  shut,
  waiting,
} from './apps.ts'
import { people } from './pages.ts'
import { aloud, peopleOwned, type Person, shown } from './people.ts'
import {
  type App,
  type Directory,
  directory,
  type Held,
  part,
  type Space,
} from './directory.ts'
import type { Env } from './env.ts'
import type { Letter } from './mail.ts'
import type { Meta } from './meta.ts'
import { platformVocab } from './vocab.ts'
import {
  accepted,
  clickInvite,
  connector,
  type Kernel,
  kernel,
  letter,
  meta,
  signIn,
} from './probe.ts'
import { HELLO } from './mcp-probe.ts'

let SECRET = 'secret'

// A person's dashboard, as their browser opens it.
let desk = (k: Kernel, cookie: string) =>
  k.at(k.host, '/manage', { headers: { cookie } }).then((r) => r.text())

test('an invitation reaches nobody until its person accepts it', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let his = connector(k, jeff.cookie)
    let mine = jeff.email.split('@')[0]
    await his.tool('app_new', { slug: 'notes', title: 'Notes' })
    await his.tool('app_files', {
      app: 'notes',
      op: 'write',
      path: 'index.html',
      content: '<h1>Notes</h1>',
    })
    await his.tool('app_deploy', { app: 'notes' })

    let ana = await signIn(k)
    let hers = connector(k, ana.cookie)
    let said = await his.tool('member_add', {
      email: ana.email,
      note: 'please look',
    })
    assertStringIncludes(said, 'accept')

    // The letter: fixed words in the subject, and the one click in the body.
    let l = await letter(k, ana.email, '/invite?t=')
    assertEquals(l.subject, SUBJECT)
    assertStringIncludes(l.body, '> please look')

    // Pending: not in her listing, not behind a bare app name, not in what
    // her agent is told.
    let reach = async () => {
      let listed = await hers.tool('app_list')
      let init = await connector(k, ana.cookie).call('initialize', HELLO)
      let files = await hers.tool('app_files', { app: 'notes', op: 'list' })
        .catch((e) => String(e))
      return { listed, init: String(init.instructions), files }
    }
    let before = await reach()
    assertEquals(before.listed.includes(`${mine}.yaks.app`), false)
    assertEquals(before.init.includes(mine), false)
    assertEquals(before.files.includes('index.html'), false)

    // A browser signed in as nobody, or as somebody else, accepts nothing:
    // it is asked to sign in as the address the letter went to, and told what
    // the letter told, who invited them to what, and no more: the note stays
    // in the letter.
    for (let cookie of [undefined, jeff.cookie]) {
      let page = await clickInvite(k, ana.email, cookie)
      assertEquals(page.status, 200)
      let said = await page.text()
      assertStringIncludes(said, ana.email)
      assertStringIncludes(said, `${mine} invited you to use`)
      assertStringIncludes(said, `${mine}.yaks.app`)
      assert(!said.includes('please look'))
    }
    assertEquals((await reach()).listed.includes(`${mine}.yaks.app`), false)

    // Her click, signed in as her: accepted, and she lands on the space.
    assertEquals(
      await accepted(k, ana.email, ana.cookie),
      `https://${mine}.yaks.app/`,
    )
    let after = await reach()
    assertStringIncludes(after.listed, `${mine}.yaks.app`)
    assertStringIncludes(after.files, 'index.html')
    // Her dashboard lists the space's apps as shared with her.
    assertStringIncludes(
      await desk(k, ana.cookie),
      `href="https://${mine}.yaks.app/notes/"`,
    )
    // The letter's link still takes her there after it has been used.
    assertEquals(
      await accepted(k, ana.email, ana.cookie),
      `https://${mine}.yaks.app/`,
    )

    // The letter counted against his space's month.
    let [row] = await meta(k).query(
      `.space.slug=${mine}&?meter`,
    ) as { meter?: { emails?: number } }[]
    assertEquals(row.meter?.emails, 1)

    // A pending invitation is withdrawn by member_remove, and its link then
    // opens onto nothing.
    let bo = await signIn(k)
    await his.tool('member_add', { email: bo.email, app: 'notes' })
    assertStringIncludes(
      await his.tool('member_remove', { email: bo.email, app: 'notes' }),
      'withdrawn',
    )
    let gone = await clickInvite(k, bo.email, bo.cookie)
    assertEquals(gone.status, 410)
    await gone.body?.cancel()
    assert(
      !(await connector(k, bo.cookie).tool('app_list')).includes(
        `${mine}.yaks.app`,
      ),
    )
  } finally {
    await k.stop()
  }
})

// A dashboard form, posted the way its browser posts it.
let post = (
  k: Kernel,
  cookie: string,
  view: string,
  fields: Record<string, string>,
) =>
  k.at(k.host, `/manage/${view}`, {
    method: 'POST',
    headers: { cookie },
    body: new URLSearchParams(fields),
  })

test('the People page invites and takes people off the way member_add and member_remove do', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    await connector(k, jeff.cookie).tool('app_new', {
      slug: 'notes',
      title: 'Notes',
    })
    let page = (q = '') =>
      k.at(k.host, `/manage/people${q}`, { headers: { cookie: jeff.cookie } })
        .then((r) => r.text())
    assertStringIncludes(await page(), 'Send invitation')

    let ana = await signIn(k)
    let sent = await post(k, jeff.cookie, 'people', {
      invite: ana.email,
      app: 'notes',
      role: 'viewer',
      note: 'have a look',
    })
    assertEquals(sent.status, 303)
    let back = new URL(sent.headers.get('location')!)
    assertEquals(back.pathname, '/manage/people')
    let l = await letter(k, ana.email, '/invite?t=')
    assertStringIncludes(l.body, '> have a look')
    let listed = await page(back.search)
    assertStringIncludes(listed, 'Invitation sent.')
    assertStringIncludes(listed, 'Notes · this app only')
    assertStringIncludes(listed, `${ana.email} · viewer · `)

    // Withdrawn from its row, the invitation is gone from the page.
    let gone = await post(k, jeff.cookie, 'people', {
      remove: ana.email,
      app: 'notes',
    })
    assertEquals(gone.status, 303)
    let after = await page(new URL(gone.headers.get('location')!).search)
    assertStringIncludes(after, 'Removed.')
    assert(!after.includes(ana.email))

    // A member who accepted is taken off the same way.
    let bo = await signIn(k)
    await post(k, jeff.cookie, 'people', { invite: bo.email })
    await accepted(k, bo.email, bo.cookie)
    assertStringIncludes(await page(), `aria-label="Remove ${bo.email}"`)
    await post(k, jeff.cookie, 'people', { remove: bo.email })
    assert(!(await page()).includes(bo.email))
    assert(
      !(await connector(k, bo.cookie).tool('app_list')).includes('notes'),
    )

    // Refused, the page says why and the address is still in the field.
    let refused = await post(k, jeff.cookie, 'people', {
      invite: jeff.email,
      note: 'me again',
    })
    assertEquals(refused.status, 400)
    let said = await refused.text()
    assertStringIncludes(said, `${jeff.email} is you`)
    assertStringIncludes(said, `value="${jeff.email}"`)
    assertStringIncludes(said, 'me again</textarea>')
  } finally {
    await k.stop()
  }
})

// The people and places of the tests below, and a directory that holds
// them: the seams that decide what a friend and an owner are told, without a
// kernel.
let JEFF = 'jeff-eid'
let space = { eid: 'sp', slug: 'jeff', title: 'Jeff' } as Space
let diary = {
  eid: 'ap',
  slug: 'diary',
  title: 'Diary',
  space: 'sp',
  access: 'private',
} as App
let emailOf = (person: string) => `${person}@x.test`

// Her letter's link, sealed once.
let link = await acceptLink(SECRET, { invite: 'inv', to: 'ap' }, {})

// ana is invited to the diary and has not accepted; bo was never invited.
let invited = () => {
  let invites = new Map([['ap/ana', { eid: 'inv', role: 'editor' }]])
  let applied: unknown[] = []
  let dir = {
    invite: (to: string, person: string) =>
      Promise.resolve(invites.get(`${to}/${person}`) ?? null),
    invitation: (eid: string) =>
      Promise.resolve(
        eid == 'inv'
          ? { eid, to: 'ap', person: 'ana', role: 'editor', by: JEFF }
          : null,
      ),
    appAt: (eid: string) =>
      Promise.resolve(eid == 'ap' ? { space, app: diary } : null),
    at: () => Promise.resolve(null),
    emailAt: (person: string) => Promise.resolve(emailOf(person)),
    nameAt: () => Promise.resolve('Jeff'),
    grant: () => Promise.resolve(null),
    apply: (b: unknown) => Promise.resolve(void applied.push(b)),
  } as unknown as Directory
  let click = (person: string | null) =>
    door(new Request(link), {} as Env, dir, person, SECRET)
  return { dir, applied, click }
}

// Her letter's link, opened before she signs in, says who invited her to
// which app, and wears the platform's face rather than the private app's own,
// which is not hers to see yet.
test('an invitation opened before signing in says who invited them to which app', async () => {
  let offer = await (await invited().click(null)).text()
  assertStringIncludes(offer, 'invited you to use Diary.')
  assertStringIncludes(offer, 'href="https://jeff.yaks.app/diary/"')
  assertStringIncludes(offer, '/connector-512.png')
})

// Refused at the app, she is told her invitation waits; the stranger is told
// whose it is to grant, and sees nothing of the app.
test('a friend who has not accepted is told the invitation waits', async () => {
  let { dir } = invited()
  assertStringIncludes(
    await refusedSaid(dir, space, diary, 'ana', 'not_a_writer'),
    'invitation to this app',
  )
  assert(!await waiting(dir, space, diary, 'bo', 'not_a_writer'))
  assert(
    !(await refusedSaid(dir, space, diary, 'bo', 'not_a_writer')).includes(
      'invitation',
    ),
  )
})

test("a private app's page tells an invited friend it waits, and a stranger nothing", async () => {
  let { dir } = invited()
  let page = await shut(dir, space, diary, 'ana', {})
  assertEquals(page.status, 403)
  assertStringIncludes(await page.text(), 'Your invitation is waiting')
  assertStringIncludes(
    await (await shut(dir, space, diary, 'bo', {})).text(),
    'Nothing here yet',
  )
})

test('asked again, the owner hears the friend never accepted', () => {
  assertStringIncludes(
    invitedWords({
      email: emailOf('ana'),
      role: 'editor',
      place: { space, app: diary },
      standing: true,
    }),
    'had not accepted yet',
  )
})

test('her click, signed in as her, takes the invitation and writes her grant', async () => {
  let { click, applied } = invited()
  assertEquals((await click('ana')).status, 303)
  assertMatch(JSON.stringify(applied), /"tombstone".*"grant".*"person":"ana"/)
})

// The space's roster as the directory holds it: jeff owns it, bo is a member,
// ana a guest of the diary, and cy invited to the space and not in yet.
let row = (
  held: Held['held'],
  person: string,
  role: Held['role'],
  on: string,
  sent: string | null = null,
): Held => ({ eid: `${person}/${on}`, held, on, person, role, sent })
let roster = {
  held: () =>
    Promise.resolve([
      row('seat', JEFF, 'owner', 'sp'),
      row('seat', 'bo', 'editor', 'sp'),
      row('grant', 'ana', 'editor', 'ap'),
      row('invite', 'cy', 'viewer', 'sp', '2026-10-14T09:00:00Z'),
    ]),
  persons: (ids: string[]) =>
    Promise.resolve(
      new Map(ids.map((id) => [id, { name: id, email: emailOf(id) }])),
    ),
} as unknown as Directory
let [bo, ana, cy] = ['bo', 'ana', 'cy'].map(emailOf)
let emails = (them: Person[]) =>
  them.map((p) => shown(p)).map((p) => `${p.email} ${p.role}`)

let ownerSeats = [{ space, role: 'owner' as const }]
let ownedApps = [diary]
let namedRoster = (await peopleOwned(roster, ownerSeats, ownedApps)).get(
  space.eid,
)!
let pageRoster = (await peopleOwned(roster, ownerSeats, ownedApps)).get(
  space.eid,
)!
test('the owner and their assistant see who is in and who has not accepted', async () => {
  let here = (await peopleOwned(roster, ownerSeats, ownedApps))
    .get(space.eid)!

  // The words name who has yet to accept, which is what someone may be
  // waiting on, and count the rest; the value names everyone.
  let said = aloud(here, JEFF).join('\n')
  assertStringIncludes(said, `${cy} (viewer of the whole space`)
  assertStringIncludes(said, 'letter sent 2026-10-14')
  assertStringIncludes(said, '2 other people')
  assert(!said.includes(bo) && !said.includes(ana))
  assert(emails(here.members).includes(`${bo} editor`))
  assertEquals(emails(here.invited), [`${cy} viewer`])
  assertEquals(emails(here.apps[0].guests), [`${ana} editor`])
})

test('asked by name, the assistant lists every member and app guest', () => {
  let named = aloud(namedRoster, JEFF, {}, true).join('\n')
  assertStringIncludes(named, `${bo} (editor)`)
  assertStringIncludes(named, `Guests of Diary: ${ana} (editor)`)
})

test('the People page lists members and offers to resend a pending invitation', () => {
  let page = people({ space: 'jeff', apps: [], people: pageRoster })
  for (let them of [ana, bo, cy]) assertStringIncludes(page, them)
  assertStringIncludes(page, 'not accepted yet')
  assertStringIncludes(page, 'name="again" value="cy/sp"')
})

test('a member is not shown who else is in the space', async () => {
  // bo's seat is a member's: the space's people, and who its owner invited,
  // are not his to read, even asking (app_list's `people`).
  let his = await peopleOwned(roster, [{ space, role: 'editor' }], [diary])
  assertEquals(his.size, 0)
})

test('a page hears that an invitation waits only for the friend it waits for', async () => {
  // ana is invited to edit the private diary; dee to view the public wall.
  let wall = { ...diary, eid: 'wl', slug: 'wall', access: 'public' } as App
  let invites = new Map([
    ['ap/ana', { eid: 'i1', role: 'editor' as const }],
    ['wl/dee', { eid: 'i2', role: 'viewer' as const }],
  ])
  let dir = {
    invite: (to: string, person: string) =>
      Promise.resolve(invites.get(`${to}/${person}`) ?? null),
  }
  let hears = (
    app: App,
    person: string | null,
    reads: boolean,
    posts = false,
  ) => invitedHere(dir, space, app, person, reads, posts)
  assertEquals(await hears(diary, 'ana', false), true)
  // Nobody signed in, a stranger, and ana once she writes there.
  assertEquals(await hears(diary, null, false), false)
  assertEquals(await hears(diary, 'bo', false), false)
  assertEquals(await hears(diary, 'ana', true, true), false)
  // A viewer's invitation lifts no refusal to write on a page she reads.
  assertEquals(await hears(wall, 'dee', true), false)
})

// The directory itself, in memory: jeff's diary, ana invited to it, and cy
// invited and accepted (invite.ts `accept`), as the letter's click does.
let directoryWith = async () => {
  let vocab = platformVocab()
  let g = graph({ vocab, storage: ram(vocab) })
  let store = {
    query: (line: string) => g.read(line),
    apply: (b: Bundle[], headers: Record<string, string> = {}) =>
      g.apply(b, { trusted: headers['x-yak-kernel'] == '1' }),
  } as unknown as Meta
  let [owner, invitee, guest] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ]
  await g.apply([
    ...[owner, invitee, guest].map((eid) => ({
      entity: { eid },
      person: {},
      email: { address: `${eid}@x.test` },
    })),
    {
      entity: { eid: 'sp' },
      doc: { title: 'Jeff' },
      space: { slug: 'jeff', store: 'jeff' },
    },
    {
      entity: { eid: 'ap' },
      doc: { title: 'Diary' },
      app: { slug: 'diary', space: 'sp', access: 'private' },
    },
    {
      entity: { eid: 'seat' },
      member: { space: 'sp', person: owner, role: 'owner' },
    },
    ...[invitee, guest].map((person) => ({
      entity: { eid: `inv-${person}` },
      invite: { to: 'ap', person, role: 'editor' },
    })),
  ], { trusted: true })
  let dir = directory(part(store), true)
  let place = (await placeOf(dir, 'ap'))!
  await accept(dir, (await dir.invitation(`inv-${guest}`))!, place)
  return { dir, invitee, guest }
}
let held = directoryWith()

test("a friend's dashboard lists a shared app only once they accept", async () => {
  let { dir, invitee, guest } = await held
  assertEquals(await shared(dir, invitee), [])
  assertEquals(await shared(dir, guest), [
    { eid: 'ap', slug: 'diary', title: 'Diary', space: 'jeff' },
  ])
})

test('Send again mails a standing invitation again, and nothing for one gone', async () => {
  let elsewhere = { eid: 'other', slug: 'other', title: 'Other' } as Space
  let invitations: Record<string, { to: string }> = {
    'inv-cy': { to: 'sp' },
    'inv-far': { to: 'other' },
  }
  let dir = {
    invitation: (eid: string) =>
      Promise.resolve(
        invitations[eid] && {
          eid,
          ...invitations[eid],
          person: 'cy',
          role: 'viewer',
          by: JEFF,
        },
      ),
    appAt: () => Promise.resolve(null),
    at: (eid: string) =>
      Promise.resolve(
        eid == 'sp' ? space : eid == 'other' ? elsewhere : null,
      ),
    emailAt: (person: string) => Promise.resolve(emailOf(person)),
    nameAt: () => Promise.resolve('Jeff'),
    inviting: () => Promise.resolve(null),
    owners: () => Promise.resolve([]),
    spaces: () => Promise.resolve([]),
  } as unknown as Directory
  let wrote: Bundle[] = []
  let env = {
    SESSION_SECRET: SECRET,
    META: {
      query: () => Promise.resolve([]),
      apply: (b: Bundle[]) => (wrote.push(...b), Promise.resolve(b)),
    },
  } as unknown as Env
  let sent: Letter[] = []
  let post = (l: Letter) => Promise.resolve(void sent.push(l))
  let press = (eid: string) =>
    again(env, dir, space, { person: JEFF }, eid, post)

  assertEquals(await press('inv-cy'), null)
  assertEquals(sent.map((l) => [l.to, l.subject]), [[cy, SUBJECT]])
  assertStringIncludes(sent[0].body, '/invite?t=')
  assert(wrote.some((b) => b.entity.eid == 'inv-cy' && b.invite))
  // Accepted or withdrawn since the page was drawn, or another space's: it
  // says so, and no letter goes.
  let gone = { say: 'That invitation is no longer waiting.', no: true }
  assertEquals(await press('inv-gone'), gone)
  assertEquals(await press('inv-far'), gone)
  assertEquals(sent.length, 1)
})
