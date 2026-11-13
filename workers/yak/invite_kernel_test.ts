// An invitation is nothing until its person accepts it (invite.ts, T-37880).
// Before T-37880 `member_add` wrote the seat outright, so naming a stranger's
// address put the inviter's space in the stranger's listing, their agent's
// instructions, and behind a bare app name their agent would say.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { SUBJECT } from './invite.ts'
import {
  accepted,
  clickInvite,
  connector,
  type Kernel,
  kernel,
  letter,
  letters,
  meta,
  signIn,
} from './probe.ts'
import { HELLO } from './mcp-probe.ts'
import { managePath } from '@yaks/platform/routes'

// What others shared with a person, as their browser opens it.
let sharedPage = (k: Kernel, cookie: string) =>
  k.at(k.host, managePath('shared'), { headers: { cookie } })
    .then((r) => r.text())

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

    // A browser signed in as nobody, or as somebody else, accepts nothing on
    // opening the link: it is shown the press that signs in as the address
    // the letter went to, and told what the letter told, who invited them to
    // what, and no more: the note stays in the letter.
    for (let cookie of [undefined, jeff.cookie]) {
      let page = await clickInvite(k, ana.email, cookie)
      assertEquals(page.status, 200)
      let said = await page.text()
      assertStringIncludes(said, ana.email)
      assertStringIncludes(said, `${mine} invited you to use`)
      assertStringIncludes(said, `${mine}.yaks.app`)
      assert(!said.includes('please look'))
      assertStringIncludes(said, 'action="/invite"')
    }
    // Signed in as somebody else, they are asked which account.
    assertStringIncludes(
      await (await clickInvite(k, ana.email, jeff.cookie)).text(),
      `Stay as ${jeff.email}`,
    )
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
      await sharedPage(k, ana.cookie),
      `href="https://${mine}.yaks.app/notes/"`,
    )
    // The letter's link still takes her there after it has been used.
    assertEquals(
      await accepted(k, ana.email, ana.cookie),
      `https://${mine}.yaks.app/`,
    )

    // The letter spent none of his space's monthly emails (T-131892).
    let [row] = await meta(k).query(
      `.space.slug=${mine}&?meter`,
    ) as { meter?: { emails?: number } }[]
    assertEquals(row.meter?.emails ?? 0, 0)

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
  path: string,
  fields: Record<string, string>,
) =>
  k.at(k.host, path, {
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
    let roster = managePath('people', jeff.email.split('@')[0])
    let page = (q = '') =>
      k.at(k.host, `${roster}${q}`, { headers: { cookie: jeff.cookie } })
        .then((r) => r.text())
    assertStringIncludes(await page(), 'Send invitation')

    let ana = await signIn(k)
    let sent = await post(k, jeff.cookie, roster, {
      invite: ana.email,
      app: 'notes',
      role: 'viewer',
      note: 'have a look',
    })
    assertEquals(sent.status, 303)
    let back = new URL(sent.headers.get('location')!)
    assertEquals(back.pathname, roster)
    let l = await letter(k, ana.email, '/invite?t=')
    assertStringIncludes(l.body, '> have a look')
    let listed = await page(back.search)
    assertStringIncludes(listed, 'Invitation sent.')
    assertStringIncludes(listed, 'Notes · this app only')
    assertStringIncludes(listed, `${ana.email} · viewer · `)

    // Withdrawn from its row, the invitation is gone from the page.
    let gone = await post(k, jeff.cookie, roster, {
      remove: ana.email,
      app: 'notes',
    })
    assertEquals(gone.status, 303)
    let after = await page(new URL(gone.headers.get('location')!).search)
    assertStringIncludes(after, 'Removed.')
    assert(!after.includes(ana.email))

    // A member who accepted is taken off the same way.
    let bo = await signIn(k)
    await post(k, jeff.cookie, roster, { invite: bo.email })
    await accepted(k, bo.email, bo.cookie)
    assertStringIncludes(await page(), `aria-label="Remove ${bo.email}"`)
    await post(k, jeff.cookie, roster, { remove: bo.email })
    assert(!(await page()).includes(bo.email))
    assert(
      !(await connector(k, bo.cookie).tool('app_list')).includes('notes'),
    )

    // Refused, the page says why and the address is still in the field.
    let refused = await post(k, jeff.cookie, roster, {
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

// The letter's link proves its address, as a sign-in letter's does
// (T-162634): one press signs a newcomer to yaks.app in and opens what was
// shared, with no code, and the link does it once.
test('pressing accept on the letter signs its person in and opens the app', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let his = connector(k, jeff.cookie)
    let mine = jeff.email.split('@')[0]
    await his.tool('app_new', { slug: 'notes', title: 'Notes' })
    let cara = `cara-${crypto.randomUUID().slice(0, 8)}@${k.host}`
    await his.tool('member_add', { email: cara, app: 'notes' })
    let l = await letter(k, cara, '/invite?t=')
    assertStringIncludes(l.body, `signs you in as ${cara}`)
    let t = new URL(/https:\/\/\S+\/invite\?t=\S+/.exec(l.body)![0])
      .searchParams.get('t')!
    let press = () =>
      k.at(k.host, '/invite', {
        method: 'POST',
        redirect: 'manual',
        body: new URLSearchParams({ t }),
      })

    let pressed = await press()
    await pressed.body?.cancel()
    assertEquals(pressed.status, 303)
    assertEquals(
      pressed.headers.get('location'),
      `https://${mine}.yaks.app/notes/`,
    )
    let cookie = (pressed.headers.get('set-cookie') ?? '').split(';')[0]
    assert(cookie, 'the press set a session')
    await k.deliveries?.()
    assertStringIncludes(
      await sharedPage(k, cookie),
      `href="https://${mine}.yaks.app/notes/"`,
    )
    // No code letter went: the invitation is the only letter she has.
    assertEquals(
      (await letters(k, cara)).filter((x) => /\d{6}/.test(x.subject)),
      [],
    )

    // Pressed again, signed out, it signs nobody in.
    let again = await press()
    await again.body?.cancel()
    assertEquals(again.status, 410)
    assertEquals(again.headers.get('set-cookie'), null)
  } finally {
    await k.stop()
  }
})
