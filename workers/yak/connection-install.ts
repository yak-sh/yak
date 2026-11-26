// A provider-started install carries no yaks.app state. The code can buy a
// workspace grant, but a space owner still has to choose where it goes.
import {
  attachInstallation,
  known,
  redeemInstallation,
  signsInWith,
} from '@yaks/connections'
import { OAuthError, type Tokens } from '@yaks/oauth'
import { installChoice } from '@yaks/platform/connections-view'
import { cookieValue } from '@yaks/platform/cookie'
import { url } from '@yaks/platform/host'
import { CONNECTION_INSTALL, MANAGE, signInAt } from '@yaks/platform/routes'
import { CallError } from '@yaks/tools/errors'
import { h } from 'preact'
import { finish, hold, waiting } from './attempts.ts'
import { ctxOf, finishConnection, pageOf } from './connections.ts'
import { caught } from './defects.ts'
import * as directory from './directory.ts'
import { bound, type Env } from './env.ts'
import { page } from './pages.ts'
import { whoIs } from './session.ts'
import { vaulted } from './vault.ts'

let KIND = 'connection-install'
let COOKIE = '__Host-yak_install'
let MINUTES = 30

type Pending = {
  integration: string
  grant: Tokens
  person: string | null
  until: number
}

let privatePage = {
  'cache-control': 'private, no-store',
  'content-security-policy': "frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
}

let dirOf = (env: Env) =>
  directory.directory(bound(env.DIRECTORY, directory.fetch, env))

let account = (req: Request, env: Env, dir: directory.Directory) =>
  whoIs(req, env, () => Promise.resolve(null), null, dir)

let cookie = (state: string, age: number) =>
  `${COOKIE}=${state}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`

let go = (location: string, set?: string) =>
  new Response(null, {
    status: 303,
    headers: { ...privatePage, location, ...set ? { 'set-cookie': set } : {} },
  })

let startAgain = (env: Env, lead: string, status: number) =>
  page(
    env,
    { title: 'Connect Slack', lead, status, headers: privatePage },
    h('a', { href: url(env, MANAGE) }, 'Open your spaces'),
  )

let retry = (env: Env, status = 400) =>
  startAgain(
    env,
    'Open Connections in your space and connect Slack again.',
    status,
  )

let refused = (e: unknown) =>
  e instanceof CallError || (e instanceof OAuthError &&
    ['invalid_code', 'code_already_used', 'invalid_grant'].includes(e.code))

/** Accept a code from Slack's dashboard or its direct installation link. */
export let outside = async (
  req: Request,
  env: Env,
  params: URLSearchParams,
) => {
  let [code, extra] = params.getAll('code')
  if (!code || extra != null || params.has('error')) return retry(env)
  try {
    let c = ctxOf(env)
    let i = vaulted(env) ? await known(c.graph.read, 'slack') : undefined
    if (!i || !await signsInWith(c.vault, c.graph.read, i)) {
      return startAgain(
        env,
        'Slack is unavailable here right now. Try again later from Connections.',
        503,
      )
    }
    let [grant, who] = await Promise.all([
      redeemInstallation(c, i, code),
      account(req, env, dirOf(env)),
    ])
    let state = crypto.randomUUID()
    await hold(
      env,
      KIND,
      state,
      {
        integration: i.name,
        grant,
        person: who.person,
        until: Date.now() + MINUTES * 60_000,
      } satisfies Pending,
    )
    return go(url(env, CONNECTION_INSTALL), cookie(state, MINUTES * 60))
  } catch (e) {
    if (refused(e)) return retry(env)
    caught(e, { request: 'external connection authorization' })
    return retry(env, 502)
  }
}

let available = (p: Pending | null, person: string): p is Pending =>
  !!p && p.until > Date.now() && (!p.person || p.person == person)

/** Confirm the named workspace and attach it to an owned space. */
export let choose = async (req: Request, env: Env): Promise<Response> => {
  if (!['GET', 'POST'].includes(req.method)) {
    return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
  }
  let state = cookieValue(req.headers.get('cookie'), COOKIE)
  if (!state || !vaulted(env)) return retry(env)
  let dir = dirOf(env)
  let who = await account(req, env, dir)
  if (!who.person) return go(signInAt(url(env, CONNECTION_INSTALL), env))
  let person = who.person
  let pending = await waiting<Pending>(env, KIND, state)
  if (!available(pending, person)) return retry(env)
  let seats = (await dir.seats(person, 'owner')).filter((s) => !s.space.trashed)
  let spaces = seats.map((s) => s.space)
  let name = pending.grant.account_title || pending.grant.account
  if (req.method == 'GET') {
    return page(
      env,
      {
        title: 'Connect Slack',
        lead: `Choose the yaks.app space to connect to ${name}.`,
        headers: privatePage,
      },
      spaces.length
        ? installChoice(CONNECTION_INSTALL, state, spaces, 'Connect Slack')
        : h('a', { href: url(env, MANAGE) }, 'Open your spaces'),
    )
  }
  let form = await req.formData().catch(() => null)
  let space = spaces.find((s) => s.eid == form?.get('space'))
  if (form?.get('install') != state || !space) return retry(env, 403)
  try {
    let attached = await finish<Pending, boolean>(
      env,
      KIND,
      state,
      async (p) => {
        if (!available(p, person) || await dir.role(space, person) != 'owner') {
          throw new CallError('access', 'Choose a space you own.')
        }
        let c = ctxOf(env, { ...who, role: 'owner' })
        await finishConnection(
          env,
          await attachInstallation(c, space.eid, p.integration, p.grant),
        )
        return true
      },
    )
    return attached ? go(pageOf(env, space.slug), cookie('', 0)) : retry(env)
  } catch (e) {
    if (refused(e)) return retry(env, 403)
    caught(e, { request: 'attach external connection', space: space.slug })
    return startAgain(
      env,
      'Slack could not be connected. Reload this page to try again.',
      503,
    )
  }
}
