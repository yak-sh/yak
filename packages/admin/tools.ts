// Platform operations run as the selected yaks.app connection. Without --as,
// connections computes the person's own account, else the oldest sign-in.

import * as fs from '@yaks/file/io'
import { checkout } from './checkout.ts'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { argsOf, who } from '@yaks/graph/call'
import { mint } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { reveal, sealed, type Vault } from '@yaks/secrets'
import { CallError } from '@yaks/tools/errors'
import { Interrupted } from '@yaks/tools/errors'
import { said } from '@yaks/tools/result'
import { valued } from '@yaks/tools/value'
import type { Host } from '@yaks/host'
import { person } from '@yaks/cli/host'
import { given, read as configAt, used } from '@yaks/cli/config'
import type { Options as TrackerOptions } from '@yaks/tracker/routes'
import { type Account, account } from './account.ts'
import { ADMIN, isFleetAddress } from '@yaks/platform/bots'
import { budgetLines, freeBudgetLine } from '@yaks/platform/budget'
import { funnelLines } from '@yaks/platform/funnel'
import { cameFrom, firstApps, firstsLines, weekly } from '@yaks/platform/firsts'
import { duration } from '@yaks/tracker/errors'

import { Refused } from './refusal.ts'
export { Refused } from './refusal.ts'
import {
  acceptInvite,
  apex,
  appIcons,
  appStores,
  type Browse,
  type BrowseFile,
  budgetNow,
  close,
  compNow,
  doomedIn,
  feeNow,
  firstsNow,
  freeBudgetNow,
  freeSpacesNow,
  funnelNow,
  gravesIn,
  houseNow,
  linkFor,
  moveIn,
  operatorGraph,
  operatorPage,
  operatorSpaces,
  refund,
  relocateIn,
  renewing,
  rpc,
  saidBy,
  setBudget,
  setComp,
  setFee,
  setFreeBudget,
  setFreeSpaces,
  setHouse,
  setTunnel,
  standing,
  storeApply,
  storePage,
  storeQuery,
  storeSchema,
  storesNow,
  storeUpload,
  supportAnswer,
  supportContracts,
  supportNow,
  supportWaiting,
  tunnelNow,
  unlink,
  usesIn,
  zone,
} from './api.ts'
import { documentAt, mockupAt } from './browse-files.ts'
import { visit } from './browse.ts'
import { frameAt, type Timing } from '@yaks/platform/browser-visit'
import { deploys, git, type Login, rollback, table } from './deploys.ts'
import type { Copying } from './copy.ts'
import { copyThread } from './copy_thread.ts'
import { gateway } from './gateway.ts'
import { erase } from './erase.ts'
import { select, sweep } from './move.ts'
import { relocate } from './relocate.ts'
import {
  homeOf,
  push,
  type PushProgress,
  read,
  sentTexts,
  type Target,
  versions,
} from './push.ts'
import { fileHistory, saveCarried, workingSource } from './git-files.ts'
import { errors, tail } from './logs.ts'
import { revert } from './revert.ts'
import { modelLine, operatorModel, operatorRows } from './model.ts'
import type { Rows } from '@yaks/platform/operator-model'
import { PLATFORM_STORE } from '@yaks/platform/names'

type Args = Record<string, unknown>

// The vault name a machine's tunnel token is kept under, which the box's
// config names for @yaks/tunnel's service.
let TUNNEL_TOKEN = 'TUNNEL_TOKEN'
// The admin's Cloudflare API token, minted for the five platform verbs.
let ADMIN_TOKEN = 'CLOUDFLARE_ADMIN_TOKEN'

let word = (a: Args, name: string): string | undefined =>
  typeof a[name] == 'string' ? a[name] as string : undefined

// A path the caller named, read against the caller's own directory: this
// process serves from its own, which is nobody's checkout.
let within = (cwd: string | undefined, path: string) => {
  if (isAbsolute(path)) return path
  if (!cwd) {
    throw new CallError(
      'to',
      `${path} is relative and no cwd was given: name an absolute to, or the cwd it is read against`,
    )
  }
  return resolve(cwd, path)
}

let out = (line: string) => console.log(line)
// A sweep's lines, printed as they come and kept for its answer, which is all a
// caller over the connector or the command line sees of them.
let kept = () => {
  let lines: string[] = []
  return { lines, out: (line: string) => (lines.push(line), out(line)) }
}
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
let website = async (at: Account, rejected?: string): Promise<string> => {
  let session = at.signedIn ? await at.signedIn(rejected) : at.session
  if (!session) {
    throw new Refused(
      `${at.address} was signed in through a browser and has no website session. ` +
        'This browser-only admin act requires a code sign-in (yak auth yaks.app --as <bot address>).',
    )
  }
  return session
}

// One load or move on the page, as a line: how long, where, and where the
// time went (@yaks/platform/browser-visit `Timing`).
let timed = (t: Timing) => {
  let parts = Object.entries(t.parts).map(([k, v]) => `${k} ${v}`)
  let server = Object.entries(t.server).map(([k, v]) => `${k} ${v}`)
  let path = URL.canParse(t.url)
    ? new URL(t.url).pathname + new URL(t.url).search
    : t.url
  return `${t.name} ${t.ms} ms ${path} (${parts.join(' · ')}${
    server.length ? `; server ${server.join(' · ')}` : ''
  })`
}

let browserVisit = async (
  at: Account,
  asked: Browse,
  to: string,
  file?: BrowseFile,
  recovered?: (e: Error) => void | Promise<void>,
) => {
  let session = await website(at)
  try {
    return await visit(session, asked, to, file, undefined, recovered)
  } catch (e) {
    if (!(e instanceof CallError && e.code == 'unauthorized' && at.signedIn)) {
      throw e
    }
    return await visit(
      await website(at, session),
      asked,
      to,
      file,
      undefined,
      recovered,
    )
  }
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
 * with review skipped (app_set `review: false`), code-review records an
 * agent's review of a stranger's app and sends its request to the platform's
 * owner (gallery_code_review), and publish publishes an app of a space the
 * caller owns, with the line `about` says of it, and asks for its listing
 * (app_publish `gallery: true`), after giving its card the picture
 * `screenshot` names (app_set). A `by` the call names, the platform owner's
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
  if (a.decision == 'publish') {
    let ask = rpc(bearer)
    let pictured = a.screenshot
      ? [
        saidBy(
          await ask('tools/call', {
            name: 'app_set',
            arguments: { space, app, screenshot: a.screenshot, ...stamp },
          }),
        ),
      ]
      : []
    let published = await ask('tools/call', {
      name: 'app_publish',
      arguments: {
        space,
        app,
        gallery: true,
        ...(a.about ? { about: a.about } : {}),
        ...stamp,
      },
    })
    return [...pictured, saidBy(published)].join('\n')
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
  host: Pick<
    Host,
    'vault' | 'config' | 'graph' | 'stopping' | 'fetch' | 'report'
  >,
): Runs => {
  let acting = (a: Args) => account(host)(word(a, 'as'))
  // A write is recorded as its account, and an agent's write is the agent's
  // (M-31958): the platform admin, unless --as names the person's own.
  let writing = (a: Args) => account(host)(word(a, 'as') ?? ADMIN)
  // Infrastructure uses the box's Cloudflare/GitHub logins. Only the platform
  // admin or the configured person's own account may act on them.
  let platform = async (a: Args) => {
    let at = await acting(a)
    let owner = await person(host)
    let [own] = await host.graph.get(owner ? [owner] : [])
    if (at.address == (own?.email as Comp)?.address) return at
    if (at.address != ADMIN) {
      throw new Refused(
        'Infrastructure requires the platform admin or the configured person’s own account; select it with --as',
      )
    }
    return at
  }
  // A Cloudflare command as the person's own account keeps Wrangler's sign-in;
  // as the admin it runs with the scoped token in this box's vault (Workers
  // Scripts read and write, Workers Tail read), so Cloudflare's audit log
  // names the token, not the person.
  let cloudflare = async (a: Args): Promise<Login> => {
    if ((await platform(a)).address != ADMIN) return {}
    let token = await reveal(host.vault, ADMIN_TOKEN)
    if (!token) {
      throw new Error(
        `${ADMIN_TOKEN} is not in this box’s vault: the admin's Cloudflare commands run with it`,
      )
    }
    return { CLOUDFLARE_API_TOKEN: token }
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
      let session = await website(at)
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
        let ids = await unlink(await website(at), gone)
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
        await website(at),
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

    // A page opened in Cloudflare's browser as the selected account, and the
    // steps a person takes on it; its screenshots written beside the caller.
    admin_browse: verb(async (call) => {
      let a = argsOf(call)
      let at = await account(host)(word(a, 'as') ?? 'checks@bot.yak.sh')
      if (!isFleetAddress(at.address)) {
        throw new CallError(
          'access',
          'Choose a bot account for a browser visit',
        )
      }
      let page = String(a.url ?? '/')
      let directory = word(a, 'mockup')
      let file = word(a, 'html')
      if (directory != null && file != null) {
        throw new CallError('browse_files', 'Choose either --mockup or --html.')
      }
      let cwd = word(a, 'cwd')
      let local = directory == null
        ? undefined
        : await mockupAt(within(cwd, directory), page)
      let url = local?.url ??
        (page.startsWith('/') ? `https://${zone()}${page}` : page)
      let steps = typeof a.steps == 'string' ? JSON.parse(a.steps) : a.steps
      let view = Object.fromEntries(
        ([
          'width',
          'height',
          'wait',
          'touch',
          'dark',
          'cpu',
          'network',
          'cold',
          'trace',
          'record',
        ] as const)
          .filter((k) => a[k] != null)
          .map((k) => [k, a[k]]),
      ) as Browse['view']
      let allow = word(a, 'allow')?.split(',').map((p) => p.trim())
        .filter(Boolean)
      let signedOut = !!local || a.stranger === true
      let to = within(cwd, word(a, 'to') ?? '.scratch/browse')
      let upload = local?.upload ??
        (file == null ? undefined : await documentAt(within(cwd, file)))
      let got = await browserVisit(
        at,
        { url, view, steps, allow, signedOut, mockup: local?.mockup },
        to,
        upload,
        (e) =>
          host.report?.(e, { tags: { tool: 'admin_browse', retry: 'browse' } }),
      )
      return [
        said(call, [
          `${url}${upload ? ` showing ${directory ?? file}` : ''} as ${
            signedOut ? 'a stranger' : at.address
          }: HTTP ${got.status}, ${
            Math.round(got.duration / 100) / 10
          }s of browser`,
          ...got.files.filter((f) => frameAt(f) == null)
            .map((f) => `shot      ${f}`),
          ...got.recorded == null ? [] : [
            `record    ${got.recorded} ms, ${
              got.files.filter((f) => frameAt(f) != null).length
            } frames in ${to}/rec-*.jpg, each named for its ms`,
          ],
          ...got.missingShots
            ? [
              'warning  The screenshot directory disappeared during the visit.',
            ]
            : [],
          ...(got.timings ?? []).map((t) => `timing    ${timed(t)}`),
          ...(got.evaluated ?? []).map((v) => `eval      ${v}`),
          ...got.dialogs.map((d) => `dialog    ${d.type}: ${d.message}`),
          ...got.errors.map((e) => `error     ${e.split('\n')[0]}`),
          ...got.console.filter((m) => m.type == 'error' || m.type == 'warn')
            .map((m) => `console   ${m.type}: ${m.text}`),
          '',
          got.text,
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

    // Whether a space sells on the platform's own account, the house: read
    // it, or mark it `on` or `off`. Answered only to an owner of `yak`.
    admin_house: verb(async (call) => {
      let a = argsOf(call)
      let space = word(a, 'space')
      if (!space) throw new CallError('space', 'name the space, by its slug')
      let to = word(a, 'house')
      if (to != null && to != 'on' && to != 'off') {
        throw new CallError('house', `on or off, not ${to}`)
      }
      let at = await acting(a)
      let now = to == null
        ? await houseNow(at.bearer, space)
        : await setHouse(at.bearer, space, to == 'on')
      return [
        said(
          call,
          `${now.space} ${
            now.house
              ? 'sells on the platform’s own account'
              : 'is not the house'
          }`,
        ),
      ]
    }),

    // What every yaks.app Operator runs on: read it, or make this graph's
    // row of a model, price and all, the one the directory names.
    admin_model: verb(async (call, _vault, _keep, graph) => {
      let a = argsOf(call)
      let named = word(a, 'model')
      let rows = named &&
        await operatorRows(graph, named, word(a, 'provider'))
      let at = await acting(a)
      let directory: Rows = {
        get: async (eids) =>
          eids.length
            ? await storeQuery(at.bearer, PLATFORM_STORE, [
              `.entity.eid=${eids.join(',')}`,
            ]) as Bundle[]
            : [],
      }
      if (rows) {
        if (rows.box.length) await graph.apply(rows.box)
        await storeApply(at.bearer, PLATFORM_STORE, rows.directory)
      }
      return [said(call, modelLine(await operatorModel(directory)))]
    }),

    admin_budget: verb(async (call) => {
      let a = argsOf(call)
      let space = word(a, 'space')
      let tier = word(a, 'tier')
      let dollars = word(a, 'dollars')
      if (tier ? tier != 'free' || space : !space) {
        throw new CallError('budget', 'choose a space or the Free plan')
      }
      if (dollars != null && !/^(\d+(\.\d+)?|plan)$/.test(dollars)) {
        throw new CallError('dollars', `not a number of dollars: ${dollars}`)
      }
      if (tier && dollars == 'plan') {
        throw new CallError(
          'dollars',
          'give the monthly Free plan budget in dollars',
        )
      }
      let at = await acting(a)
      if (tier) {
        let now = dollars == null
          ? await freeBudgetNow(at.bearer)
          : await setFreeBudget(at.bearer, dollars)
        return [said(call, freeBudgetLine(now))]
      }
      let now = dollars == null
        ? await budgetNow(at.bearer, space!)
        : await setBudget(at.bearer, space!, dollars == 'plan' ? '' : dollars)
      return [said(call, budgetLines(now))]
    }),

    admin_support_contract: verb(async (call) => {
      let a = argsOf(call)
      let space = word(a, 'space')
      let op = word(a, 'op')
      let keys = [
        'annual',
        'onboarding',
        'hours',
        'email',
        'phone',
        'start',
        'renewal',
        'provider',
        'billing',
        'billing_email',
        'billing_name',
        'minutes',
        'day',
        'note',
      ]
      if (op && !space) throw new CallError('space', 'Name the space.')
      let at = await (op ? writing(a) : acting(a))
      let changes = op
        ? Object.fromEntries([
          ['op', op],
          ...keys.flatMap((key) => {
            let value = word(a, key)
            return value == null ? [] : [[key, value]]
          }),
        ])
        : undefined
      return [
        said(
          call,
          JSON.stringify(
            await supportContracts(at.bearer, space, changes),
            null,
            2,
          ),
        ),
      ]
    }),

    admin_comp: verb(async (call) => {
      let a = argsOf(call)
      let space = String(a.space)
      let tier = word(a, 'tier')
      if (tier != null && !['plus', 'pro', 'revoke'].includes(tier)) {
        throw new CallError('tier', 'choose plus, pro or revoke')
      }
      let at = await acting(a)
      let now = tier == null
        ? await compNow(at.bearer, space)
        : await setComp(at.bearer, space, tier, word(a, 'reason') ?? '')
      return [said(
        call,
        `${now.space}: ${now.tier ?? 'free'}; ` +
          (now.comp
            ? `comped: ${now.comp.reason} (${now.comp.by})`
            : 'no comp'),
      )]
    }),

    admin_spaces: verb(async (call) => {
      let a = argsOf(call)
      let person = word(a, 'person')
      let role = word(a, 'role')
      if (!person == !role) {
        throw new CallError('person', 'say one: a person or a role')
      }
      let spaces = word(a, 'spaces')
      if (spaces != null && !/^(\d+|unlimited|default)$/.test(spaces)) {
        throw new CallError('spaces', 'say a number, unlimited or default')
      }
      let of = person ? { person } : { role: role! }
      let at = await writing(a)
      let now = spaces == null
        ? await freeSpacesNow(at.bearer, of)
        : await setFreeSpaces(at.bearer, of, spaces)
      let who = 'person' in now ? now.person : `every ${now.role} of yak`
      let room = 'person' in now && now.canCreate != null
        ? ` (${now.used} used). ${
          now.canCreate ? 'Can' : 'Cannot'
        } create another.`
        : ''
      return [said(call, `${who}: ${now.spaces} free spaces${room}`)]
    }),

    // The server answers support threads only to the account's seat in yak.
    // A fix named by its handle here (T-153200) is this graph's entity, so
    // it is resolved here and sent as its eid, with what the person's page
    // shows of it, since the platform cannot read this graph: a commit's
    // message (its eid is its sha) or another entity's title.
    admin_support: verb(async (call, _vault, _keep, graph) => {
      let a = argsOf(call)
      let thread = word(a, 'thread')
      let text = word(a, 'text'), reply_to = word(a, 'reply_to')
      let named = word(a, 'fix'), complete = a.complete === true
      if (!thread && (text || reply_to || named || complete)) {
        throw new CallError('thread', 'name the thread to answer')
      }
      let writes = !!(text || reply_to || named || complete)
      let at = await (writes ? writing(a) : acting(a))
      if (!thread) {
        let { threads } = await supportWaiting(at.bearer)
        return [said(
          call,
          threads.length
            ? threads.map((t) => `${t.eid}  ${t.title}`)
            : 'no thread is waiting',
        )]
      }
      let fix = named
        ? (await graph.address([named])).get(named) ?? named
        : undefined
      let [row] = fix ? await graph.get([fix]) : []
      let t = writes
        ? await supportAnswer(at.bearer, thread, {
          text,
          reply_to,
          fix,
          fix_message: word((row?.commit ?? {}) as Comp, 'message'),
          fix_title: word((row?.doc ?? {}) as Comp, 'title'),
          complete,
        })
        : await supportNow(at.bearer, thread)
      return [said(call, [t.text, t.link])]
    }),

    // A trial of every Operator's email between visits
    // (@yaks/platform/outreach-trial): one directory row, which the directory
    // sends as a batch and reads back onto its Letters page. Nothing is sent
    // to anyone.
    admin_letters: verb(async (call) => {
      let a = argsOf(call)
      let changelog = word(a, 'changelog')?.trim()
      if (!changelog) throw new CallError('changelog', 'say what changed')
      let [provider, model] = [word(a, 'provider'), word(a, 'model')]
      if (!provider != !model) {
        throw new CallError('model', 'name both provider and model, or neither')
      }
      let at = await acting(a)
      let eid = mint()
      await storeApply(at.bearer, PLATFORM_STORE, [{
        entity: { eid },
        outreach_trial: {
          changelog,
          ...model ? { provider, model } : {},
        },
      }])
      return [
        said(
          call,
          `trial ${eid} started; its letters appear within the hour at ${
            apex(`/admin/letters/${eid}`)
          }`,
        ),
      ]
    }),

    admin_funnel: verb(async (call) => {
      let a = argsOf(call)
      let since = word(a, 'since') ?? '7d'
      let from = /^\d+[smhd]?$/.test(since)
        ? new Date(Date.now() - duration(since) * 1000)
        : new Date(since)
      if (isNaN(from.getTime())) {
        throw new CallError('since', `not a time or a duration: ${since}`)
      }
      let at = await acting(a)
      let [f, d] = await Promise.all([
        funnelNow(at.bearer, from.toISOString()),
        firstsNow(at.bearer),
      ])
      let weeks = weekly(
        firstApps(d),
        from.toISOString(),
        new Date().toISOString(),
        cameFrom(d),
      )
      return [said(call, [...firstsLines(weeks), ...funnelLines(f)].join('\n'))]
    }),

    admin_refund: verb(async (call) => {
      let a = argsOf(call)
      let space = String(a.space)
      let dollars = String(a.dollars)
      if (!/^\d+(\.\d+)?$/.test(dollars)) {
        throw new CallError('dollars', `not a number of dollars: ${dollars}`)
      }
      let at = await acting(a)
      let now = await refund(at.bearer, space, dollars, String(a.why))
      return [said(call, [`$${dollars} refunded`, ...budgetLines(now)])]
    }),

    admin_erase: verb(async (call) => {
      let a = argsOf(call)
      let at = await acting(a)
      let c = await erase(
        host,
        at.bearer,
        String(a.address),
        a.check === true,
        a.restore === true,
      )
      let ended = a.check === true
        ? 'would end'
        : c.trashed || c.restored
        ? 'retained'
        : 'ended'
      return [
        said(call, [
          `${c.address}: ${
            c.gone
              ? 'already gone'
              : c.erased
              ? 'erased'
              : c.restored
              ? 'restored'
              : c.trashed
              ? 'in the trash'
              : 'would be trashed'
          }`,
          `spaces  ${c.spaces.join(' ') || '(none)'}`,
          `seats   ${c.seats.join(' ') || '(none)'}`,
          `connections on this box  ${c.connections} ${ended}`,
          ...c.purge
            ? [`Only the person's confirmation can purge it: ${c.purge}`]
            : [],
        ]),
      ]
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
            : got.trashed
            ? `${got.space}  tunnel in the trash since ${got.trashed}; names held; restore it with act=restore`
            : `${got.space}  no tunnel`,
          ...got.message ? [got.message] : [],
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
      let doomed = await doomedIn(await website(at), slug)
      return [
        said(call, [
          ...doomed.map((line) => `  - ${line}`),
          await close(await website(at), slug),
        ]),
      ]
    }),

    admin_query: verb(async (call) => {
      let a = argsOf(call)
      let at = await acting(a)
      let filters = (a.filters ?? []) as string[]
      let rows = a.operator === true
        ? await operatorGraph(at.bearer, String(a.where), {
          q: filters.join('&'),
        })
        : await storeQuery(at.bearer, String(a.where), filters)
      return [valued(call, { result: rows })]
    }),

    admin_schema: verb(async (call) => {
      let a = argsOf(call)
      let at = await acting(a)
      let doc = await storeSchema(at.bearer, String(a.where))
      return [valued(call, { result: doc })]
    }),

    admin_uses: verb(async (call) => {
      let a = argsOf(call)
      let at = await acting(a)
      return [valued(call, await usesIn(at.bearer, String(a.where)))]
    }),

    admin_apply: verb(async (call) => {
      let a = argsOf(call)
      let at = await writing(a)
      let applied = a.operator === true
        ? await operatorGraph(at.bearer, String(a.where), {
          bundles: a.bundles as Bundle[],
          check: a.check === true,
        })
        : await storeApply(
          at.bearer,
          String(a.where),
          a.bundles as Bundle[],
          a.check === true,
        )
      return [valued(call, { result: applied })]
    }),

    admin_upload: verb(async (call) => {
      let a = argsOf(call)
      let where = String(a.where)
      if (where.split('/').length != 2) {
        throw new CallError('where', 'name an app as space/app')
      }
      if (!a.private && (a.buyer != null || a.via != null)) {
        throw new CallError('arguments', 'Use --private with --buyer or --via')
      }
      let customer = a.private
        ? { buyer: word(a, 'buyer'), via: word(a, 'via') }
        : undefined
      let at = await writing(a)
      let path = String(a.path)
      let name = word(a, 'name') ?? basename(path)
      let mime = word(a, 'mime') ?? 'application/octet-stream'
      let file = await storeUpload(
        at.bearer,
        where,
        await fs.readFile(path),
        mime,
        name,
        customer,
      )
      return [said(call, `${file.url} — ${file.bytes} bytes, ${file.mime}`)]
    }),

    admin_push: verb(async (call) => {
      let a = argsOf(call)
      let dir = String(a.dir).replace(/\/+$/, '')
      let at = await writing(a)
      note(`reading ${dir}…`)
      let files = await read(dir)
      note(`read ${files.length} local files`)
      let to = {
        app: word(a, 'app') ?? dir.slice(dir.lastIndexOf('/') + 1),
        space: word(a, 'space'),
        title: word(a, 'title'),
        access: word(a, 'access') as Target['access'],
      }
      let known = await versions(
        homeOf(host.config.db),
        JSON.stringify([
          zone(),
          at.address,
          await fs.realPath(dir),
          to.space,
          to.app,
        ]),
      )
      let run = (args: string[], cwd: string) => git(cwd, args, host.stopping)
      let source = await workingSource(dir, run)
      let lines = await push(rpc(at.bearer), files, to, {
        ...known,
        checkout: {
          earlier: async function* (path) {
            if (source) {
              yield* fileHistory(
                (args) => run(args, source.root),
                path,
                await source.path(path),
              )
            }
          },
          write: (files) =>
            saveCarried(
              dir,
              to,
              files,
              run,
              `yak admin push as ${at.address}`,
              source,
            ),
        },
        sent: sentTexts(homeOf(host.config.db)),
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
      let pace = Number(word(a, 'pace') ?? (rehearse ? 0 : 30))
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
      let each = kept()
      let summary = await sweep({
        stores,
        ask: (store) => moveIn(at.bearer, store, rehearse),
        pace,
        out: each.out,
        stopping: host.stopping,
      })
      return [said(call, [...each.lines, ...summary])]
    }),

    // Where every store stands, and with --move each app's store far from
    // the kernel moved beside it (./relocate.ts). The platform's act, with
    // authorization checked by the server.
    admin_relocate: verb(async (call) => {
      let a = argsOf(call)
      let at = await acting(a)
      let stores = select(await storesNow(at.bearer), word(a, 'where'))
      let eids = async (where: string) =>
        (await storeQuery(at.bearer, where, ['.entity']) as Bundle[])
          .map((b) => String((b.entity as Comp).eid))
      let each = kept()
      let summary = await relocate({
        stores,
        standing: (store) => standing(at.bearer, store),
        eids,
        prepare: (store, to) => relocateIn(at.bearer, store, { prepare: to }),
        hand: (store, to) => relocateIn(at.bearer, store, { to }),
        move: a.move === true,
        out: each.out,
        stopping: host.stopping,
      })
      return [said(call, [...each.lines, ...summary])]
    }),

    // Every space's Operator store, or one space's, copied into a SQLite file
    // here (./copy.ts), to rehearse a migration on. The platform's act, with
    // authorization checked by the server.
    admin_copy: verb(async (call) => {
      let a = argsOf(call)
      let at = await acting(a)
      let where = word(a, 'space')
      let apps = a.apps === true
      let to = within(
        word(a, 'cwd'),
        word(a, 'to') ?? (apps ? '.scratch/stores' : '.scratch/operators'),
      )
      // An app's store is named for where it stands (`space/app`, a sample's
      // or a visitor's after it), as a file name.
      let spaces = apps
        ? (await appStores(at.bearer)).filter((s) =>
          !where || s.at.split('/')[0] == where
        ).map((s) => ({
          eid: s.store,
          slug: s.at.replaceAll('/', '--').replaceAll(' ', '-'),
        }))
        : (await operatorSpaces(at.bearer))
          .filter((s) => !where || s.slug == where)
      if (where && !spaces.length) {
        throw new CallError('space', `no space is ${where}`)
      }
      let each = kept()
      // Every space's copy, asked again after a restart interrupted it, goes
      // on from where it stopped; one space asked for is copied afresh.
      await copyThread({
        spaces,
        to,
        keep: !where,
        page: (space, asked) =>
          apps
            ? storePage<Copying>(at.bearer, space, asked)
            : operatorPage<Copying>(at.bearer, space, asked),
        out: each.out,
        stopping: host.stopping,
      })
      return [said(call, each.lines)]
    }),

    // The directory's graves, a page of its tombstones at a time, each with
    // what still tells of it (@yaks/platform/graves). The platform's act,
    // with authorization checked by the server.
    admin_graves: verb(async (call) => {
      let a = argsOf(call)
      let at = await acting(a)
      let page = await gravesIn(at.bearer, {
        since: String(a.since),
        until: word(a, 'until') ?? new Date().toISOString(),
        after: typeof a.after == 'number' ? a.after : undefined,
      })
      return [valued(call, page)]
    }),

    admin_app_icons: verb(async (call) => {
      let args = argsOf(call)
      let at = await acting(args)
      let page = await appIcons(
        at.bearer,
        word(args, 'after') ?? '',
        args.queue === true,
        word(args, 'owner_of'),
      )
      return [valued(call, page)]
    }),

    admin_deploys: verb(async (call) => {
      let login = await cloudflare(argsOf(call))
      let [rows, observed] = await Promise.all([
        deploys(checkout, host.stopping, login),
        gateway(host.stopping, host.fetch),
      ])
      return [said(call, table(rows, observed))]
    }),

    admin_errors: verb(async (call, vault, _keep, graph) => {
      await platform(argsOf(call))
      let report = await errors(
        word(argsOf(call), 'since'),
        await tracker(host.config, vault),
        { fetch: host.fetch, graph, resolved: argsOf(call).resolved === true },
      )
      return [said(call, report)]
    }),

    admin_tail: verb(async (call) => {
      let login = await cloudflare(argsOf(call))
      return ended(
        'tail',
        await tail(checkout, out, note, host.stopping, login),
      )
    }),

    admin_rollback: verb(async (call) => {
      let login = await cloudflare(argsOf(call))
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
          login,
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
