// Platform operations run as the selected yaks.app connection. Without --as,
// connections computes the person's own account, else the oldest sign-in.
import { checkout } from './checkout.ts'
import { basename, dirname } from 'node:path'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { argsOf, who } from '@yaks/graph/call'
import type { Runs } from '@yaks/graph/tools'
import { reveal, sealed, type Vault } from '@yaks/secrets'
import { CallError } from '@yaks/tools/errors'
import { Interrupted } from '@yaks/tools/errors'
import { said } from '@yaks/tools/result'
import type { Host } from '@yaks/host'
import { person } from '@yaks/cli/host'
import { given, read as configAt, used } from '@yaks/cli/config'
import type { Options as TrackerOptions } from '@yaks/tracker/routes'
import { type Account, account } from './account.ts'
import { ADMIN } from '../../workers/yak/lib/bots.ts'

import { Refused } from './refusal.ts'
export { Refused } from './refusal.ts'
import {
  acceptInvite,
  close,
  doomedIn,
  feeNow,
  linkFor,
  moveIn,
  renewing,
  rpc,
  saidBy,
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
import { select, sweep } from './move.ts'
import { push, type PushProgress, read, versions } from './push.ts'
import { errors, tail } from './logs.ts'
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
    note(
      p.state == 'start'
        ? 'deploying app…'
        : p.deployed === false
        ? 'deploy awaits confirmation'
        : 'deployed app',
    )
  }
}

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
  vault: Vault,
  keep: Bundle[],
  graph: Graph,
) => Promise<Bundle[]> | Bundle[]

// The tracker owns its remote address and signing-key reference. Admin uses
// the same config as bug_list, without opening the independent tracker graph.
export let tracker = async (
  config: Host['config'],
  vault: Vault,
): Promise<TrackerOptions> => {
  let find = (config: Host['config']) =>
    config.plugins?.find((p) => used(p) == '@yaks/tracker')
  let plugin = find(config)
  if (!plugin && config.db && config.db != ':memory:') {
    let path = `${dirname(config.db)}/tracker.json`
    try {
      plugin = find(configAt(path))
    } catch {
      throw new CallError('tracker', `Tracker config unavailable: ${path}`)
    }
  }
  if (!plugin) {
    throw new CallError(
      'tracker',
      'Configure @yaks/tracker remote in tracker.json beside this graph',
    )
  }
  let options = given(plugin) as TrackerOptions
  let remote = options.remote
  let credential = remote?.secret as unknown
  let reference =
    credential && typeof credential == 'object' && 'secret' in credential
      ? String(credential.secret)
      : undefined
  let secret = reference
    ? await reveal(vault, reference, { env: () => undefined })
    : typeof credential == 'string'
    ? credential
    : undefined
  return { remote: { url: remote?.url, secret } }
}

/** A gallery act through the hosted tools, recorded as this call's actor and
 * session: approve or decline answers a request (gallery_review), list asks
 * with review skipped (app_set `review: false`), and code-review records an
 * agent's review of a stranger's app and sends its request to the platform's
 * owner (gallery_code_review). A `by` the call names, the platform owner's
 * address when he asked for the act, stands in for the caller's own. Account
 * selection stays at the admin boundary shared by every operation. */
export let review = async (bearer: string, call: Bundle): Promise<string> => {
  let a = argsOf(call)
  let actor = who(call)
  let by = a.by ?? actor?.by
  let stamp = {
    ...(by ? { by } : {}),
    ...(actor?.via ? { via: actor.via } : {}),
  }
  let [space, app, extra] = String(a.app).split('/')
  if (!space || !app || extra != null) {
    throw new CallError('app', 'name the app as space/app')
  }
  let asked = a.decision == 'list'
    ? {
      name: 'app_set',
      arguments: { space, app, gallery: true, review: false, ...stamp },
    }
    : a.decision == 'code-review'
    ? {
      name: 'gallery_code_review',
      arguments: {
        app: a.app,
        verdict: a.verdict,
        findings: a.findings,
        ...stamp,
      },
    }
    : {
      name: 'gallery_review',
      arguments: {
        app: a.app,
        decision: a.decision,
        ...stamp,
        ...(a.reason ? { reason: a.reason } : {}),
      },
    }
  return saidBy(await rpc(bearer)('tools/call', asked))
}

/** The implementations of the tools ./vocab.json declares. */
export let runs = (
  host: Pick<Host, 'vault' | 'config' | 'graph' | 'stopping'>,
): Runs => {
  let acting = (a: Args) => account(host)(word(a, 'as'))
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
    admin_gallery: verb(async (call) => {
      let at = await acting(argsOf(call))
      return [said(call, await review(at.bearer, call))]
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
        throw new CallError(
          'bps',
          `not a whole number of basis points: ${bps}`,
        )
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

    admin_push: verb(async (call) => {
      let a = argsOf(call)
      let dir = String(a.dir).replace(/\/+$/, '')
      let at = await acting(a)
      note(`reading ${dir}…`)
      let files = await read(dir)
      note(`read ${files.length} local files`)
      let to = {
        app: word(a, 'app') ?? dir.slice(dir.lastIndexOf('/') + 1),
        space: word(a, 'space'),
        title: word(a, 'title'),
      }
      let known = await versions(
        host.config.db && host.config.db != ':memory:'
          ? dirname(host.config.db)
          : `${Deno.env.get('HOME')}/.yak`,
        JSON.stringify([
          zone(),
          at.address,
          await Deno.realPath(dir),
          to.space,
          to.app,
        ]),
      )
      let lines = await push(rpc(at.bearer), files, to, {
        ...known,
        confirm: a.confirm === true,
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
      let stores = select(await storesNow(at.bearer), where)
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
      return [said(call, table(await deploys(checkout, host.stopping)))]
    }),

    admin_errors: verb(async (call, vault, _keep, graph) => {
      await platform(argsOf(call))
      let report = await errors(
        word(argsOf(call), 'since'),
        await tracker(host.config, vault),
        { graph, resolved: argsOf(call).resolved === true },
      )
      return [said(call, report)]
    }),

    admin_tail: verb(async (call) => {
      await platform(argsOf(call))
      return ended('tail', await tail(checkout, out, note, host.stopping))
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
          checkout,
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
        await revert(checkout, sha, out, note, host.stopping),
      )
    }),
  }
}
