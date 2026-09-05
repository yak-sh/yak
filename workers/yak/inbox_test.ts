// A letter, all the way in, held in workerd (T-33687): the runtime's own email
// door hands the message to `email()` (index.ts), which files it in the store
// its address named (inbox.ts). The probe posts raw RFC 5322 the way Cloudflare
// hands one over — the envelope on the query string, the letter in the body —
// so what is exercised here is the whole path, address to row.
//
// The rules this holds:
//   an app's address    `<space>.<app>@yaks.app` lands in THAT app's store
//   the home app        `<space>@yaks.app` lands in the space's front page
//   a stranger's word    the letter is DATA — `mail.from` is a column, the
//                        writer is nobody, and an unsigned letter is recorded
//                        with `verified: false` rather than dropped
//   attachments          filed where a page's upload is, hung off the letter
//   nobody home          refused, so the sender is told, and nothing written
//   the app hears it     a page subscribed to its own store sees the letter
//                        arrive without asking
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow, until } from '../../src/testing.ts'
import {
  arrives,
  browser,
  client,
  connector,
  kernel,
  relay,
  rfc822,
  seed,
} from './probe.ts'

type Row = {
  kind: string
  entity: { eid: string }
  doc: { title: string; body?: string }
  // `verified` is a boolean column, which SQLite holds as 1 and 0.
  mail: { from: string; to: string; at: string; verified?: number | null }
  attachment: { mime: string; name: string }
}

// A signed letter, as the receiving MTA hands one over: the verdict is a
// header it wrote, and the parser's own words are what a person reads.
let signed = (dkim: 'pass' | 'fail') =>
  `mx.yaks.app; dkim=${dkim} header.i=@books.example; spf=pass`

slow('a letter lands in the app its address named', async () => {
  let k = await kernel()
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-inbox-' })
  let them = await seed(k, [{ slug: 'jeff', apps: ['recipes', 'garden'] }])
  let mine = browser(k, 'jeff.yaks.app', them.cookie)
  let wire = relay(k, 'jeff.yaks.app', them.cookie)
  let stop = () => {}
  try {
    // The page's own client, so the socket half is the one an app really uses.
    let source = await (await k.at('jeff.yaks.app', '/recipes/api/client.js'))
      .text()
    Deno.writeTextFileSync(`${dir}/client.js`, source)
    let mod = await import(`file://${dir}/client.js`)
    let seen: Row[][] = []
    stop = mod.store(`${wire.origin}/recipes/api/`)
      .subscribe('.mail!&.doc?', (rows: Row[]) => seen.push(rows))
    await until(() => seen.length == 1, { timeout: 15_000 })
    assertEquals(seen[0], [])

    // One letter, to the app's own address. The envelope sender is a relay's
    // bounce address, as it is in life; the author is the From header.
    let landed = await arrives(k, {
      from: 'bounces@relay.example',
      to: 'jeff.recipes@yaks.app',
      raw: rfc822({
        From: 'Ana <ana@books.example>',
        To: 'jeff.recipes@yaks.app',
        Subject: 'Bring a dish',
        Date: 'Tue, 27 Aug 2024 08:49:44 -0700',
        'Authentication-Results': signed('pass'),
        'Content-Type': 'text/plain; charset="utf-8"',
      }, 'Potluck Friday. Bring a dish.'),
    })
    assertEquals(landed.status, 200)

    // The app hears it arrive: a page watching its own store is told, the
    // same way it is told about a write from another tab.
    await until(() => seen.length == 2, { timeout: 15_000 })
    let [letter] = seen[1]
    assertEquals(letter.kind, 'mail')
    assertEquals(letter.doc.title, 'Bring a dish')
    assertEquals(letter.doc.body, 'Potluck Friday. Bring a dish.')
    assertEquals(letter.mail.from, 'ana@books.example')
    assertEquals(letter.mail.to, 'jeff.recipes@yaks.app')
    assertEquals(letter.mail.at, '2024-08-27T15:49:44.000Z')
    // A boolean column is an integer in SQLite, here as everywhere on this
    // platform (@yaks/sqlite `write`): the verdict reads back 1 and 0.
    assertEquals(letter.mail.verified, 1)

    // Nobody wrote it: the sender is a column and never an actor, so a letter
    // cannot put words in a member's mouth.
    let [byline] = await client(k, 'jeff.yaks.app', 'recipes', them.cookie)
      .get('.mail!&.created!') as unknown as { created: { by: unknown } }[]
    assertEquals(byline.created.by, null)

    // The other app in the space has its own address and its own store: the
    // letter above is nowhere in it.
    let garden = client(k, 'jeff.yaks.app', 'garden', them.cookie)
    assertEquals(await garden.get('.mail!'), [])
    assertEquals(
      (await arrives(k, {
        from: 'ana@books.example',
        to: 'jeff.garden@yaks.app',
        raw: rfc822({ Subject: 'Tomatoes are in' }, 'Come and take some.'),
      })).status,
      200,
    )
    let [tomatoes] = await garden.get('.mail!&.doc?') as unknown as Row[]
    assertEquals(tomatoes.doc.title, 'Tomatoes are in')
    // No `Authentication-Results` at all: nobody checked, which is not the
    // same as a check that failed, so the column is left unwritten — null on
    // the row, where a failed check is 0.
    assertEquals(tomatoes.mail.verified, null)

    // The space's own name is its front page's address — the app it made its
    // front page, since being the first app claims nothing (apps.ts).
    await connector(k, them.cookie)
      .tool('app_set', { space: 'jeff', app: 'recipes', home: true })
    assertEquals(
      (await arrives(k, {
        from: 'ana@books.example',
        to: 'jeff@yaks.app',
        raw: rfc822({ Subject: 'To the front page' }, 'Hello in there.'),
      })).status,
      200,
    )
    let titles = (rows: Row[]) => rows.map((r) => r.doc.title).sort()
    let recipes = client(k, 'jeff.yaks.app', 'recipes', them.cookie)
    await until(
      async () =>
        titles(await recipes.get('.mail!&.doc?') as unknown as Row[]).includes(
          'To the front page',
        ),
      { timeout: 15_000 },
    )

    // An unsigned letter is RECORDED, not dropped: the verdict rides the row
    // and the reader decides what it is worth.
    assertEquals(
      (await arrives(k, {
        from: 'spoof@relay.example',
        to: 'jeff.recipes@yaks.app',
        raw: rfc822({
          From: 'Ana <ana@books.example>',
          Subject: 'Nobody signed for this',
          'Authentication-Results': signed('fail'),
        }, 'Wire me money.'),
      })).status,
      200,
    )
    let unsigned = await recipes
      .get('.mail.verified=0&.doc?') as unknown as Row[]
    assertEquals(titles(unsigned), ['Nobody signed for this'])

    // An attachment is filed where a page's upload is (apps.ts `filed`) and
    // hung off the letter, so a reader finds it from the letter.
    assertEquals(
      (await arrives(k, {
        from: 'ana@books.example',
        to: 'jeff.recipes@yaks.app',
        raw: rfc822(
          {
            Subject: 'The list',
            'Content-Type': 'multipart/mixed; boundary="b1"',
          },
          [
            '--b1',
            'Content-Type: text/plain',
            '',
            'It is attached.',
            '--b1',
            'Content-Type: text/csv',
            'Content-Disposition: attachment; filename="list.csv"',
            'Content-Transfer-Encoding: base64',
            '',
            btoa('dish,who\nsoup,ana\n'),
            '--b1--',
            '',
          ].join('\r\n'),
        ),
      })).status,
      200,
    )
    let file = await until(async () => {
      let [row] = await recipes.get('.attachment!') as unknown as Row[]
      return row
    }, { timeout: 15_000 })
    assertEquals(file.attachment.name, 'list.csv')
    assertEquals(file.attachment.mime, 'text/csv')
    let [held] = await recipes
      .get('.doc.title=The list&.doc!') as unknown as Row[]
    assertEquals(held.doc.body, 'It is attached.')
    let links = await recipes.get(
      '.edge.from=' + held.entity.eid,
    ) as unknown as { edge: { to: string } }[]
    assertEquals(links.map((l) => l.edge.to), [file.entity.eid])
  } finally {
    stop()
    await wire.stop()
    mine.stop()
    Deno.removeSync(dir, { recursive: true })
    await k.stop()
  }
})

slow(
  'an address nobody answers at is refused, and nothing is written',
  async () => {
    let k = await kernel()
    try {
      await seed(k, [{ slug: 'jeff', apps: ['recipes'] }, {
        slug: 'bare',
        apps: [],
      }])
      let no = async (to: string) => {
        let r = await arrives(k, {
          from: 'ana@books.example',
          to,
          raw: rfc822({ Subject: 'Anyone there?' }, 'Hello?'),
        })
        assertEquals(r.status, 400)
        return await r.text()
      }
      // A space nobody has taken, an app that space does not have, and a local
      // part that is no address of ours at all.
      assertStringIncludes(await no('nobody@yaks.app'), 'no mailbox')
      assertStringIncludes(await no('jeff.nothere@yaks.app'), 'no mailbox')
      assertStringIncludes(await no('jeff.recipes.old@yaks.app'), 'no mailbox')
      // A space whose address is spelled right and has nothing behind it is told
      // apart from a typo: the sender is told where to write instead.
      let bare = await no('bare@yaks.app')
      assertStringIncludes(bare, 'no front page')
      assertStringIncludes(bare, 'bare.<app>@yaks.app')
      // Nothing landed anywhere: a refusal writes no row.
      let rows = await client(k, 'jeff.yaks.app', 'recipes').get('.mail!')
      assertEquals(rows, [])
      assert(true)
    } finally {
      await k.stop()
    }
  },
)
