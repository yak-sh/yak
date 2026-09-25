// The implementations behind the `admin` tools in ./vocab.json, exported as
// `@yaks/admin/tools`: the owner's verbs on yaks.app, as tools of the graph
// this box's `yak` opens.
//
//   yak admin throwaway            sign in as a throwaway @bot.yak.sh account
//   yak admin whoami               the account, its spaces, and its role in each
//   yak admin link                 a standing sign-in link for that account
//   yak admin tool app_list        any connector tool, as that account
//   yak admin query jeff/recipes .doc    an app's store, through the filter grammar
//   yak admin client google <id> <secret> --admin   keep an OAuth client, from 1Password
//
// The one rule these verbs are shaped around: A TEST ACCOUNT IS THE DEFAULT AND
// EVERY OTHER ACCOUNT IS A NAMED ACT. No chain of defaults arrives at one —
// reaching the owner's takes `--owner` and reaching the platform's admin takes
// `--admin` on that command line, and every command that runs as either wears
// a banner on stderr (./accounts.ts). `--admin` is what an agent uses for a
// platform act, so the act is recorded as the admin and not as Jeff (D-35373).
//
// Sessions are secrets (@yaks/secrets) in this graph: a verb that signs in or
// out answers the sealed session beside its words, so the write that records
// the call is the write that keeps it, and the vault beside the database is
// where it is read back from. A `@bot.yak.sh` sign-in code is read out of this
// graph too, where @yaks/mail files the letter.
//
// The platform verbs (deploys, errors, tail, rollback, revert) act on this
// checkout and this box's Cloudflare and GitHub logins (errors reads with the
// read-only token this graph's vault keeps, ./logs.ts), and print as they go:
// a tail runs until it is interrupted, and a revert reports each step of a
// wait that can take twenty minutes.

import { fileURLToPath } from 'node:url'
import { argsOf, type Bundle, type Graph } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import {
  isOpRef,
  type Local,
  opRead,
  reveal,
  sealed,
  unsealed,
} from '@yaks/secrets'
import { CallError } from '@yaks/tools'
import { ADMIN, BOT, isTestAddress } from '../../workers/yak/lib/bots.ts'
import {
  type Account,
  accountsIn,
  banner,
  choose,
  current,
  isAdmin,
  isTest,
  named,
  pick,
  Refused,
  render,
  sessionName,
  throwaway,
  usable,
} from './accounts.ts'
import {
  askCode,
  claimsOf,
  close,
  codeFor,
  doomedIn,
  feeNow,
  keepClient,
  linkFor,
  renewing,
  rpc,
  saidBy,
  setFee,
  spendCode,
  storeQuery,
  unlink,
  zone,
} from './api.ts'
import { deploys, rollback, table } from './deploys.ts'
import { errors, OBSERVABILITY, tail } from './logs.ts'
import { revert } from './revert.ts'

type Args = Record<string, unknown>

let word = (a: Args, name: string): string | undefined =>
  typeof a[name] == 'string' ? a[name] as string : undefined

let json = (v: unknown) => JSON.stringify(v, null, 2)

let out = (line: string) => console.log(line)
let note = (line: string) => console.error(line)

// What a verb says, as the call's answer.
let said = (call: Bundle, lines: string | string[]): Bundle => ({
  entity: { eid: '$said' },
  content: { body: typeof lines == 'string' ? lines : lines.join('\n') },
  output: { source: call.entity.eid },
})

// WHO this call runs as, and the mark it wears when the answer is somebody
// else's own account. Every verb that touches the platform as an account goes
// through here. A session the platform renews on the way (./api.ts
// `renewing`) is kept under the same account, in the same write as the
// answer: a box that kept the old value would sign out ninety days after its
// first sign-in however often it called.
let acting = (
  vault: Local,
  a: Args,
  keep: Bundle[],
  state: string,
): Account => {
  let at = pick(accountsIn(vault), {
    as: word(a, 'as'),
    owner: a.owner === true,
    admin: a.admin === true,
    current: current(state),
  })
  if (!isTest(at)) note(banner(at))
  renewing((fresh) => keep.push(sealed(sessionName(at.address), fresh)))
  return at
}

// Sign in end to end, answering the session sealed under its account. A
// `@bot.yak.sh` code comes back as a letter in this graph; anyone else's is in
// their own mail, so it is asked for rather than guessed at.
let signIn = async (
  graph: Graph,
  address: string,
  given: string | undefined,
  state: string,
): Promise<Bundle> => {
  let since = Date.now()
  await askCode(address)
  let code = given ??
    (address.endsWith(BOT)
      ? await waited(graph, address, since)
      : await asked(address))
  let session = await spendCode(address, code)
  // Only a throwaway is ever remembered as the default (./accounts.ts) — the
  // admin wears a bot address and is still not one.
  if (isTestAddress(address)) choose(address, state)
  return sealed(sessionName(address), session)
}

let waited = (graph: Graph, address: string, since: number) => {
  note(`waiting for the code to reach the graph for ${address}…`)
  return codeFor((q) => graph.read(q), address, since)
}

let asked = async (address: string) => {
  note(`a code was mailed to ${address}. paste it here:`)
  let buf = new Uint8Array(64)
  let n = await Deno.stdin.read(buf)
  let typed = new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim()
  if (!/^\d{6}$/.test(typed)) {
    throw new CallError('code', `not a six-digit code: ${typed}`)
  }
  return typed
}

// What this account HAS, as the connector says it: one `app_list`, whose
// answer is the listing a person reads — every space, the caller's own role in
// each (the directory's fact, read once, T-35384) and the apps under it. It is
// the tool's own sentence rather than a shape this end re-formats.
let listingOf = async (at: Account): Promise<string> =>
  saidBy(
    await rpc(at.session)('tools/call', {
      name: 'app_list',
      arguments: {},
    }),
  ).trim()

// One account, named the way `--as` names one.
let one = (all: Account[], want: string): Account => {
  let hit = named(all, want)
  if (hit.length != 1) throw new Refused(`${want} names ${hit.length} accounts`)
  return hit[0]
}

// Infrastructure belongs to the platform owner. Its credentials are the
// box's Wrangler/GitHub logins, independent of a yaks.app account session.
let root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')

// The act is named either way; the flag says WHOSE it is — an agent's
// (`--admin`) or Jeff's (`--owner`) — and the banner says that out loud. The
// credentials used below are this box's Cloudflare/GitHub login for both,
// until the admin path has a token of its own (T-35375).
let platform = (a: Args): void => {
  if (a.admin !== true && a.owner !== true) {
    throw new Refused(
      'yaks.app operations are a named act: add --admin (an agent) or ' +
        '--owner (Jeff)',
    )
  }
  note(
    a.admin === true
      ? banner({ name: 'admin', address: ADMIN, session: '' })
      : banner({
        name: 'platform',
        address: 'yaks.app (this box’s Cloudflare/GitHub login)',
        session: '',
      }),
  )
}

// A platform verb's exit status, as the call's outcome. An interrupt is an
// expected failure of this invocation; another nonzero status is a defect.
export let ended = (verb: string, code: number): Bundle[] => {
  if (code == 130) {
    throw new CallError('interrupted', `the ${verb} operation was interrupted`)
  }
  if (code) throw new Error(`${verb} ended with status ${code}`)
  return []
}

// A verb over this graph's vault, answering whatever it said plus any session
// it has to keep. The graph comes last: only a sign-in reads it.
type Verb = (
  call: Bundle,
  vault: Local,
  keep: Bundle[],
  graph: Graph,
) => Promise<Bundle[]> | Bundle[]

/** The implementations of the tools ./vocab.json declares. */
export let runs = (host: { vault: Local; state: string }): Runs => {
  let verb = (run: Verb) => async (call: Bundle, graph: Graph) => {
    let keep: Bundle[] = []
    try {
      return [...await run(call, host.vault, keep, graph), ...keep]
    } finally {
      renewing(() => {})
    }
  }

  return {
    admin_whoami: verb(async (call, vault, keep) => {
      let at = acting(vault, argsOf(call), keep, host.state)
      let claims = claimsOf(at.session)
      let lines = [
        `account   ${at.address}`,
        `kind      ${
          isAdmin(at)
            ? 'ADMIN — the platform’s own'
            : isTest(at)
            ? 'test — a throwaway'
            : 'OWNER — somebody’s own'
        }`,
        `person    ${claims?.person ?? '(session unreadable)'}`,
        `session   ${
          claims
            ? `good until ${new Date(claims.exp * 1000).toISOString()}`
            : '(unreadable)'
        }`,
        `zone      ${zone()}`,
      ]
      let listing = await listingOf(at)
      if (!listing) lines.push('spaces    (none)')
      else {
        lines.push('spaces', ...listing.split('\n').map((l) => `  ${l}`))
      }
      return [said(call, lines)]
    }),

    admin_accounts: verb((call, vault) => [
      said(call, render(accountsIn(vault), current(host.state))),
    ]),

    admin_throwaway: verb(async (call, _vault, _keep, graph) => {
      let name = word(argsOf(call), 'name')
      let address = name ? `${name}${BOT}` : throwaway()
      return [
        await signIn(graph, address, undefined, host.state),
        said(call, `signed in as ${address} — current`),
      ]
    }),

    admin_login: verb(async (call, _vault, _keep, graph) => {
      let a = argsOf(call)
      let address = String(a.address).trim().toLowerCase()
      if (!address.includes('@')) {
        throw new Refused(
          `${address} is not an address. A bearer for the connector is ` +
            '`yak login <token>`.',
        )
      }
      if (address == ADMIN && a.admin !== true) {
        throw new Refused(
          `${address} is the platform’s admin. Signing in as it is a named ` +
            'act: add --admin. A throwaway is `yak admin throwaway`.',
        )
      }
      if (!isTestAddress(address) && address != ADMIN && a.owner !== true) {
        throw new Refused(
          `${address} is not a test address. Signing in as somebody is a ` +
            'named act: add --owner. A throwaway is `yak admin throwaway`.',
        )
      }
      return [
        await signIn(graph, address, word(a, 'code'), host.state),
        said(call, `signed in as ${address}`),
      ]
    }),

    admin_use: verb((call, vault) => {
      let at = one(accountsIn(vault), String(argsOf(call).account))
      choose(usable(at).address, host.state)
      return [said(call, `current: ${at.address}`)]
    }),

    admin_logout: verb((call, vault) => {
      let at = one(accountsIn(vault), String(argsOf(call).account))
      if (current(host.state) == at.address) choose(null, host.state)
      return [
        unsealed(sessionName(at.address)),
        said(call, `forgot ${at.address}`),
      ]
    }),

    admin_link: verb(async (call, vault, keep) => {
      let a = argsOf(call)
      let at = acting(vault, a, keep, host.state)
      let gone = word(a, 'revoke')
      if (gone) {
        let ids = await unlink(at.session, gone)
        return [
          said(
            call,
            ids.length
              ? `revoked ${ids.join(' ')}`
              : `no link starts with ${gone}`,
          ),
        ]
      }
      let got = await linkFor(
        at.session,
        typeof a.days == 'number' ? a.days : undefined,
      )
      return [
        said(call, [
          got.url,
          `id        ${got.id}`,
          `expires   ${got.expires}`,
          ...got.links.length > 1 ? [`standing  ${got.links.join(' ')}`] : [],
        ]),
      ]
    }),

    // The rate is the PLATFORM's, so it is read and moved by a seat in `yak`
    // (workers/yak/sell.ts `fees`) — never a throwaway's, and never a
    // default's. The flag is what says so out loud, the same named act `login`
    // asks for.
    admin_fee: verb(async (call, vault, keep) => {
      let a = argsOf(call)
      if (a.owner !== true && a.admin !== true) {
        throw new Refused(
          'the fee is the platform’s: add --admin (an agent) or --owner ' +
            '(Jeff). A test account cannot read it or set it.',
        )
      }
      // Read before the account is: a typo is a typo whoever is signed in.
      let bps = word(a, 'bps')
      if (bps != null && !/^\d+$/.test(bps)) {
        throw new CallError('bps', `not a whole number of basis points: ${bps}`)
      }
      let at = acting(vault, a, keep, host.state)
      let now = bps == null
        ? await feeNow(at.session)
        : await setFee(at.session, Number(bps))
      return [said(call, `${now.bps} bps — ${now.rate} of each sale`)]
    }),

    // The naming first, and it is the page's own (workers/yak/erase.ts):
    // whoever runs this reads what would go before it goes, the same list the
    // letter carries to a person whose agent asked.
    admin_delete: verb(async (call, vault, keep) => {
      let slug = String(argsOf(call).space)
      let at = acting(vault, argsOf(call), keep, host.state)
      let doomed = await doomedIn(at.session, slug)
      return [
        said(call, [
          ...doomed.map((line) => `  - ${line}`),
          await close(at.session, slug),
        ]),
      ]
    }),

    admin_query: verb(async (call, vault, keep) => {
      let at = acting(vault, argsOf(call), keep, host.state)
      let rows = await storeQuery(
        at.session,
        String(argsOf(call).where),
        (argsOf(call).filters ?? []) as string[],
      )
      return [said(call, json(rows))]
    }),

    // The id and the secret are named by their op:// references and read
    // here, so neither is ever an argument: this graph keeps a call as its
    // text. What is printed is the name the client is kept under, never it.
    admin_client: verb(async (call, vault, keep) => {
      let a = argsOf(call)
      if (a.owner !== true && a.admin !== true) {
        throw new Refused(
          'a client is the platform’s: add --admin (an agent) or --owner (Jeff)',
        )
      }
      let name = word(a, 'name') ?? ''
      let refs = { id: word(a, 'id') ?? '', secret: word(a, 'secret') }
      for (let [arg, ref] of Object.entries(refs)) {
        if (ref != null && !isOpRef(ref)) {
          throw new CallError(arg, 'an op:// reference, never the value itself')
        }
      }
      let read = (ref: string) => opRead()(ref, AbortSignal.timeout(10_000))
      let at = acting(vault, a, keep, host.state)
      await keepClient(at.session, name, {
        id: await read(refs.id),
        ...refs.secret ? { secret: await read(refs.secret) } : {},
      })
      return [said(call, `kept the ${name} OAuth client on ${zone()}`)]
    }),

    admin_tool: verb(async (call, vault, keep) => {
      let at = acting(vault, argsOf(call), keep, host.state)
      let answer = await rpc(at.session)('tools/call', {
        name: String(argsOf(call).name),
        arguments: (argsOf(call).args ?? {}) as Record<string, unknown>,
      })
      return [said(call, saidBy(answer))]
    }),

    admin_deploys: verb(async (call) => {
      platform(argsOf(call))
      return [said(call, table(await deploys(root)))]
    }),

    admin_errors: verb(async (call, vault) => {
      platform(argsOf(call))
      let token = await reveal(vault, OBSERVABILITY, { env: () => undefined })
      await errors(root, word(argsOf(call), 'since'), token, out, note)
      return []
    }),

    admin_tail: verb(async (call) => {
      platform(argsOf(call))
      return ended('tail', await tail(root, out, note))
    }),

    admin_rollback: verb(async (call) => {
      platform(argsOf(call))
      note(
        'Cloudflare rollback is for a broken build path. Code corrections ' +
          'belong on main: yak admin revert <sha> --admin.',
      )
      return ended(
        'rollback',
        await rollback(root, word(argsOf(call), 'version'), out),
      )
    }),

    admin_revert: verb(async (call) => {
      platform(argsOf(call))
      let sha = word(argsOf(call), 'sha') ?? ''
      if (!/^[a-f\d]{7,40}$/i.test(sha)) {
        throw new CallError('sha', 'yak admin revert <sha> --admin|--owner')
      }
      return ended('revert', await revert(root, sha, out, note))
    }),
  }
}
