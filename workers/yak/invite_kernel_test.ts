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
import { acceptLink, door, invitedWords, SUBJECT } from './invite.ts'
import { refusedSaid, shut, waiting } from './apps.ts'
import { people } from './pages.ts'
import { aloud, peopleIn, type Person, shown } from './people.ts'
import type { App, Directory, Held, Space } from './directory.ts'
import type { Env } from './env.ts'
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

// The people and places of the two tests below, and a directory that holds
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

test('a friend who has not accepted is told the invitation waits', async () => {
  // ana is invited to the diary and has not accepted; bo was never invited.
  let invites = new Map([['ap/ana', { eid: 'inv', role: 'editor' }]])
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
  let applied: unknown[] = []
  let click = async (person: string | null) =>
    door(
      new Request(
        await acceptLink(SECRET, { invite: 'inv', to: 'ap' }, {}),
      ),
      {} as Env,
      dir,
      person,
      SECRET,
    )

  // Her letter's link, opened before she signs in, says who invited her to
  // which app, and wears the platform's face rather than the private app's
  // own, which is not hers to see yet.
  let offer = await (await click(null)).text()
  assertStringIncludes(offer, 'invited you to use Diary.')
  assertStringIncludes(offer, 'href="https://jeff.yaks.app/diary/"')
  assertStringIncludes(offer, '/connector-512.png')

  // Refused at the app, she is told her invitation waits; the stranger is
  // told whose it is to grant, and sees nothing of the app.
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
  let page = await shut(dir, space, diary, 'ana', {})
  assertEquals(page.status, 403)
  assertStringIncludes(await page.text(), 'Your invitation is waiting')
  assertStringIncludes(
    await (await shut(dir, space, diary, 'bo', {})).text(),
    'Nothing here yet',
  )
  // Asked again, the owner hears she never accepted.
  assertStringIncludes(
    invitedWords({
      email: emailOf('ana'),
      role: 'editor',
      place: { space, app: diary },
      standing: true,
    }),
    'had not accepted yet',
  )

  // Her click, signed in as her, takes the invitation and writes her grant.
  assertEquals((await click('ana')).status, 303)
  assertMatch(JSON.stringify(applied), /"tombstone".*"grant".*"person":"ana"/)
})

test('the owner and their assistant see who is in and who has not accepted', async () => {
  let row = (
    held: Held['held'],
    person: string,
    role: Held['role'],
    on: string,
    sent: string | null = null,
  ): Held => ({ eid: `${person}/${on}`, held, on, person, role, sent })
  let dir = {
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
  let [here] = await peopleIn(dir, [space], [diary])
  let [bo, ana, cy] = ['bo', 'ana', 'cy'].map(emailOf)

  // The words name who has yet to accept, which is what someone may be
  // waiting on, and count the rest; the value names everyone.
  let said = aloud(here, JEFF).join('\n')
  assertStringIncludes(said, `${cy} (viewer of the whole space`)
  assertStringIncludes(said, 'letter sent 2026-10-14')
  assertStringIncludes(said, '2 other people')
  assert(!said.includes(bo) && !said.includes(ana))
  let emails = (them: Person[]) =>
    them.map((p) => shown(p)).map((p) => `${p.email} ${p.role}`)
  assert(emails(here.members).includes(`${bo} editor`))
  assertEquals(emails(here.invited), [`${cy} viewer`])
  assertEquals(emails(here.apps[0].guests), [`${ana} editor`])
  // Asked, the words name them too: everyone in the space, and whoever can
  // open the app.
  let named = aloud(here, JEFF, {}, true).join('\n')
  assertStringIncludes(named, `${bo} (editor)`)
  assertStringIncludes(named, `Guests of Diary: ${ana} (editor)`)

  // The People page lists all of them, and offers another letter to the one
  // who has not accepted.
  let page = people({ space: 'jeff', apps: [], people: here })
  for (let them of [ana, bo, cy]) assertStringIncludes(page, them)
  assertStringIncludes(page, 'not accepted yet')
  assertStringIncludes(page, 'name="again" value="cy/sp"')
})
