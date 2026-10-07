// Platform operations run as the selected yaks.app connection. Without --as,
// connections computes the person's own account, else the oldest sign-in.
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { argsOf, type Bundle, type Comp, type Graph } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import {
  isOpRef,
  type Local,
  opRead,
  records,
  reveal,
  sealed,
} from '@yaks/secrets'
import { CallError, Interrupted } from '@yaks/tools'
import type { Host } from '@yaks/host'
import { person } from '@yaks/cli/host'
import { accountCredential, AccountError, authorize } from '@yaks/connections'
import { authorizeCLI } from '@yaks/connections/cli'
import { yaksApp } from '@yaks/connections/yaks-app'
import { ADMIN, BOT } from '../../workers/yak/lib/bots.ts'

import { Refused } from './refusal.ts'
export { Refused } from './refusal.ts'
import {
  acceptInvite,
  close,
  doomedIn,
  feeNow,
  keepClient,
  linkFor,
  moveIn,
  renewing,
  rpc,
  setFee,
  setTunnel,
  storeApply,
  storeQuery,
  storesNow,
  storeUpload,
  tunnelNow,
  unlink,
  zone,
} from './api.ts'
import { deploys, rollback, table } from './deploys.ts'
import { sweep } from './move.ts'
import { push, type PushProgress, read } from './push.ts'
import { errors, tail, TOKEN } from './logs.ts'
import { revert } from './revert.ts'

type Args = Record<string, unknown>

// The vault name a machine's tunnel token is kept under, which the box's
// config names for @yaks/tunnel's service.
let TUNNEL_TOKEN = 'TUNNEL_TOKEN'

let word = (a: Args, name: string): string | undefined =>
  typeof a[name] == 'string' ? a[name] as string : undefined

let json = (v: unknown) => JSON.stringify(v, null, 2)

let out = (line: string) => console.log(line)
let note = (line: string) => console.error(line)

let pushNote = (p: PushProgress) => {
  if (p.phase == 'list') {
    note(
      p.state == 'start' ? 'listing app files…' : `listed ${p.count} app files`,
    )
  } else if (p.phase == 'create') {
    note(p.state == 'start' ? 'creating app…' : 'created app')
  } else if (p.phase == 'hash') {
    note(
      p.state == 'start'
        ? `hashing ${p.count} local files…`
        : `hashed ${p.count} files; ${p.changed} to upload, ` +
          `${p.removed} to delete`,
    )
  } else if (p.phase == 'upload') {
    note(
      p.state == 'start'
        ? `uploading files ${p.done + 1}–${p.done + p.batch}/${p.total}…`
        : `uploaded ${p.done}/${p.total} files`,
    )
  } else if (p.phase == 'delete') {
    note(
      p.state == 'start'
        ? `deleting ${p.path} (${p.done + 1}/${p.total})…`
        : `deleted ${p.done}/${p.total} files`,
    )
  } else {
    note(p.state == 'start' ? 'deploying app…' : 'deployed app')
  }
}

// What a verb says, as the call's answer.
let said = (call: Bundle, lines: string | string[]): Bundle => ({
  entity: { eid: '$said' },
  content: { body: typeof lines == 'string' ? lines : lines.join('\n') },
  output: { source: call.entity.eid },
})

type Account = { address: string; bearer: string; session?: string }

// Browser-only acts cannot synthesize a cookie from an OAuth bearer.
let website = (at: Account): string => {
  if (!at.session) {
    throw new Refused(
      `${at.address} was signed in through a browser and has no website session. ` +
        'This browser-only admin act requires a code sign-in (yak auth yaks.app --as <bot address>).',
    )
  }
  return at.session
}

// Infrastructure belongs to the platform owner. Its credentials are the
// box's Wrangler/GitHub logins, independent of a yaks.app account session.
let root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')

// A platform verb's exit status, as the call's outcome. An interrupt is an
// expected failure of this invocation; another nonzero status is a defect.
export let ended = (verb: string, code: number): Bundle[] => {
  if (code == 130) {
    throw new Interrupted(`the ${verb} operation was interrupted`, 'signal')
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
export let runs = (
  host: Pick<Host, 'vault' | 'config' | 'graph' | 'stopping'>,
): Runs => {
  let acting = async (a: Args): Promise<Account> => {
    let owner = await person(host)
    if (!owner) throw new Refused('A configured person is required')
    let at
    try {
      at = await accountCredential(host, owner, 'yaks.app', word(a, 'as'))
    } catch (error) {
      if (error instanceof AccountError) throw new Refused(error.message)
      throw error
    }
    if (!at) {
      throw new Refused(
        'No yaks.app connection; sign in with yak auth yaks.app',
      )
    }
    let address = String(
      (at.connection.connection as Comp)?.account ?? '(unnamed account)',
    )
    if (at.session) {
      renewing(async (fresh) => {
        await records<{ website_session?: string }>(
          host.graph,
          host.vault,
          '',
          () => {},
        ).update(
          String((at.connection.secret as Comp)?.name),
          (record) => {
            record.website_session = fresh
            return Promise.resolve()
          },
        )
      })
    }
    return { address, bearer: at.bearer, session: at.session }
  }
  // Infrastructure uses the box's Cloudflare/GitHub logins. Only the platform
  // admin or the configured person's own account may spend those credentials.
  let platform = async (a: Args) => {
    let at = await acting(a)
    let owner = await person(host)
    let [own] = await host.graph.get(owner ? [owner] : [])
    if (at.address != ADMIN && at.address != (own?.email as Comp)?.address) {
      throw new Refused(
        'Infrastructure requires the platform admin or the configured person’s own account; select it with --as',
      )
    }
  }
  let verb = (run: Verb) => async (call: Bundle, graph: Graph) => {
    let keep: Bundle[] = []
    try {
      return [...await run(call, host.vault, keep, graph), ...keep]
    } finally {
      renewing(() => {})
    }
  }

  return {
    admin_throwaway: verb(async (call) => {
      let name = word(argsOf(call), 'name')
      let address = name
        ? `${name}${BOT}`
        : `probe-${crypto.randomUUID().slice(0, 6)}${BOT}`
      let auth = authorize(
        { ...host, owner: await person(host) },
        yaksApp(host),
      )
      try {
        await authorizeCLI(auth, 'yaks.app', undefined, address)
      } finally {
        await auth.close()
      }
      return [
        said(call, `signed in as ${address} — act as it with --as=${address}`),
      ]
    }),

    admin_accept: verb(async (call, _vault, _keep, graph) => {
      let a = argsOf(call)
      let at = await acting(a)
      let session = website(at)
      let letter = String(a.letter)
      let eid = (await graph.address([letter])).get(letter) ?? letter
      let [mail] = await graph.get([eid])
      await acceptInvite(session, mail, at.address)
      return [
        said(call, `accepted the invitation in ${letter} as ${at.address}`),
      ]
    }),

    admin_link: verb(async (call) => {
      let a = argsOf(call)
      let at = await acting(a)
      let gone = word(a, 'revoke')
      if (gone) {
        let ids = await unlink(website(at), gone)
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
        website(at),
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

    // The server answers fee operations only to the selected account's seat in yak.
    admin_fee: verb(async (call) => {
      let a = argsOf(call)
      // Read before the account is: a typo is a typo whoever is signed in.
      let bps = word(a, 'bps')
      if (bps != null && !/^\d+$/.test(bps)) {
        throw new CallError('bps', `not a whole number of basis points: ${bps}`)
      }
      let at = await acting(a)
      let now = bps == null
        ? await feeNow(at.bearer)
        : await setFee(at.bearer, Number(bps))
      return [said(call, `${now.bps} bps — ${now.rate} of each sale`)]
    }),

    // The tunnel a space has to a machine (workers/yak/tunnel.ts). A token the
    // platform answers goes straight into this graph's vault, where
    // @yaks/tunnel's service reads it, and is never printed: whoever holds it
    // can run the tunnel.
    admin_tunnel: verb(async (call, _vault, keep) => {
      let a = argsOf(call)
      let space = String(a.space)
      let act = word(a, 'act')
      let at = await acting(a)
      let fields: Record<string, string> = { space, do: act ?? '' }
      for (let k of ['port', 'tunnel', 'service']) {
        let v = word(a, k)
        if (v) fields[k] = v
      }
      let got = act
        ? await setTunnel(at.bearer, fields)
        : await tunnelNow(at.bearer, space)
      if (got.token) keep.push(sealed(TUNNEL_TOKEN, got.token))
      let t = got.tunnel
      return [
        said(call, [
          t
            ? `${got.space}  tunnel ${t.id}  service ${t.service}${
              t.adopted ? '  (adopted)' : ''
            }`
            : `${got.space}  no tunnel`,
          ...got.token
            ? [`token     kept in the vault as ${TUNNEL_TOKEN}`]
            : [],
        ]),
      ]
    }),

    // The naming first, and it is the page's own (workers/yak/erase.ts):
    // whoever runs this reads what would go before it goes, the same list the
    // letter carries to a person whose agent asked.
    admin_delete: verb(async (call) => {
      let slug = String(argsOf(call).space)
      let at = await acting(argsOf(call))
      let doomed = await doomedIn(website(at), slug)
      return [
        said(call, [
          ...doomed.map((line) => `  - ${line}`),
          await close(website(at), slug),
        ]),
      ]
    }),

    admin_query: verb(async (call) => {
      let at = await acting(argsOf(call))
      let rows = await storeQuery(
        at.bearer,
        String(argsOf(call).where),
        (argsOf(call).filters ?? []) as string[],
      )
      return [said(call, json(rows))]
    }),

    admin_apply: verb(async (call) => {
      let a = argsOf(call)
      let at = await acting(a)
      let applied = await storeApply(
        at.bearer,
        String(a.where),
        a.bundles as Bundle[],
        a.check === true,
      )
      return [said(call, json(applied))]
    }),

    admin_upload: verb(async (call) => {
      let a = argsOf(call)
      let where = String(a.where)
      if (where.split('/').length != 2) {
        throw new CallError('where', 'name an app as space/app')
      }
      let at = await acting(a)
      let path = String(a.path)
      let name = word(a, 'name') ?? basename(path)
      let mime = word(a, 'mime') ?? 'application/octet-stream'
      let file = await storeUpload(
        at.bearer,
        where,
        await Deno.readFile(path),
        mime,
        name,
      )
      return [said(call, `${file.url} — ${file.bytes} bytes, ${file.mime}`)]
    }),

    // The id and the secret are named by their op:// references and read
    // here, so neither is ever an argument: this graph keeps a call as its
    // text. What is printed is the name the client is kept under, never it.
    admin_client: verb(async (call) => {
      let a = argsOf(call)
      let name = word(a, 'name') ?? ''
      let refs = { id: word(a, 'id') ?? '', secret: word(a, 'secret') }
      for (let [arg, ref] of Object.entries(refs)) {
        if (ref != null && !isOpRef(ref)) {
          throw new CallError(arg, 'an op:// reference, never the value itself')
        }
      }
      let read = (ref: string) => opRead()(ref, AbortSignal.timeout(10_000))
      let at = await acting(a)
      await keepClient(at.bearer, name, {
        id: await read(refs.id),
        ...refs.secret ? { secret: await read(refs.secret) } : {},
      })
      return [said(call, `kept the ${name} OAuth client on ${zone()}`)]
    }),

    admin_push: verb(async (call) => {
      let a = argsOf(call)
      let dir = String(a.dir).replace(/\/+$/, '')
      let at = await acting(a)
      note(`reading ${dir}…`)
      let files = await read(dir)
      note(`read ${files.length} local files`)
      let lines = await push(rpc(at.bearer), files, {
        app: word(a, 'app') ?? dir.slice(dir.lastIndexOf('/') + 1),
        space: word(a, 'space'),
        title: word(a, 'title'),
      }, {
        progress: pushNote,
      })
      return [said(call, lines)]
    }),

    // Every store asked about the store mover (./move.ts): rehearse each rule
    // everywhere, or wake each store to move what it owes. The platform's act,
    // with authorization checked by the server.
    admin_move: verb(async (call) => {
      let a = argsOf(call)
      let rehearse = a.rehearse === true
      let pace = Number(word(a, 'pace') ?? (rehearse ? 0 : 5))
      if (!Number.isFinite(pace) || pace < 0) {
        throw new CallError('pace', `not a number of stores a minute: ${pace}`)
      }
      let where = word(a, 'where')
      let at = await acting(a)
      let stores = (await storesNow(at.bearer)).filter((s) =>
        !where || s.at == where || s.at.startsWith(`${where}/`)
      )
      note(
        `${rehearse ? 'rehearsing' : 'waking'} ${stores.length} stores` +
          (pace ? `, ${pace} a minute` : ''),
      )
      return [
        said(
          call,
          await sweep({
            stores,
            ask: (store) => moveIn(at.bearer, store, rehearse),
            pace,
            out,
            stopping: host.stopping,
          }),
        ),
      ]
    }),

    admin_deploys: verb(async (call) => {
      await platform(argsOf(call))
      return [said(call, table(await deploys(root, host.stopping)))]
    }),

    admin_errors: verb(async (call, vault) => {
      await platform(argsOf(call))
      let token = await reveal(vault, TOKEN, { env: () => undefined })
      await errors(word(argsOf(call), 'since'), token, out, note)
      return []
    }),

    admin_tail: verb(async (call) => {
      await platform(argsOf(call))
      return ended('tail', await tail(root, out, note, host.stopping))
    }),

    admin_rollback: verb(async (call) => {
      await platform(argsOf(call))
      note(
        'Cloudflare rollback is for a broken build path. Code corrections ' +
          'belong on main: yak admin revert <sha>.',
      )
      return ended(
        'rollback',
        await rollback(
          root,
          word(argsOf(call), 'version'),
          out,
          host.stopping,
        ),
      )
    }),

    admin_revert: verb(async (call) => {
      await platform(argsOf(call))
      let sha = word(argsOf(call), 'sha') ?? ''
      if (!/^[a-f\d]{7,40}$/i.test(sha)) {
        throw new CallError('sha', 'yak admin revert <sha>')
      }
      return ended(
        'revert',
        await revert(root, sha, out, note, host.stopping),
      )
    }),
  }
}
