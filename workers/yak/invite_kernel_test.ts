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
  kernel,
  letter,
  letters,
  meta,
  signIn,
} from './probe.ts'
import { HELLO } from './mcp-probe.ts'
import type { Listed } from './tools.ts'

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
    // it is asked to sign in as the address the letter went to.
    for (let cookie of [undefined, jeff.cookie]) {
      let page = await clickInvite(k, ana.email, cookie)
      assertEquals(page.status, 200)
      assertStringIncludes(await page.text(), ana.email)
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

test('a friend who has not accepted is told the invitation waits', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let his = connector(k, jeff.cookie)
    let host = `${jeff.email.split('@')[0]}.yaks.app`
    await his.tool('app_new', {
      slug: 'diary',
      title: 'Diary',
      access: 'private',
    })
    await his.tool('app_files', {
      app: 'diary',
      files: [{ path: 'index.html', content: '<h1>Diary</h1>' }],
    })
    await his.tool('app_deploy', { app: 'diary' })
    let [ana, bo] = [await signIn(k), await signIn(k)]
    await his.tool('member_add', { email: ana.email, app: 'diary' })

    let page = (cookie: string) =>
      k.at(host, '/diary/', { headers: { cookie } }).then((r) => r.text())
    let write = (cookie: string) =>
      k.at(host, '/diary/api/apply', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ entities: [{ doc: { title: 'hi' } }] }),
      }).then((r) => r.text())
    assertStringIncludes(await page(ana.cookie), 'Your invitation is waiting')
    assertStringIncludes(await write(ana.cookie), 'invitation to this app')
    // Somebody nobody invited learns nothing about the app.
    assertStringIncludes(await page(bo.cookie), 'Nothing here yet')
    assert(!(await write(bo.cookie)).includes('invitation'))
    // Asked again, the owner hears she never accepted.
    assertStringIncludes(
      await his.tool('member_add', { email: ana.email, app: 'diary' }),
      'had not accepted yet',
    )

    await accepted(k, ana.email, ana.cookie)
    assertStringIncludes(await page(ana.cookie), '<h1>Diary</h1>')
  } finally {
    await k.stop()
  }
})

test('the owner and their assistant see who is in and who has not accepted', async () => {
  let k = await kernel()
  try {
    let jeff = await signIn(k)
    let his = connector(k, jeff.cookie)
    await his.tool('app_new', { slug: 'diary', title: 'Diary' })
    let [ana, bo, cy] = [await signIn(k), await signIn(k), await signIn(k)]
    await his.tool('member_add', { email: ana.email, app: 'diary' })
    await his.tool('member_add', { email: bo.email })
    await his.tool('member_add', { email: cy.email, role: 'viewer' })
    await accepted(k, ana.email, ana.cookie)
    await accepted(k, bo.email, bo.cookie)
    let today = new Date().toISOString().slice(0, 10)

    // The words name who has yet to accept, which is what someone may be
    // waiting on, and count the rest; the value names everyone.
    let listed = await his.answer('app_list')
    assertStringIncludes(listed.text, `${cy.email} (viewer`)
    assertStringIncludes(listed.text, `letter sent ${today}`)
    assertStringIncludes(listed.text, '2 other people')
    assert(!listed.text.includes(bo.email) && !listed.text.includes(ana.email))
    let [space] = (listed.value as { spaces: Listed[] }).spaces
    let emails = (them?: { email: string | null; role: string }[]) =>
      them?.map((p) => `${p.email} ${p.role}`)
    assert(emails(space.members)!.includes(`${bo.email} editor`))
    assertEquals(emails(space.invited), [`${cy.email} viewer`])
    assertEquals(emails(space.apps[0].guests), [`${ana.email} editor`])
    // A member reads the apps, not who else was let in.
    let bos = await connector(k, bo.cookie).answer('app_list')
    assert(!bos.text.includes(cy.email) && !bos.text.includes(ana.email))
    let jeffs = (bos.value as { spaces: Listed[] }).spaces
      .find((s) => s.slug == space.slug)!
    assert(!jeffs.members && !jeffs.invited && !jeffs.apps[0].guests)

    let page = await k.at('yaks.app', '/manage/people', {
      headers: { cookie: jeff.cookie },
    }).then((r) => r.text())
    for (let them of [ana, bo, cy]) assertStringIncludes(page, them.email)
    assertStringIncludes(page, 'not accepted yet')
    let eid = /name="again" value="([^"]+)"/.exec(page)![1]
    let before = letters(k, cy.email).length
    let again = await k.at('yaks.app', '/manage/people', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: jeff.cookie,
        origin: 'https://yaks.app',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ again: eid }),
    })
    await again.body?.cancel()
    assertEquals(again.status, 303)
    await letter(k, cy.email, '/invite?t=', before)
    let back = new URL(again.headers.get('location')!)
    assertStringIncludes(
      await k.at('yaks.app', back.pathname + back.search, {
        headers: { cookie: jeff.cookie },
      }).then((r) => r.text()),
      'Sent again.',
    )
  } finally {
    await k.stop()
  }
})
