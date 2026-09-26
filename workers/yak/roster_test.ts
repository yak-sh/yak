// Every tool the connector lists, called once, in the order a person's work
// would call them: a space, an app, its files, a deploy, its data, its
// versions, its secrets, its mail, publishing it and installing it somewhere
// else, the money, a domain, and the trash. Each call asserts one fact about
// what came back. At the end the set of names called is compared with
// `tools/list`, so a tool added to the roster without a call here fails this
// test by name. That last assertion is the point of the module: the other
// mcp_*_test.ts files hold each subject at depth, and none of them notices a
// tool nobody exercises.
//
// Two ways to run it.
//
//   In memory (`deno task test`), against a kernel of its own and its
//   throwaway store, and everything runs, purchases included: the money
//   paths talk to Stripe's own sandbox with a test-mode key, never a
//   stand-in. Set these first, or the money steps fail naming them:
//
//     STRIPE_KEY                     a sandbox secret key, sk_test_… The
//                                    owner keeps one in 1Password at
//                                    op://Yak Shaving LLC/yaks.app stripe/
//                                    sandbox/secret key
//     STRIPE_PRICE                   optional: a recurring sandbox price. Left
//                                    out, one is found or made by name.
//     STRIPE_WEBHOOK_SECRET          optional: any string. Stripe cannot
//     STRIPE_CONNECT_WEBHOOK_SECRET  reach a loopback kernel, so the test
//                                    both signs the events and boots the
//                                    kernel with the secret it signed them
//                                    with; left out, a fresh one is minted.
//
//   Against a deployed kernel, which is how the same suite becomes the release
//   check:
//
//     YAK_PROBE_URL=https://yaks.app YAK_PROBE_TOKEN=<bearer> \
//       deno test -A --unstable-net workers/yak/roster_test.ts
//
//   The bearer is an ordinary OAuth token for a test account, an address on
//   the bot domain (lib/bots.ts), got the way a host gets one (probe.ts
//   `bearerFor`, or `yak admin throwaway` and then /oauth/allow). That run makes its own
//   scratch spaces, works only inside them, and erases them at the end; it
//   never touches a space it did not create. Nothing it did is left for a
//   person to see: a test account's feedback is kept and never mailed, and
//   its spaces are deleted without the confirmation letter a person's would
//   need. Both runs sign in as one, so both hold that. It buys nothing
//   either: a purchase against a deployed kernel would be a real
//   purchase, so `space_sell` and `domain_attach` are called there for the
//   refusal a free space gets, which is their other answer and worth holding.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import {
  attached,
  bearerFor,
  charged,
  connector,
  delivered,
  deployed,
  kernel,
  letters,
  num,
  signIn,
  stripeKey,
  subscribed,
  txt,
  vocabFile,
  WEBHOOK_SECRET,
} from './probe.ts'
import { HELLO } from './mcp-probe.ts'
import { BOT } from './lib/bots.ts'
import { GRAPH } from './mail-config.ts'
import { managePath } from './route.ts'
import { LISTING } from './published.ts'

let LIVE = Deno.env.get('YAK_PROBE_URL') ?? ''
let TOKEN = Deno.env.get('YAK_PROBE_TOKEN') ?? ''

// A short, unlikely label, since a deployed run shares one namespace with
// everybody else's spaces and apps.
let tag = () => crypto.randomUUID().slice(0, 8)

// The one page the app serves, the file that gives it words and commands of
// its own, and a sheet for store_load to read.
let PAGE = '<!doctype html><title>Notes</title><h1>Notes</h1>'
let VOCAB = vocabFile({ note: { body: txt, pages: num } }, {
  jot: {
    description: 'Write a note down',
    input: { body: txt, pages: num },
    required: ['body', 'pages'],
    apply: {
      entity: { eid: '$note' },
      note: { body: '$body', pages: '$pages' },
    },
  },
  jotted: { description: 'Every note so far', query: '.note' },
})
let SHEET = 'body,pages\nfrom a sheet,3\nand another,5\n'
// A secret lives on the app's own worker, so the app has one: the least worker
// that answers, which is all a secret needs in order to have somewhere to go.
let WORKER = "export default { fetch: () => new Response('ok') }"

// A tool called for the answer it gives when it will not do the thing: the
// refusal is a tool error, and its words are what a person reads.
let refused = async (
  tool: (name: string, args: Record<string, unknown>) => Promise<string>,
  name: string,
  args: Record<string, unknown>,
) => {
  try {
    return await tool(name, args)
  } catch (e) {
    return (e as Error).message
  }
}

Deno.test(
  'every tool the connector lists is called, and one with no call fails this',
  async () => {
    // Cloudflare's custom hostnames are stood in for even in memory: a
    // hostname attached for real would be written on the zone that serves
    // yaks.app, and a domain is a third party, not a purchase. Stripe is the
    // one third party this suite talks to for real.
    let k = LIVE ? deployed(LIVE) : await kernel()
    // Every space this run made and has not yet erased.
    let spaces: string[] = []
    try {
      // The credential, as a client holds one: a bearer, never a cookie.
      // In memory the person signs in first and walks the OAuth flow; a
      // deployed run is handed the token it will use.
      let cookie = LIVE ? '' : (await signIn(k, `probe-${tag()}${BOT}`)).cookie
      let bearer = LIVE ? TOKEN : await bearerFor(k, cookie)
      assert(bearer, 'set YAK_PROBE_TOKEN to a bearer for YAK_PROBE_URL')
      let agent = connector(k, undefined, bearer)

      // Every call, and the first line of what came back. The set is what the
      // coverage assertion reads; the lines are for a person reading a
      // release check, so they are printed only when asked for.
      let called = new Set<string>()
      let heard: string[] = []
      let tool = async (name: string, args: Record<string, unknown> = {}) => {
        called.add(name)
        let said = await agent.tool(name, args)
        heard.push(`${name}: ${said.split('\n')[0].slice(0, 90)}`)
        return said
      }

      // ---- the handshake ------------------------------------------------
      let init = await agent.call('initialize', HELLO)
      assertEquals(init.serverInfo.name, 'yaks.app')
      let listed = (await agent.call('tools/list')).tools as {
        name: string
      }[]
      assert(listed.length > 40, `a roster of ${listed.length}`)
      // What a directory published is what a client installed from it calls
      // (published.ts), so every name it listed is listed here still.
      let names = listed.map((t) => t.name)
      assertEquals(LISTING.tools.filter((n) => !names.includes(n)), [])

      // ---- what anybody may read ----------------------------------------
      assertStringIncludes(await tool('about'), 'yaks.app is a place')
      assertStringIncludes(await tool('guide', { page: 'home' }), '#')
      // Either answer is the tool working: what the words found, or the
      // sentence saying nothing does and where the whole gallery is.
      assertStringIncludes(
        await tool('gallery_search', { words: 'list' }),
        'list',
      )
      assertStringIncludes(
        await tool('app_published', { words: 'list' }),
        'list',
      )
      // One person may send three an hour, and this suite is run again and
      // again: the pause is as much the tool working as the keeping is. The
      // keeping is all it does for a test account — no letter goes anywhere.
      let sent = await refused(tool, 'feedback', {
        text: 'The roster suite says hello. Nothing to answer.',
      })
      assert(
        /is a test account|already this hour/.test(sent),
        `feedback: ${sent}`,
      )
      if (!LIVE) {
        assertEquals(
          letters(k, GRAPH).filter((l) => l.body.includes('roster suite says')),
          [],
          'no feedback letter went',
        )
      }

      // ---- a space, and a second one to install into ---------------------
      let mine = `roster-${tag()}`
      let theirs = `roster-${tag()}`
      let eids: Record<string, string> = {}
      for (let slug of [mine, theirs]) {
        let made = await tool('space_new', { slug, title: slug })
        assertStringIncludes(made, `space ${slug} (`)
        eids[slug] = /\(([0-9a-f-]{36})\)/.exec(made)![1]
        spaces.push(slug)
      }
      assertStringIncludes(
        await tool('space_set', { space: mine, title: 'Notes and things' }),
        'Notes and things',
      )

      // ---- an app, its files, its release --------------------------------
      let app = 'notes'
      assertStringIncludes(
        await tool('app_new', { space: mine, slug: app, title: 'Notes' }),
        `${mine}.yaks.app/${app}/`,
      )
      assertStringIncludes(
        await tool('app_files', {
          space: mine,
          app,
          files: [
            { path: 'index.html', content: PAGE },
            { path: 'vocab.json', content: VOCAB },
            { path: 'notes.csv', content: SHEET },
            { path: 'worker.js', content: WORKER },
          ],
        }),
        'index.html',
      )
      let released = await tool('app_deploy', { space: mine, app })
      assertStringIncludes(released, 'commands: jot, jotted')
      assertStringIncludes(released, 'components: note')

      // ---- the words the app brought with it -----------------------------
      assertStringIncludes(await tool('commands', { app }), 'jot(')
      assertStringIncludes(
        await tool('command', {
          app,
          name: 'jot',
          args: { body: 'by its own command', pages: 1 },
        }),
        'jot',
      )

      // ---- the generic tier ----------------------------------------------
      let wrote = await tool('graph_apply', {
        change: [{
          entity: { eid: '$note' },
          doc: { title: 'A marzipan note' },
          note: { body: 'lemon, and a little almond', pages: 2 },
        }],
      })
      let noted = (JSON.parse(wrote) as { entity: { eid: string } }[])[0].entity
        .eid
      assert(noted, wrote)
      assertStringIncludes(await tool('graph_query', { q: '.note' }), 'note')
      assertStringIncludes(await tool('graph_show', { ids: [noted] }), noted)
      assertStringIncludes(
        await tool('graph_schema', { component: 'note' }),
        'pages',
      )
      // Ranked search reads the properties the vocabulary marks searchable, of
      // which a title is always one.
      assertStringIncludes(await tool('search', { words: 'marzipan' }), noted)

      // ---- a sheet loaded, and the window it can be put back to -----------
      assertStringIncludes(
        await tool('store_load', {
          space: mine,
          app,
          path: 'notes.csv',
          as: 'note',
          map: { body: 'body', pages: 'pages' },
        }),
        'loaded 2 entities',
      )
      assertStringIncludes(
        await tool('store_restore', { space: mine, app }),
        'can be put back',
      )

      // ---- a second release, and the first one put back -------------------
      await tool('app_files', {
        space: mine,
        app,
        path: 'index.html',
        content: PAGE + '<p>and a second thought',
      })
      await tool('app_deploy', { space: mine, app })
      assertStringIncludes(
        await tool('app_versions', { space: mine, app }),
        'v2',
      )
      assertStringIncludes(
        await tool('app_rollback', { space: mine, app, version: 1 }),
        'back to v1',
      )

      // ---- what the app is, and what only its worker may read -------------
      assertStringIncludes(
        await tool('app_set', { space: mine, app, title: 'Notebook' }),
        'Notebook',
      )
      // A key the app's worker calls out with is a connection the person
      // connects on their own page; the agent only says one is needed.
      assertStringIncludes(
        await tool('connection_need', {
          space: mine,
          app,
          integration: 'roster',
          hosts: ['api.roster.example'],
        }),
        'env.ROSTER',
      )
      assertStringIncludes(
        await tool('connection_list', { space: mine }),
        'roster: needed',
      )
      // The secret tools the directory listed: a key the worker reads as
      // itself, or the sentence a runtime with no vault says instead.
      let kept = await refused(tool, 'app_secret_set', {
        space: mine,
        app,
        name: 'ROSTER_KEY',
        value: 'roster-value',
      })
      assert(
        kept.includes('ROSTER_KEY is set') || kept.includes("can't be saved"),
        kept,
      )
      assertStringIncludes(
        await tool('app_secret_list', { space: mine, app }),
        app,
      )
      assertStringIncludes(
        await tool('app_secret_remove', {
          space: mine,
          app,
          name: 'ROSTER_KEY',
        }),
        'ROSTER_KEY removed',
      )
      assert((await tool('app_errors', { space: mine, app })).length > 0)
      assertStringIncludes(await tool('app_list', { space: mine }), app)
      assert(
        (await tool('app_stats', { space: mine, app, days: 7 })).length > 0,
      )

      // ---- offered to everybody, and taken by somebody --------------------
      let offer = `roster-notes-${tag()}`
      assertStringIncludes(
        await tool('app_publish', {
          space: mine,
          app,
          name: offer,
          about: 'A probe app. Nothing here is real.',
        }),
        offer,
      )
      assertStringIncludes(await tool('app_published', { words: offer }), offer)
      assertStringIncludes(
        await tool('app_install', { space: theirs, name: offer, as: app }),
        offer,
      )
      await tool('app_deploy', { space: mine, app })
      assertStringIncludes(
        await tool('app_update', { space: theirs, app }),
        `${theirs}/${app}`,
      )
      assertStringIncludes(
        await tool('app_unpublish', { space: mine, app }),
        offer,
      )

      // ---- who else this is for -------------------------------------------
      let guest = `roster-guest-${tag()}@probe.invalid`
      assertStringIncludes(
        await tool('member_add', { space: mine, email: guest, role: 'editor' }),
        guest,
      )
      assertStringIncludes(
        await tool('member_remove', { space: mine, email: guest }),
        guest,
      )

      // ---- the app's own post room ----------------------------------------
      assertStringIncludes(
        await tool('mail_send', {
          space: mine,
          app,
          to: 'nobody@probe.invalid',
          title: 'A letter from the roster suite',
          body: 'Nothing to answer.',
        }),
        'A letter from the roster suite',
      )
      assertStringIncludes(
        await tool('mail_list', { space: mine, app }),
        'A letter from the roster suite',
      )

      // ---- what the person said -------------------------------------------
      let said = `the roster suite ran at ${new Date().toISOString()}`
      assertStringIncludes(
        await tool('memory_save', { said, space: mine }),
        said,
      )
      assertStringIncludes(
        await tool('memory_recall', { words: 'roster suite', space: mine }),
        'roster',
      )

      // ---- the terminal's own credential -----------------------------------
      let granted = await tool('grant', { hours: 1, space: mine })
      let token = /^yak login (\S+)$/m.exec(granted)?.[1] ?? ''
      assert(token, granted)
      assertStringIncludes(
        await connector(k, undefined, token).tool('about'),
        'signed in as',
      )
      let id = /revoke (\w+)\./.exec(granted)?.[1] ?? ''
      assert(id, granted)
      await tool('grant', { revoke: id })

      // ---- the builder's workbench ------------------------------------------
      // A container engine is not a thing a test suite may require, and a
      // deployed kernel has one. Either answer is the tool working: the box
      // did the thing, or it said in a sentence that there is no box here.
      let box = async (
        name: string,
        args: Record<string, unknown>,
        fact: string,
      ) => {
        let out = await refused(tool, name, { space: mine, ...args })
        assert(
          out.includes(fact) || out.includes('No sandbox is running here'),
          `${name}: ${out}`,
        )
      }
      await box(
        'sandbox_write',
        { path: 'hello.txt', content: 'from the roster suite' },
        'hello.txt',
      )
      await box(
        'sandbox_read',
        { path: 'hello.txt' },
        'from the roster suite',
      )
      await box('sandbox_shell', { command: 'echo hello' }, 'hello')
      await box('sandbox_exec', { cmd: 'echo listed' }, 'listed')
      await box('sandbox_wait', { process: 'none' }, 'no such process')
      await box('sandbox_stop', { process: 'none' }, 'no such process')
      await box('sandbox_ship', { app, paths: ['hello.txt'] }, 'hello.txt')

      // ---- the trash, and back out of it -------------------------------------
      assertStringIncludes(
        await tool('app_delete', { space: theirs, app }),
        'trash',
      )
      assertStringIncludes(
        await tool('app_restore', { space: theirs, app }),
        app,
      )

      // ---- the money -----------------------------------------------------------
      // A deployed kernel is a real Stripe account, so nothing here buys
      // anything there: the free space's refusal is what both tools answer,
      // and it is the answer that keeps a person from being charged by a
      // mistake. In memory the sandbox is reachable and the whole path
      // runs — a checkout completed with Stripe's test card, the subscription
      // Stripe then holds, the webhook, Plus, and a domain on the far side of
      // the gate that only Plus opens.
      if (LIVE) {
        assertStringIncludes(
          await refused(tool, 'space_sell', { space: mine }),
          'Plus',
        )
        assertStringIncludes(
          await refused(tool, 'domain_attach', {
            space: mine,
            hostname: `${mine}.probe.invalid`,
          }),
          'Plus',
        )
        assertStringIncludes(
          await tool('domain_status', { space: mine }),
          mine,
        )
        assertStringIncludes(
          await refused(tool, 'domain_detach', {
            space: mine,
            hostname: `${mine}.probe.invalid`,
          }),
          `${mine}.probe.invalid`,
        )
      } else {
        let key = stripeKey()
        // Checkout is a page, not a call: the door mints the session and a
        // browser finishes it with the card Stripe documents for exactly this.
        let door = await k.at('yaks.app', managePath('billing', mine), {
          method: 'POST',
          headers: { cookie, origin: 'https://yaks.app' },
          // The object, not its text: a form body is what the door reads,
          // and fetch writes the content type for one.
          body: new URLSearchParams({ billing: 'checkout' }),
        })
        assertEquals(door.status, 200, await door.clone().text())
        let { url } = await door.json() as { url: string }
        let session = /cs_test_[A-Za-z0-9]+/.exec(url)?.[0] ?? ''
        assert(session, `no checkout session in ${url}`)
        assertStringIncludes(url, 'https://checkout.stripe.com/')
        // Where a person types the card is Stripe's own page, which no test
        // can drive, so the card goes in the way the API puts it (probe.ts
        // `subscribed`) on the very customer this session was opened for.
        let held = await charged(key, `/v1/checkout/sessions/${session}`)
        let customer = String(held.customer ?? '')
        assert(customer, 'the session names the customer it is for')
        let sub = await subscribed(
          k,
          key,
          { space: eids[mine], slug: mine },
          customer,
        )
        assertEquals(sub.status, 'active', 'Stripe took the payment')
        // The hop Stripe cannot make to a loopback runtime.
        assertStringIncludes(
          await delivered(
            k,
            '/stripe/webhook',
            WEBHOOK_SECRET,
            'customer.subscription.updated',
            sub,
          ),
          'plus',
        )

        // Selling is the other Stripe account: the tool mints a connected
        // account at Stripe and hands back Stripe's own onboarding link. The
        // link is where a person proves who they are, which no test can do
        // for them — so what is held here is that the account exists at
        // Stripe, is this space's, and that the platform says so.
        let sell = await tool('space_sell', { space: mine })
        let link = /https:\/\/connect\.stripe\.com\/\S+/.exec(sell)?.[0] ?? ''
        assert(link, sell)
        let account = await charged(key, '/v1/accounts?limit=1') as unknown as {
          data: { id: string; metadata: Record<string, string> }[]
        }
        assertEquals(account.data[0].metadata.slug, mine)
        // And the event a connected account's changes arrive on finds this
        // space by that account id. Nobody has been through the identity
        // form, so Stripe says the account cannot take money yet — which is
        // what the space was already told when the account was made, so the
        // door's answer is that nothing moved. A door that had not found the
        // space would say so instead.
        let heardIt = await delivered(
          k,
          '/stripe/connect',
          WEBHOOK_SECRET,
          'account.updated',
          await charged(key, `/v1/accounts/${account.data[0].id}`),
          account.data[0].id,
        )
        assert(
          /unchanged|cannot sell/.test(heardIt),
          `the connect door: ${heardIt}`,
        )
        // The sandbox keeps what a test made unless it is deleted.
        await charged(
          key,
          `/v1/accounts/${account.data[0].id}`,
          undefined,
          undefined,
          'DELETE',
        )

        // A domain is the thing Plus opens, so it is proved on the far side
        // of the purchase and nowhere else.
        let host = `${mine}.probe.invalid`
        assertStringIncludes(
          await tool('domain_attach', { space: mine, hostname: host }),
          `${host} is attached to ${mine}.`,
        )
        assertStringIncludes(await tool('domain_status', { space: mine }), host)
        assertStringIncludes(
          await tool('domain_detach', { space: mine, hostname: host }),
          `${host} is detached`,
        )
        assert(!await attached(k, host), 'the hostname went back to Cloudflare')

        // And cancelled, the way the person would, so the space is one a
        // delete may take: a paying space is refused (erase.ts `refused`).
        let ended = await charged(
          key,
          `/v1/subscriptions/${sub.id}`,
          undefined,
          undefined,
          'DELETE',
        )
        assertEquals(ended.status, 'canceled')
        await delivered(
          k,
          '/stripe/webhook',
          WEBHOOK_SECRET,
          'customer.subscription.deleted',
          ended,
        )
      }

      // ---- the trash, a space's turn, and gone ------------------------------
      // A space only test accounts are in is nobody's work, so there is no
      // letter to wait for: the trash, back out of it, and erased for good.
      assertStringIncludes(
        await tool('space_delete', { space: theirs }),
        `${theirs}.yaks.app is in the trash`,
      )
      assertStringIncludes(
        await tool('space_restore', { space: theirs }),
        `${theirs} is back`,
      )
      for (let space of [...spaces]) {
        assertStringIncludes(
          await tool('space_delete', { space, forever: true }),
          `${space}.yaks.app is gone`,
        )
        spaces.splice(spaces.indexOf(space), 1)
      }

      // ---- and the assertion this module exists for -------------------------
      if (Deno.env.get('YAK_PROBE_TRACE')) console.log(heard.join('\n'))
      let missed = listed.map((t) => t.name).filter((n) => !called.has(n))
      assertEquals(
        missed,
        [],
        `listed and never called: ${missed.join(', ')} — every tool on the ` +
          'roster gets a call here, or this suite is not the coverage it claims',
      )
    } finally {
      // Whatever a failure left standing, erased: a deployed run shares its
      // namespace with everybody's work, so it leaves nothing of its own.
      if (LIVE) {
        let agent = connector(k, undefined, TOKEN)
        for (let space of spaces) {
          await agent.tool('space_delete', { space, forever: true })
            .catch(() => {/* already gone */})
        }
      }
      await k.stop()
    }
  },
)
