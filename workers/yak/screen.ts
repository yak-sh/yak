// A TV paired with a person (D-136180, T-136193): the device-code flow of
// RFC 8628. The TV opens yaks.app/tv and shows a short code; the person,
// signed in on their phone, types it at yaks.app/tv/pair; from then on the TV
// shows, read-only, whatever draft their agent is building, and follows them
// from app to app as their writes move.
//
// The TV writes nothing to be shown a code. Its code is its own, sealed into
// its cookie with when it was shown (`Held`), and the TV's row is named for
// the code (`screenAt`), so nothing exists in the directory until a signed-in
// person pairs it: no stranger's TV costs a row, and there is nothing to
// sweep. Pairing writes `screen{person, paired}` at that eid; the TV, asking
// after it, takes the pairing up once (`screen.at`), and only a pairing made
// after its code was shown, while the code was standing, is its own.
//
// The pairing is the TV's whole credential. Each thing the TV asks reads the
// row again, and the preview link it frames carries the screen (preview.ts
// `Ticket.screen`), which serves it as a viewer and answers nothing once the
// row is gone. So unpairing from the phone is deleting the row, and the TV is
// back to a code at its next look. Nothing the TV holds can write: not the
// draft, not the preview's data, not the person's account.
import type { Bundle } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import { labelKey } from '@yaks/secrets/signed'
import { writes } from '@yaks/member'
import { type Directory, directory, idOf } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { linkOf } from './preview.ts'
import { opened, seal } from './lib/token.ts'
import { sessionAt } from './session.ts'
import { source, within } from '@yaks/workerd/rate'
import { failing } from './defects.ts'
import { LIFE } from './signin.ts'
import { pairing, screenCode, watching } from './pages.ts'

/** The letters a code is made of: RFC 8628 §6.1's, no vowels, so no code
 * spells a word, and none of the letters a TV's font confuses. */
export let LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'

/** How many letters a code has: 20⁸, about 26 billion, against codes that
 * stand ten minutes ({@link LIFE}, a sign-in code's). */
export let LENGTH = 8

/** How often a TV asks whether it is paired, and then what to show: RFC
 * 8628's five seconds while it shows a code, longer once it shows a draft,
 * whose own page hears each write as it lands. */
export let ASK = { waiting: 5_000, paired: 15_000 }

// The cookie a TV keeps, at yaks.app/tv alone.
let COOKIE = 'yak_screen'
let PATH = '/tv'
// As long as a browser keeps a cookie: a paired TV stays paired until the
// person unpairs it.
let KEPT = 400 * 24 * 60 * 60

/** What a TV holds: the code it shows and when it began to, and whether it
 * has taken up the pairing that code found. */
export type Held = { code: string; at: number; taken?: boolean }

/** A fresh code. */
export let code = () =>
  Array.from(
    crypto.getRandomValues(new Uint32Array(LENGTH)),
    (n) => LETTERS[n % LETTERS.length],
  ).join('')

/** A code as a person typed it, or null for one that cannot be any code:
 * case, spaces and the dash between its halves are nobody's mistake. */
export let typed = (said: string) => {
  let letters = said.toUpperCase().replace(/[\s-]/g, '')
  return letters.length == LENGTH &&
      [...letters].every((l) => LETTERS.includes(l))
    ? letters
    : null
}

/** A code as the TV shows it: two halves of four. */
export let shown = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

/** The TV's row: named for its code under the platform's secret, so the
 * eid says nothing of the code and nobody without the secret can name it. */
export let screenAt = async (code: string, secret: string) =>
  derivedEid(
    `screen|${
      new Uint8Array(
        await crypto.subtle.sign(
          'HMAC',
          await labelKey(secret, 'yaks.app/screen'),
          new TextEncoder().encode(code),
        ),
      ).toHex()
    }`,
  )

/** A pairing, as its row reads. */
export type Screen = {
  eid: string
  person: string
  paired: string
  at: string | null
}

let screenOf = (row: Bundle): Screen | null => {
  let s = row.screen as
    | { person?: unknown; paired?: string; at?: string }
    | undefined
  return s?.person && s.paired
    ? {
      eid: row.entity.eid,
      person: idOf(s.person as string),
      paired: s.paired,
      at: s.at ?? null,
    }
    : null
}

/** The pairing standing at a row, or null. */
export let screen = async (dir: Directory, eid: string) => {
  let [row] = await dir.read(`.entity.eid=${eid}&.screen`)
  return row ? screenOf(row) : null
}

/** A person's screens, newest first. A code they typed that no TV took up
 * in its ten minutes was never on a screen, so it goes as it is read. */
export let screens = async (dir: Directory, person: string, now: number) => {
  let all = (await dir.read(`.screen.person=${person}`))
    .map(screenOf)
    .filter((s): s is Screen => !!s)
  let stale = all.filter((s) => !s.at && Date.parse(s.paired) + LIFE <= now)
  if (stale.length) {
    await dir.stamp({
      entities: stale.map((s) => ({ entity: { eid: s.eid }, tombstone: {} })),
    })
  }
  return all.filter((s) => !stale.includes(s))
    .sort((a, b) => b.paired.localeCompare(a.paired))
}

/** Why a code pairs nothing, said to the person who typed it. */
export let UNKNOWN =
  'That code does not match a screen. Check the code on your TV and try again.'

/**
 * Pair the TV showing `code` with `person`. Only a code no pairing stands at
 * is paired; one already paired with this person is theirs already.
 */
export let pair = async (
  dir: Directory,
  secret: string,
  person: string,
  said: string,
  now: number,
): Promise<string | null> => {
  let letters = typed(said)
  if (!letters) return UNKNOWN
  let eid = await screenAt(letters, secret)
  let standing = await screen(dir, eid)
  if (standing) return standing.person == person ? null : UNKNOWN
  try {
    await dir.stamp({
      entities: [{
        entity: { eid },
        screen: { person, paired: new Date(now).toISOString() },
        $was: { screen: { person: token(null) } },
      }],
    })
  } catch (e) {
    if (e instanceof Stale) return UNKNOWN
    throw e
  }
  return null
}

/** Unpair one of a person's screens: its row goes, and with it the TV's
 * every way in. Someone else's screen is not theirs to touch. */
export let unpair = async (dir: Directory, person: string, eid: string) => {
  let s = eid ? await screen(dir, eid) : null
  if (s?.person != person) return false
  await dir.stamp({ entities: [{ entity: { eid }, tombstone: {} }] })
  return true
}

/** Where a TV stands: showing a code, or paired. `fresh` is whether what it
 * holds changed, for its cookie to hold anew. */
export type Standing =
  | { paired: false; held: Held; fresh: boolean }
  | { paired: true; held: Held; fresh: boolean; screen: Screen }

/** What the TV holding `held` (or nothing yet) stands at now: its pairing,
 * the code it already shows, or a new code once its own has run out or its
 * pairing has gone. A pairing made before the TV began showing this code, or
 * after the code ran out, is not its own. */
export let standing = async (
  dir: Directory,
  secret: string,
  held: Held | null,
  now: number,
): Promise<Standing> => {
  if (held) {
    let s = await screen(dir, await screenAt(held.code, secret))
    let paired = s && Date.parse(s.paired)
    if (s && paired! >= held.at && paired! < held.at + LIFE) {
      if (!s.at) {
        let at = new Date(now).toISOString()
        await dir.stamp({
          entities: [{
            entity: { eid: s.eid },
            screen: { at },
            $was: { screen: { at: token(null) } },
          }],
        }).catch((e) => {
          if (!(e instanceof Stale)) throw e
        })
        s = { ...s, at }
      }
      return held.taken ? { paired: true, held, fresh: false, screen: s } : {
        paired: true,
        held: { ...held, taken: true },
        fresh: true,
        screen: s,
      }
    }
    if (!s && !held.taken && now < held.at + LIFE) {
      return { paired: false, held, fresh: false }
    }
  }
  return { paired: false, held: { code: code(), at: now }, fresh: true }
}

/** What a paired TV shows: the app the person last wrote a draft in, at a
 * preview link that serves it to this screen alone, or nothing while they
 * have no draft they may still preview. */
export type Showing = { app: string; title: string; url: string } | null

export let showing = async (
  env: Env,
  dir: Directory,
  s: Screen,
): Promise<Showing> => {
  let [row] = await dir.read(
    `.written.by=${s.person}&.order=-written.at&.limit=1`,
  )
  let written = row?.written as { app?: string } | undefined
  if (!written?.app) return null
  let app = idOf(written.app)
  let [named] = await dir.read(`.entity.eid=${app}&.app`)
  let space = (named?.app as { space?: string } | undefined)?.space
  if (!space) return null
  let found = await dir.target(idOf(space), s.person, app)
  if (
    !found.space || !found.app || found.space.trashed || found.app.trashed ||
    !writes(found.role)
  ) return null
  let who = { person: s.person, role: 'viewer' as const, via: s.eid }
  let { at } = await linkOf(
    { env, dir, person: s.person },
    found.space,
    found.app,
    who,
    s.eid,
  )
  return {
    app: found.app.eid,
    title: found.app.title || found.app.slug,
    url: at,
  }
}

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

let cookieOf = (req: Request) =>
  (req.headers.get('cookie') ?? '').split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? null

let heldIn = async (req: Request, secret: string) => {
  let sealed = cookieOf(req)
  let held = sealed ? await opened<Held>('screen', sealed, secret) : null
  return typeof held?.code == 'string' && typeof held.at == 'number'
    ? held
    : null
}

let keeping = async (held: Held, secret: string) =>
  `${COOKIE}=${await seal('screen', held, secret)}; Path=${PATH}; ` +
  `Max-Age=${KEPT}; Secure; HttpOnly; SameSite=Lax`

let redirect = (to: string, status = 303) =>
  new Response(null, { status, headers: { location: to } })

let unstored = { 'cache-control': 'private, no-store' }

/** The TV's two doors and the phone's three: `/tv` the TV's page,
 * `/tv/now` what it asks after, `/tv/pair` the person's page and its form,
 * `/tv/unpair` a screen's Unpair button. */
export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let secret = env.SESSION_SECRET
  let path = new URL(req.url).pathname.replace(/\/$/, '') || '/'
  if (!secret) return new Response('Not found', { status: 404 })
  let dir = dirOf(env)
  let now = Date.now()

  if (path == PATH || path == `${PATH}/now`) {
    if (req.method != 'GET') return new Response(null, { status: 405 })
    let at = await standing(dir, secret, await heldIn(req, secret), now)
    let headers: Record<string, string> = { ...unstored }
    if (at.fresh) {
      headers['set-cookie'] = await keeping(at.held, secret)
    }
    let shows = at.paired ? await showing(env, dir, at.screen) : null
    if (path == `${PATH}/now`) {
      return Response.json(
        at.paired
          ? { paired: true, showing: shows }
          : { paired: false, code: shown(at.held.code) },
        { headers },
      )
    }
    let page = at.paired
      ? watching(shows, env)
      : screenCode(shown(at.held.code), at.held.at + LIFE - now, env)
    for (let [k, v] of Object.entries(headers)) page.headers.set(k, v)
    return page
  }

  let person = (await sessionAt(req, secret))?.person ?? null
  let url = new URL(req.url)
  if (path == `${PATH}/pair` && req.method == 'GET') {
    if (!person) {
      return redirect(
        `/login?return=${encodeURIComponent(url.pathname + url.search)}`,
        302,
      )
    }
    return pairing(
      {
        code: url.searchParams.get('code') ?? '',
        done: url.searchParams.has('paired')
          ? 'paired'
          : url.searchParams.has('unpaired')
          ? 'unpaired'
          : null,
        screens: await screens(dir, person, now),
      },
      200,
      env,
    )
  }
  if (path == `${PATH}/pair` && req.method == 'POST') {
    if (!person) return redirect(`/login?return=${PATH}/pair`)
    let said = String(
      (await req.formData().catch(() => null))?.get('code') ?? '',
    )
    let no = await within(env.SIGNIN_RATE, source(req), failing('rate limit'))
      ? await pair(dir, secret, person, said, now)
      : 'Too many codes have been tried from here just now. Wait a minute ' +
        'and try again.'
    if (!no) return redirect(`${PATH}/pair?paired`)
    return pairing(
      { code: said, why: no, screens: await screens(dir, person, now) },
      400,
      env,
    )
  }
  if (path == `${PATH}/unpair` && req.method == 'POST') {
    if (!person) return redirect(`/login?return=${PATH}/pair`)
    let eid = String(
      (await req.formData().catch(() => null))?.get('screen') ?? '',
    )
    await unpair(dir, person, eid)
    return redirect(`${PATH}/pair?unpaired`)
  }
  return new Response('Not found', { status: 404 })
}
