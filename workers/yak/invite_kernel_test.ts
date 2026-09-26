// An invitation is nothing until its person accepts it (invite.ts, T-37880).
// Before T-37880 `member_add` wrote the seat outright, so naming a stranger's
// address put the inviter's space in the stranger's listing, their agent's
// instructions, and behind a bare app name their agent would say.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { SUBJECT } from './invite.ts'
import {
  accepted,
  clickInvite,
  connector,
  kernel,
  letter,
  meta,
  signIn,
} from './probe.ts'
import { HELLO } from './mcp-probe.ts'

Deno.test('an invitation reaches nobody until its person accepts it', async () => {
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
