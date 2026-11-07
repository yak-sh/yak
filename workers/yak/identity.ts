// The identity part (D-32318 §Auth): one sign-in for the whole platform, at
// the apex, and the OAuth 2.1 door agents come through. Two ways in, one
// answer — a person's eid — which every other part reads through `withAuth`
// (asking.ts).
//
// A person proves who they are by receiving mail: `POST /login` mints a
// six-digit code (signin.ts) — up to three an hour for any one address, and
// over that it mints nothing and mails nothing while answering the same card,
// so the ceiling says nothing about the address (T-33020) — and hands it to
// the mail seam (mail.ts); or a text, when the address is a US mobile number
// and the platform texts strangers (T-136826);
// `POST /login/code` spends it, finds or mints the person, and sets the
// platform session cookie (lib/token.ts). No password exists to lose. Those
// two steps are the whole of signing up (T-34236): give the address, prove it,
// and land on your own space. The card asks nothing else — what a person is
// called (T-32654) and the address their apps live at (T-32967) are set on the
// space page's owner block, where they can see what they are naming, and at
// `/connect`, which still carries the address for as long as nothing is built
// there (T-34137).
// A person sent here from a page they could not use arrives as
// `/login?return=<url>`:
// both cards carry that address forward, and the spent code lands them back on
// it when it is one of ours (T-32593). Somebody already signed in is never
// shown the email box — `GET /login` reads the session first. A customer's
// own domain asks for a click before receiving a session for its space;
// other returns land on our zone or the dashboard (T-34209).
//
// Or they follow a LINK (link.ts, T-34351). Every code letter carries one that
// spends that same code, so a person reading it on a phone types nothing; and
// `POST /login/link` mints a standing one, which signs its holder in until the
// expiry its minter set. That is the credential an app directory's reviewer is
// given — OpenAI rejects anything behind a mailbox — and it is worth a session
// and no more: it is minted by the account it signs in, from a browser cookie
// that is the longer-lived of the two, and `GET /login/link` lands whoever
// follows it exactly where a spent code lands them.
//
// An agent proves who it is with a bearer token from
// `@cloudflare/workers-oauth-provider`, which owns `/oauth/token`,
// `/oauth/register`, and the two well-known metadata documents. Both ways a
// connector can name itself are open: Client ID Metadata Documents, which
// MCP's 2026-07-28 revision prefers — the client_id is an https URL serving
// its own metadata, which the provider fetches and validates — and dynamic
// registration, kept for clients that only speak RFC 7591. CIMD needs the
// `global_fetch_strictly_public` compatibility flag beside the option
// (wrangler.toml), and the provider advertises
// `client_id_metadata_document_supported` only when it has both. The consent
// page is the sign-in page: signing in is granting, and an already-signed-in
// browser gets one Allow button. The grant carries `{person}` as its props,
// so a token resolves to the same eid a cookie does.
//
// A third way in is minted from the second: a GRANT (grants.ts, T-34385), the
// short-lived bearer the connector hands a person for their own terminal.
// This door verifies it — it is a sealed value of ours, not the provider's, so
// `asking` opens it (asking.ts) — and it resolves to the same eid the other two do,
// with a life of hours and a row that can be deleted to end it.
//
// Whether we claim CIMD at all is the `CIMD` env var (`cimd` below), on
// unless it says `off`. It works for both: Claude's hosted document signs a
// person in through it (T-32465), and ChatGPT's — chatgpt.com/oauth/client.json,
// a 404 when T-33027 looked and published since — renders our consent page
// under its own name (checked 2026-09-05). The lever is kept anyway, and it is
// the advertisement rather than the code path: dropped, the well-known stops
// claiming support and a URL client_id is looked for in the store like any
// other, which leaves a client dynamic registration to fall back to.
//
// An agent, once connected, stays connected (T-34416). The owner: "the oauth
// should never expire". So the refresh token has no expiry and the access
// token lives a year (`opts`), and a public client's refresh is taken even
// when it carries a `client_secret` it was never issued (`plain`), which is
// what ChatGPT sends and what used to read to a person as an expired
// connection. What closes a connector is the person closing it.
//
// The first person ever to sign in owns the meta space: while `yak` has no
// members at all, this writes `member(yak, person, owner)` (directory.ts
// `memberless`). After that the ordinary membership rule holds. It is the
// only way that row is ever written: nothing serves the meta store at an
// address (apps.ts), so no request can write the directory from outside.
import { claimed } from './attribution.ts'
import { apex, type Host, url as hostUrl } from './host.ts'
import {
  AuthorizationError,
  type AuthRequest,
  CimdFetchError,
  getOAuthApi,
  type ListOptions,
  type OAuthHelpers,
  OAuthProvider,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider'
import { opened, seal } from './lib/token.ts'
import {
  agentsOf,
  disconnect,
  disconnectAll,
  replace,
  servicesOf,
} from './connected.ts'
import {
  consented as handoffConsented,
  consenting as handoffConsenting,
  destination,
  HANDOFF,
  handoffTo,
  opener,
  safeNext,
  spender,
} from './handoff.ts'
export { HANDOFF } from './handoff.ts'
import { planCard } from './billing.ts'
import { payments } from './payments.ts'
import { daysLeft, directory, META, RESERVED, type Space } from './directory.ts'
import {
  doomed,
  erase,
  keeping,
  kept,
  naming,
  refused,
  ticketed,
  trashSpace,
  went,
} from './erase.ts'
import { ledger, revoke as revokeGrants } from './grants.ts'
import {
  links,
  type Once,
  onceLink,
  type Pass,
  passOf,
  revoke,
  stand,
  whose,
} from './link.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { door } from './invite.ts'
import { mail, mailable } from './mail.ts'
import { fault } from './unseen.ts'
import { type Clock, clock, timed } from './timing.ts'

// What the sign-in card says when no letter can leave: the deploy's operator
// reads which secret is missing, and a visitor reads that nothing is wrong
// with their address.
export let NO_MAIL = 'Sign-in mail is not switched on here yet: this deploy ' +
  'has no MAIL_TOKEN (README, Configuration).'
// Too many codes asked for from one place (rate.ts): about the source, never
// the address, so saying it tells nobody anything about an inbox.
export let TOO_MANY = 'Too many codes have been asked for from here just ' +
  'now. Try again in a minute.'
export let NOT_EMAIL = 'That is not an email address. Check it and try again.'
export let NOT_ADDRESS = 'That is not an email address or a US mobile ' +
  'number. Check it and try again.'
import { KERNEL, type Meta, meta } from './meta.ts'
import {
  askAllow,
  askCode,
  askDelete,
  askEmail,
  askHandoff,
  askLink,
  connect,
  deleted,
  lost,
} from './pages.ts'
import { chatPath, hostOf, LOGOUT, MANAGE, OAUTH, onZone } from './route.ts'
import { INVITE, LINK, SLUG } from '@yaks/platform/names'
import { counted, FULL, keep, oneBuild, START } from './newcomer.ts'
import {
  called,
  canon,
  codeLetter,
  codeText,
  guess,
  mac,
  mayText,
  mint,
  nameOf,
  personOf,
  spend,
  texted,
  visitor,
} from './signin.ts'
import { textable } from './phones.ts'
import { RETRY, source, within } from './rate.ts'
import { type Caller, minted, sessionAt, signedOut } from './session.ts'
import { WHO } from './signed.ts'
import { versionOf } from './running.ts'
import { background, caught, refusing } from './defects.ts'
import { step } from './funnel.ts'
import * as ads from './ads.ts'
import { consentEid, shown } from '@yaks/phone'
import { credit } from './referral.ts'
import { unauthorized, withAuth } from './asking.ts'

// What a grant carries and a token gives back: the person, nothing else.
// Membership is read from the directory at request time, never a claim.
type Props = { person: string }

// Who is asking, and how they got in: session.ts's word, beside `Who`. Said
// again here because this door is what mints one, and every caller of it
// reads the type off this module.
export type { Caller }

// The provider's helpers over this env: parsing an authorize request,
// naming a client, writing a grant, unwrapping a token. `opts` is the same
// configuration `fetch` runs, so the two never disagree.
let api = (env: Env) => getOAuthApi<Env>(opts(env), env)

/** The person an OAuth access token was granted for, and when it ends
 * (asking.ts `asking`). */
export let unwrapped = async (env: Env, token: string) => {
  let held = await api(env).unwrapToken<Props>(token)
  return { person: held?.grant.props?.person, until: held?.expiresAt }
}

// Every credential the platform gave a person, taken back: their connectors'
// and the box's OAuth grants, the CLI's grants and their standing sign-in
// links. An erased account's token otherwise outlives it (T-144541): a grant
// never expires, and the next call as it wrote the dead row back.
export let unheld = async (env: Env, person: string) => {
  await disconnectAll(api(env), person)
  let granted = ledger(env.OAUTH_KV)
  if (granted) await revokeGrants(granted, person, '')
  let standing = links(env.OAUTH_KV)
  if (standing) await revoke(standing, person, '')
}

// Where signing in happens, and the sentence a refusal says about it. A
// refusal is read by a person's agent, so it says a sentence beside its code
// and names where signing in happens — the treatment every other door already
// had, and the one this one missed (C-32607 item 1, apps.ts says). The address
// itself lives in route.ts, with the platform's other addresses, and
// is re-exported here because this is where the doors read it.
export { SAYS, SIGN_IN } from './route.ts'

let redirect = (to: string, set?: string, status = 302) =>
  new Response(null, {
    status,
    headers: { location: to, ...(set ? { 'set-cookie': set } : {}) },
  })

// Where a signed-in person lands: the page they came from, when it is on our
// own zone — an off-zone address is ignored and never followed, the field
// being a stranger's to fill in (route.ts `onZone`). Sent nowhere in
// particular, they land on their dashboard, which shows their own space
// (apps.ts `manage`).
//
// Several spaces, and the one they came in on wins — but that is the return
// address doing it, not a rule of its own: a space's index sends someone here
// with `return=https://<space>.yaks.app/` (apps.ts `signInAt`), and that
// address is on our zone, so it is followed.
let backTo = (back: string, env: Host) =>
  (back && onZone(back, env)) || hostUrl(env, MANAGE)

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

// The address on a person's row, which says whom a funnel step is for
// (funnel.ts `step`): null for a row with none, such as a newcomer's.
let addressIn = (row?: Record<string, unknown>) =>
  (row?.email as { address?: string } | undefined)?.address ?? null

// The provider as connected.ts reads it. A client whose metadata document
// cannot be fetched just now is unknown, not gone: its grants still stand.
let grants = (env: Env) => {
  let oauth = api(env)
  return {
    listUserGrants: (person: string, options?: ListOptions) =>
      oauth.listUserGrants(person, options),
    revokeGrant: (id: string, person: string) => oauth.revokeGrant(id, person),
    lookupClient: async (id: string) => {
      try {
        return await oauth.lookupClient(id)
      } catch (error) {
        if (error instanceof CimdFetchError) return undefined
        throw error
      }
    },
  }
}

export let agents = (env: Env, person: string) => agentsOf(grants(env), person)

/** The outside services holding a grant from this person (connected.ts). */
export let services = (env: Env, person: string) =>
  servicesOf(grants(env), person)

// Who is asking, out of the platform session cookie and nothing else. It is
// deliberately not `withAuth` above, which also answers an agent's bearer:
// the door below belongs to the signed-in web surface, and an agent that
// cannot reach it cannot be talked into it (billing.ts `buyer` takes the same
// line for a purchase, C-33033).
let browser = async (env: Env, req: Request) => {
  return (await sessionAt(req, env.SESSION_SECRET))?.person ?? null
}

// Closing a space (erase.ts, T-33166): `/space/<slug>/delete`, the one door a
// space is ever closed at — so a person, signed in, is the only caller who
// ever reaches it.
//
// Two acts, one door (T-34431). By default it puts the space in the trash:
// nothing is erased, everything is kept for thirty days, and the owner takes
// it back from the space's own address. `forever` is the other one, and the
// only way to ask for it is a ticket the letter carried, because the kernel
// signs the ticket and nobody else can mint one — so a person who came
// straight off the web is offered the act that can be taken back, and the one
// that cannot is the one their assistant had to be asked for out loud.
//
// The GET only ever draws. A mail client that fetches every link in a letter
// before anyone reads it must not be able to delete a space by doing its job,
// so the act is the POST and the page is what asks for it.
//
// A space that is not this person's answers exactly what a space that does
// not exist answers: a stranger learns nothing about anybody's address here.
//
// The POST is a write, so a page at any other address is refused before it
// gets here (route.ts `guarded`). `SameSite=Lax` is no help with that: every
// space is same-site with the apex, so a form posted from a page in anybody's
// space arrives carrying the cookie (T-37874).
let closing = async (
  req: Request,
  env: Env,
  slug: string,
  form: { confirm: string; token: string },
) => {
  let url = new URL(req.url)
  let person = await browser(env, req)
  // Signed out — which is what an agent is here, having no cookie — they are
  // sent to sign in and handed back to this very page (T-32593). The return
  // address is on our own zone by construction.
  if (!person) {
    return redirect(
      `/login?return=${encodeURIComponent(url.pathname + url.search)}`,
    )
  }
  // Fresh reads, every one: this is the one act that cannot be taken back, so
  // an app made a moment ago must not be missed because a 30-second read cache
  // had not heard of it — its store and its bytes would outlive the space and
  // be inherited by whoever takes the address next (directory.ts fresh,
  // billing.ts reads the same way).
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let space = await dir.space(slug)
  if (!space || (await dir.role(space, person)) != 'owner') return lost(env)
  let d = await doomed(dir, space)
  // The letter's ticket, if this visit carries one: minted for this space and
  // this person, and dead after an hour (erase.ts). It stands in for typing
  // the name, because following a link out of a letter that named everything
  // about to go is the deliberate act the typing is there to be — and it is
  // what carries `forever`.
  let held = req.method == 'POST' ? form.token : url.searchParams.get('t') ?? ''
  let ok = held ? await ticketed(held, secret(env)) : null
  let mine = !!ok && ok.space == space.eid && ok.person == person
  let forever = mine && !!ok?.forever
  let lines = forever ? naming(d, env) : keeping(d, env)
  let stop = await refused(space, env) ||
    // Already there, and this visit is not the one that erases it: trashing
    // again would start the thirty days over on a space the person is only
    // looking at, so nothing happens and they are told both ways out.
    (space.trashed && !forever
      ? `${slug} is already in the trash, ${
        daysLeft(space.trashed)
      } days left. Restore it at https://${slug}.${apex(env)}/, or ask your ` +
        'assistant to delete it for good'
      : '')
  if (stop) return askDelete({ slug, lines, stop, forever, status: 409 }, env)
  if (req.method != 'POST') {
    return askDelete({
      slug,
      lines,
      forever,
      token: mine ? held : null,
      why: held && !mine
        ? 'That link has expired or was for something else. You can still ' +
          'delete this space by typing its name.'
        : undefined,
    }, env)
  }
  if (!mine && form.confirm.trim() != slug) {
    return askDelete({
      slug,
      lines,
      forever,
      why: `Type ${slug} exactly, and it goes${
        forever ? '' : ' to the trash'
      }.`,
      status: 400,
    }, env)
  }
  try {
    let who = { person, role: 'owner' as const }
    if (!forever) {
      await trashSpace(env, dir, space, who)
      return deleted(kept(d, env), false, env)
    }
    return deleted(went(d, await erase(env, dir, d, who), env), true, env)
  } catch (e) {
    // What could not be finished is said on the page rather than swallowed
    // behind the soft error page: a domain Cloudflare would not give back is
    // the one failure here that costs money, and asking again finishes what
    // did not go (erase.ts holds the order that makes that safe).
    caught(e, { request: 'POST /manage (delete)', space: slug })
    return askDelete({
      slug,
      lines,
      forever,
      why: `That did not finish: ${e instanceof Error ? e.message : String(e)}`,
      status: 502,
    }, env)
  }
}

// The connector page as this person sees it: their own address, their plan
// and the instructions. `own` is the same call sign-in makes, so someone who
// signed in before spaces existed gets theirs here (T-32482).
//
// Keep the setup destination through sign-in. The login form carries its
// fragment too, because a provider chosen in a link never reaches the server.
let theirs = async (env: Env, req: Request, said?: string, say?: string) => {
  let who = await withAuth(env, req)
  if (!who) return redirect('/login?return=%2Fconnect', undefined, 303)
  let dir = dirOf(env)
  let space = await dir.own(who.person)
  let provider = await payments(env)
  return connect(
    {
      slug: space.slug,
      agents: await agents(env, who.person),
      said,
      say,
      no: !!say,
      // What they pay, and the two doors that change it (billing.ts, T-33125).
      // `known` is whether the payment provider has ever met this space:
      // somebody who cancelled still reaches their own invoices.
      plan: planCard(provider.plans, space),
      provider: provider.name,
      paid: new URL(req.url).searchParams.get('paid') == '1',
    },
    say ? 400 : 200,
    env,
  )
}

// Taking an address: the space wears the slug its owner chose, at any time —
// the same move space_set makes (directory.ts `rename`, D-131924), so the
// apps go with it, the address it leaves redirects until another space takes
// it, and nothing in the bucket moves. Answers the address or a sentence,
// never both; the card renders whichever it gets.
//
// `at` names which space, for the owner block on a space's own page, where
// the answer is the space being looked at rather than whichever one `own()`
// calls theirs (apps.ts `saved`, T-34236). `/connect` names none and means
// their own.
export let choose = async (
  env: Env,
  person: string,
  want: string,
  at?: Space,
): Promise<{ address?: string; slug?: string; error?: string }> => {
  let dir = dirOf(env)
  let space = at ?? await dir.own(person)
  if (want == space.slug) {
    return { address: `${want}.${apex(env)}`, slug: want }
  }
  if (!SLUG.test(want)) {
    return {
      error: 'An address is lowercase letters, numbers and dashes, ' +
        'starting with a letter or a number — like dana or dana-notes.',
    }
  }
  if (RESERVED.has(want)) {
    return {
      error: `${want}.${apex(env)} is kept for yaks.app itself. Try another?`,
    }
  }
  if (space.slug == META.space) {
    return { error: `${META.space} is the platform itself, and stays put.` }
  }
  if (await dir.space(want)) {
    return { error: `${want}.${apex(env)} is taken. Try another?` }
  }
  try {
    // The title follows the address for a space nobody has named, which is
    // known by the name it answers to (directory.ts `own`); a name somebody
    // gave it stays.
    await dir.rename(space, {
      slug: want,
      title: space.title == space.slug ? want : null,
    }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
  } catch {
    // Two people can want one name at once; the unique slug decides, and the
    // loser is told the ordinary thing rather than shown a broken page.
    return { error: `${want}.${apex(env)} is taken. Try another?` }
  }
  return { address: `${want}.${apex(env)}`, slug: want }
}

// The secret signs sessions and keys the code digests. Unset, sign-in cannot
// work at all, and saying so out loud beats a token nobody can verify: the
// throw becomes an exception entity behind the soft page (index.ts).
let secret = (env: Env) => {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set')
  return env.SESSION_SECRET
}

// The custom-domain end of the handoff (index.ts routes HANDOFF here on a
// foreign host, before `aimed` would carry it to the app): the person
// authenticated on the platform and arrived with a one-time token bound to this
// host. `opener` (handoff.ts) verifies and spends it; on success we mint this
// hostname's own host-only cookie — `domainOf` answers '' for a foreign host,
// so the cookie sticks to it and no other — and send them on with the token
// stripped from the address and no referrer to carry it off the page. A token
// that fails any check becomes a fresh sign-in on the platform, aimed back at
// where they were, with consent asked again before a handoff is issued.
export let handoff = async (req: Request, env: Env): Promise<Response> => {
  let url = new URL(req.url)
  let to = safeNext(url.searchParams.get('next') ?? '/')
  let hand = await opener(
    url.searchParams.get('t') ?? '',
    secret(env),
    hostOf(req, env),
    spender(env.OAUTH_KV),
  )
  let at = await dirOf(env).serves(hostOf(req, env))
  if (!hand || !at || hand.space && hand.space != at.space.eid) {
    return redirect(
      `https://${apex(env)}/login?return=${
        encodeURIComponent(`https://${hostOf(req, env)}${to}`)
      }`,
    )
  }
  await claimed(req, env, hand.person)
  return new Response(null, {
    status: 303,
    headers: {
      location: to,
      'set-cookie': await minted(
        req,
        env,
        secret(env),
        hand.person,
        at.space.eid,
      ),
      'referrer-policy': 'no-referrer',
    },
  })
}

/**
 * The person is known, and signing in is having a space (T-32482): theirs
 * already, or minted here at the front of their address, so no agent ever has
 * to ask them for a name and the card asks nothing but the address and the
 * code (T-34236). It is also what their dashboard shows when nothing else aims
 * them (`backTo`), and the first person ever to arrive owns the platform.
 * Every way of signing up ends here: a code, a link, a letter (`joined`) and
 * a text (`textedIn`).
 */
export let settle = async (env: Env, person: string): Promise<Space> => {
  let dir = dirOf(env)
  let own = await dir.own(person)
  let space = await dir.space(META.space)
  if (space && await dir.memberless(space)) {
    await meta(env).apply([{
      entity: { eid: '$seat' },
      member: { space: space.eid, person, role: 'owner' },
    }], KERNEL)
  }
  return own
}

// Whoever's invite the words a person signed up with carry is credited with
// them (referral.ts `credit`), for the month it gives once they build an app.
// A failure there is reported, and the sign-up stands.
let invitedBy = async (env: Env, person: string, said: string) => {
  try {
    await credit(dirOf(env), person, said)
  } catch (e) {
    caught(e, { request: 'invite credit' })
  }
}

// Whether the person at an address already has a space of their own, which
// is who the Operator's letter greets as met (signin.ts `GREETING`) and whose
// letter to the sign-up address is no sign-up (inbox.ts `signingUp`).
export let met = async (env: Env, email: string) => {
  let dir = dirOf(env)
  let person = await dir.personAt(canon(email))
  return !!person && (await dir.seats(person, 'owner')).length > 0
}

/**
 * Signing up by a letter whose domain vouched for its sender (inbox.ts,
 * D-136811): the same sign-up a code gives, for someone who never opened the
 * page. The person behind the address, found or minted and called what the
 * letter called them, else the front of their address; whoever's invite the
 * letter's words carry, credited; and their own space.
 */
export let joined = async (
  env: Env,
  email: string,
  name?: string,
  said = '',
) => {
  let person = await personOf(meta(env), email, name || nameOf(null, email))
  await invitedBy(env, person, said)
  return { person, space: await settle(env, person) }
}

/**
 * Signing up by a text to the platform's number (operator-texts.ts,
 * D-136811): the same sign-up, for a number nobody wears. The person is minted
 * wearing it, with the words they sent kept as their consent to be texted
 * back (`sms_consent`, in one write with them, so no person is left with a
 * number and no consent), whoever's invite those words carry credited, and
 * given their own space.
 */
export let textedIn = async (
  env: Env,
  number: string,
  consent: string,
  at: string,
) => {
  let person = crypto.randomUUID()
  await meta(env).apply([
    { entity: { eid: person }, person: {}, phone: { number } },
    {
      entity: { eid: consentEid(person) },
      sms_consent: { person, consent, at },
    },
  ], KERNEL)
  await invitedBy(env, person, consent)
  return { person, space: await settle(env, person) }
}

// The person is known: the cookie, the space that is theirs, the first-owner
// bootstrap, and wherever they were going.
//
// `via` is how they proved it, when this visit proved anything — a code typed
// or a link followed (link.ts). It is stamped on the person, one row, so it
// says the last way in rather than a trail, which is the question a standing
// link raises: has anybody used it at all. An already-signed-in browser lands
// here too and names none, because nothing was proved.
let landed = async (
  req: Request,
  env: Env,
  person: string,
  q: string,
  back: string,
  via?: 'code' | 'link',
  c: Clock = clock(),
) => {
  let store = meta(env)
  let dir = dirOf(env)
  await c.time(
    'keep',
    async () => keep(env, dir, await browser(env, req), person),
  )
  // Their space, and the platform for the first person ever, are settled
  // behind the answer, which needs neither: it is the session and where to
  // send them. A door that shows them their space finds it, or mints it in
  // the same one write (directory.ts `own`), one space between the two, so a
  // new person's first page never waits on more than that (T-148852).
  background(
    settle(env, person).then(() => {}, (e) => fault(env, 'settle', e)),
  )
  // A person who has never signed in before is the funnel's sign-up
  // (funnel.ts): the first time, whether their row came from this sign-in or
  // from somebody inviting them. The stamp is written after the answer,
  // which says nothing that depends on it (T-34158).
  if (via) {
    let [row] = await c.time(
      'signed',
      () => store.query(`.entity.eid=${person} ?signed_in ?email`),
    )
    background(
      store.apply([{
        entity: { eid: person },
        signed_in: { at: new Date().toISOString(), via },
      }], KERNEL).then(() => {}, (e) => fault(env, 'signed_in', e)),
    )
    let who = addressIn(row)
    step(env, 'signed_in', req, { who })
    if (!row?.signed_in) {
      step(env, 'signup', req, { who })
      ads.after(env, 'signup', req)
    }
  }
  await c.time('claimed', () => claimed(req, env, person))
  let set = await minted(req, env, secret(env), person)
  // A customer's own hostname asks for a click before receiving a session:
  // proving the account on our site does not authorize signing into theirs.
  // Other returns are our own zone or the fallback, decided by `backTo`.
  if (q) return allow(req, env, q, person, set)
  let at = back
    ? await c.time('destination', () => destination(dir, back, env))
    : null
  if (at) {
    let page = askHandoff(
      at.host,
      back,
      await handoffConsenting(
        secret(env),
        person,
        back,
        at.space,
      ),
      env,
    )
    page.headers.set('set-cookie', set)
    return page
  }
  return redirect(backTo(back, env), set, 303)
}

/**
 * An app idea from the home page's box, built (D-146737). Somebody signed in
 * builds in their own space. A stranger becomes a newcomer: a person with no
 * address yet, signed in on this browser, whose space holds one build's
 * dollars (newcomer.ts `oneBuild`), once the day and their address have builds
 * left (`counted`); past either they meet the sign-in card saying so.
 */
let begun = async (req: Request, env: Env, said: string) => {
  let words = said.trim().slice(0, SAID)
  if (!words) return redirect(hostUrl(env, '/'), undefined, 303)
  let person = await browser(env, req)
  // A cookie outlives a newcomer whose space nobody kept and was erased
  // (erase.ts `vacated`): their browser is a stranger again.
  let [known] = person
    ? await meta(env).query(`.entity.eid=${person}&.person ?email`)
    : []
  if (!known) person = null
  let set: string | undefined
  if (!person) {
    if (!await counted(env, await visitor(secret(env), source(req)))) {
      return signCard(env, { why: FULL, status: 429 })
    }
    person = crypto.randomUUID()
    await meta(env).apply([{
      entity: { eid: person },
      person: {},
      newcomer: { at: new Date().toISOString() },
    }], KERNEL)
    set = await minted(req, env, secret(env), person)
  }
  let space = await settle(env, person)
  if (set) await oneBuild(env, space)
  let request = crypto.randomUUID()
  let chat = hostUrl(env, chatPath(space.slug, request))
  let { operatorDoor } = await import('./build-door.ts')
  await operatorDoor(env, space, { person, role: 'owner' }, 'receive', {
    say: words,
    request: {
      channel: 'chat',
      files: [],
      page: hostUrl(env, chatPath(space.slug)),
    },
    options: { id: request },
  })
  step(env, 'started', req, { who: addressIn(known) })
  return redirect(chat, set, 303)
}

// The longest idea the box takes, in characters: a few paragraphs.
let SAID = 4000

/** A code attempt either opens or returns the same closed sign-in card. */
export let codeCheck = async (
  store: Meta,
  address: string,
  digest: string,
  q = '',
  back = '',
  env: Host = {},
): Promise<Response | null> =>
  await guess(store, address, digest) ? null : askCode({
    address,
    q,
    back,
    why:
      'That code has expired or was mistyped. Type it again, or send a new one.',
    status: 400,
  }, env)

// The number a person wears, for one with no address.
let phoneAt = async (env: Env, person: string) => {
  let [row] = await meta(env).query(`.entity.eid=${person}`) as {
    phone?: { number: string }
  }[]
  return row?.phone?.number ?? null
}

// The sign-in card, saying whether a number works on it here (`textable`).
let signCard = async (env: Env, at: Parameters<typeof askEmail>[0] = {}) =>
  askEmail({ ...at, texts: await textable(env) }, env)

// A letter's one click, spent: the very code the form would have spent
// (signin.ts), so following the link is single use, dies with the code, and
// costs a try on every code standing for the address exactly as a mistyped one
// does. The person is found or minted here and nowhere earlier, which is what
// keeps asking for a code from writing a person for every address anyone types.
let spent = async (env: Env, req: Request, once: Once) =>
  await spend(meta(env), secret(env), once.email, once.code)
    ? await personOf(
      meta(env),
      once.email,
      called(once.email),
      await newcomerAt(env, req),
    )
    : null

// The newcomer this browser is signed in as, if it is one (newcomer.ts): an
// address new here that they prove becomes theirs (signin.ts `addressee`).
let newcomerAt = async (env: Env, req: Request) => {
  let was = await browser(env, req)
  return was && await dirOf(env).newcomer(was) ? was : undefined
}

// A pass followed: it lands where a spent code lands, and one that has been
// spent, revoked or expired is the sign-in card again, still carrying whatever
// the link was going to finish.
let followed = async (req: Request, env: Env, pass: Pass | null) => {
  let once = pass?.once
  let person = once
    ? await spent(env, req, once)
    : pass?.standing
    ? await whose(pass.standing, links(env.OAUTH_KV))
    : null
  if (!person) {
    return signCard(env, {
      q: once?.q,
      back: once?.back,
      why: 'That link has expired or was already used. Ask for a fresh one?',
      status: 400,
    })
  }
  return quiet(
    await landed(req, env, person, once?.q ?? '', once?.back ?? '', 'link'),
  )
}

// The same answer, saying nothing about where it came from: the address
// carried the pass, and a redirect off this page — to an app, or to an OAuth
// client's own redirect_uri — would otherwise hand the link on in a Referer.
let quiet = (r: Response) => {
  let headers = new Headers(r.headers)
  headers.set('referrer-policy', 'no-referrer')
  return new Response(r.body, { status: r.status, headers })
}

// The authorize request as the provider reads it, re-parsed from the query
// the browser carried back: `q` is untrusted, and parsing is what validates
// it against the client — registered, or fetched from the metadata document
// its id points at — its redirect URI, and PKCE. A client we cannot even
// name is refused here; one we can is told in its own language. A metadata
// document we cannot fetch is the client's own outage, not ours, so it is
// said plainly rather than thrown into the exception page.
let asked = async (req: Request, env: Env, q: string) => {
  let url = new URL(`/oauth/authorize?${q}`, req.url)
  try {
    return await api(env).parseAuthRequest(new Request(url.href))
  } catch (e) {
    if (e instanceof CimdFetchError) {
      return new Response(
        `Could not read the client metadata document at ${e.metadataUrl}`,
        { status: 400 },
      )
    }
    if (!(e instanceof AuthorizationError)) throw e
    if (!e.redirectUri) return new Response(e.description, { status: 400 })
    let back = new URL(e.redirectUri)
    back.searchParams.set('error', e.code)
    back.searchParams.set('error_description', e.description)
    if (e.state) back.searchParams.set('state', e.state)
    if (e.issuer) back.searchParams.set('iss', e.issuer)
    return redirect(back.href)
  }
}

/** A person's consent to an authorize request: the grant written, and where
 * the client's code is sent. The grant this replaces stays until the client
 * exchanges the new grant's code (`tokenExchangeCallback` below, connected.ts
 * `replace`), so a sign-in abandoned at the client leaves the old one working
 * (T-121901). */
export let consent = (
  oauth: Pick<OAuthHelpers, 'completeAuthorization'>,
  ask: AuthRequest,
  person: string,
) =>
  oauth.completeAuthorization({
    request: ask,
    userId: person,
    metadata: {},
    scope: ask.scope,
    props: { person } satisfies Props,
    revokeExistingGrants: false,
  })

// Consent granted: the grant is written and the browser is sent home to the
// client with its code.
let allow = async (
  req: Request,
  env: Env,
  q: string,
  person: string,
  set?: string,
) => {
  let ask = await asked(req, env, q)
  if (ask instanceof Response) return ask
  let { redirectTo } = await consent(api(env), ask, person)
  step(env, 'connector_granted', req, {
    who: await dirOf(env).emailAt(person),
  })
  return redirect(redirectTo, set)
}

// The consent form's own token: this person, this authorize request, the next
// hour, sealed for nothing but this (lib/token.ts). The Allow button is the
// one form here that grants a stranger a year of access, so it does not rest
// on the origin check alone: a POST that did not come from the page drawn for
// this person and this request is refused (T-37874).
let CONSENT = 60 * 60

type Consent = { person: string; q: string; exp: number }

let consenting = (secret: string, person: string, q: string) =>
  seal(
    'consent',
    {
      person,
      q,
      exp: Math.floor(Date.now() / 1000) + CONSENT,
    } satisfies Consent,
    secret,
  )

let consented = async (
  secret: string,
  person: string,
  q: string,
  token: string,
) => {
  let c = token ? await opened<Consent>('consent', token, secret) : null
  return !!c && c.person == person && c.q == q &&
    typeof c.exp == 'number' && c.exp * 1000 > Date.now()
}

// The name a person sees on the consent card: what the client called itself
// when it registered, or its bare id, and beside it the host the authorization
// is sent to. The name is the client's own choice, so anybody can register as
// "Claude"; the host of its redirect is the one thing on the card it cannot
// borrow from somebody else (T-37877).
let clientName = async (env: Env, ask: AuthRequest) =>
  `${
    (await api(env).lookupClient(ask.clientId))?.clientName ?? ask.clientId
  } (${new URL(ask.redirectUri).host})`

// Everything the provider does not own: the sign-in cards and the consent
// page. It is the provider's `defaultHandler`, so it sees a request only
// after /oauth/token, /oauth/register, /oauth/me and the well-known
// documents have had their say.
let ours = async (req: Request, env: Env): Promise<Response> => {
  let url = new URL(req.url)
  let path = url.pathname
  // A POST that carries no form at all is a form with nothing in it: the
  // page below simply asks again, rather than throwing at a stray body.
  let form = req.method == 'POST'
    ? await req.formData().catch(() => new FormData())
    : new FormData()
  let field = (name: string) => String(form.get(name) ?? '')

  if (path == '/oauth/agents' && req.method == 'GET') {
    let person = await browser(env, req)
    return Response.json(
      person
        ? { agents: await agents(env, person) }
        : { error: 'not_signed_in' },
      {
        status: person ? 200 : 401,
        headers: { 'cache-control': 'private, no-store' },
      },
    )
  }

  // A row's Disconnect button (connected_ui.ts): the person signed in on this
  // browser revokes the grants of the one agent they chose. Only the session
  // cookie is read, never a bearer, so no agent can be talked into
  // disconnecting anyone; the Origin check every POST passes (route.ts
  // `guarded`) keeps a sibling space's page from posting it.
  if (path == '/oauth/agents/disconnect' && req.method == 'POST') {
    let person = await browser(env, req)
    let back = backTo(field('return'), env)
    if (!person) {
      let login = `/login?return=${encodeURIComponent(back)}`
      return redirect(login, undefined, 303)
    }
    let agent = field('agent')
    await disconnect(grants(env), person, agent)
    let to = new URL(back, req.url)
    to.searchParams.set('disconnected', '1')
    return redirect(to.href, undefined, 303)
  }

  // An invitation's one click (invite.ts, T-37880): accepted for the person
  // it names, signed in on this browser, and nobody else.
  if (path == INVITE && req.method == 'GET') {
    return door(req, env, dirOf(env), await browser(env, req), secret(env))
  }

  // The custom-domain end of cross-domain sign-in (`handoff`). index.ts sends
  // it here on a foreign host before `aimed` moves the address, so it is the
  // one door this handler answers for a hostname that is not ours.
  if (path == HANDOFF && req.method == 'GET') return handoff(req, env)

  // The connector page, and the one thing a person may change on it. It is
  // readable signed out — the home page links here, and the instructions are
  // nobody's secret — while the address card belongs to whoever is signed in,
  // so choosing one says nothing to a stranger about any address but their
  // own (T-32967, T-32972).
  if (path == '/connect' && req.method == 'GET') return theirs(env, req)

  if (path == '/connect' && req.method == 'POST') {
    let who = await withAuth(env, req)
    if (!who) return redirect('/login?return=%2Fconnect')
    let out = await choose(
      env,
      who.person,
      field('space').trim().toLowerCase(),
    )
    // A fetch gets the answer to put in the page; a plain form post — no
    // script, or one that did not load — gets the page back around it.
    return (req.headers.get('accept') ?? '').includes('application/json')
      ? Response.json(out, { status: out.error ? 400 : 200 })
      : theirs(env, req, out.slug ?? field('space'), out.error)
  }

  // Closing a space: a page and a form like the rest of this file, and the
  // only door that destroys anything (index.ts routes `/space/` here).
  let close = /^\/space\/([a-z0-9-]+)\/delete$/.exec(path)
  if (close && (req.method == 'GET' || req.method == 'POST')) {
    return closing(req, env, close[1], {
      confirm: field('confirm'),
      token: field('t'),
    })
  }

  // Signing out (T-136122): this browser forgets the person and stays itself.
  // Only a POST, so a link a mail client fetches signs nobody out.
  if (path == LOGOUT && req.method == 'POST' && env.SESSION_SECRET) {
    return redirect(
      hostUrl(env, '/'),
      await signedOut(req, env, env.SESSION_SECRET),
      303,
    )
  }

  // The home page's box (newcomer.ts): the words go to the Operator of the
  // space they build in, and the browser follows them into its chat.
  if (path == START && req.method == 'POST' && env.SESSION_SECRET) {
    return await begun(req, env, field('say'))
  }

  // Whether this browser is signed in, for the site's island (signed.ts), and
  // which deploy answers, for a page drawn by an older one (public/deploy.js).
  if (path == WHO && req.method == 'GET') {
    return Response.json({
      signedIn: !!await browser(env, req),
      deploy: versionOf(env.CF_VERSION_METADATA),
    }, {
      headers: { 'cache-control': 'private, no-store' },
    })
  }

  if (path == '/login' && req.method == 'GET') {
    let back = url.searchParams.get('return')
    // Signed in already: skip the email box. `landed` asks for consent on
    // a customer's own hostname, follows our zone and refuses a stranger's
    // return, just as it does after a fresh sign-in.
    let who = await withAuth(env, req)
    if (who) return landed(req, env, who.person, '', back ?? '')
    return signCard(env, { back })
  }

  if (path == '/login/handoff' && req.method == 'POST') {
    let person = await browser(env, req)
    let back = field('return')
    let dir = dirOf(env)
    let at = await destination(dir, back, env)
    if (
      !person || !at || !await handoffConsented(
        secret(env),
        person,
        back,
        at.space,
        field('consent'),
      )
    ) {
      return new Response('That sign-in page has expired. Sign in again.', {
        status: 403,
      })
    }
    let to = await handoffTo(
      secret(env),
      dir,
      person,
      back,
      Date.now(),
      env,
      at.space,
    )
    return to ? quiet(redirect(to, undefined, 303)) : lost(env)
  }

  // An address, and a code on its way to it: a letter to an email address,
  // or a text to a US mobile number once the platform texts strangers
  // (`textable`, T-136826). The platform reads nothing about the address
  // here — not whether anyone has named it, not whether it has spaces or apps
  // or an account at all (T-34236 took the last of that away with the card's
  // second question): a stranger learns exactly what a letter to somebody
  // else's address teaches them, which is nothing.
  //
  // An address that has had its codes for the hour mints nothing (signin.ts
  // sends) and this answers the card it always answers: same status, same
  // bytes. A refusal that showed would say that somebody had been asking about
  // this address, which is more than the door was ever willing to tell.
  //
  // The box was `email` before it took a number, and a card a browser still
  // holds from before posts that name.
  if (path == '/login' && req.method == 'POST') {
    let address = canon(field('address') || field('email'))
    let q = field('q') || null
    let back = field('return') || null
    let texts = await textable(env)
    let text = texts && texted(address)
    if (!text && !address.includes('@')) {
      return signCard(env, {
        q,
        back,
        why: texts ? NOT_ADDRESS : NOT_EMAIL,
        status: 400,
      })
    }
    // A deploy that cannot post a letter says so in one sentence, the way
    // sell.ts answers for a missing secret, rather than minting a code nobody
    // can receive and breaking on the send. Asked before `mint`, so the
    // address spends none of its hour's letters (signin.ts sends) on it; and
    // the same card for every address, which is all this door ever tells.
    if (!text && !(await mailable(env))) {
      return signCard(env, { q, back, why: NO_MAIL, status: 503 })
    }
    // Each wait a named stage on the answer's `Server-Timing` (timing.ts),
    // with its store hops and waits, as spending the code has: this is the
    // first thing a new person waits on.
    let c = clock()
    return c.counting(async () => {
      // Per source, before `mint`, so a loop spends none of any address's
      // letters: the address cap above protects an inbox, this one the
      // platform's mail from somebody asking for a code at every address. A
      // text is counted per visitor by the hour as well (signin.ts VISITS),
      // since this one is by the minute and a text costs.
      let from = text ? await visitor(secret(env), source(req)) : ''
      if (
        !await c.time(
          'rate',
          async () =>
            (await Promise.all([
              within(env.SIGNIN_RATE, source(req)),
              mayText(meta(env), from),
            ])).every(Boolean),
        )
      ) {
        return signCard(env, { q, back, why: TOO_MANY, status: 429 })
      }
      let code = await c.time(
        'mint',
        () => mint(meta(env), secret(env), address, from),
      )
      if (code && text) {
        // The text goes after the answer, as the letter does, from the
        // platform's number (operator-texts.ts `tell`).
        step(env, 'code_sent', req, { who: address })
        let { tell } = await import('./operator-texts.ts')
        background(
          tell(
            env,
            { to: address, text: codeText(code) },
            'POST /login',
          ),
        )
      } else if (code) {
        // The letter carries the code and the one click that spends it
        // (link.ts): the same code said as a link, so it lasts the same ten
        // minutes and dies the moment either one is used. Somebody reading this
        // on a phone should not have to retype anything. It is the Operator's,
        // wherever it was asked for, greeting someone who has a space as met, and a reply to it signs them up as following the link does
        // (signin.ts `codeLetter`).
        let link = await onceLink(secret(env), {
          email: address,
          code,
          q: q || undefined,
          back: back || undefined,
        }, apex(env))
        // The letter goes after the answer (T-124082): posting it was a second
        // of the wait, the longest in signing up, and the card says nothing
        // that depends on it. One that will not leave is a break for us to
        // read, and the card's "Send a new code" is the person's way to ask
        // again.
        step(env, 'code_sent', req, { who: address })
        background(
          met(env, address)
            .then((met) =>
              mail(env)(
                codeLetter(address, code, link, met ? 'back' : 'new', env),
              )
            )
            .catch((e) => fault(env, 'POST /login', e)),
        )
      }
      return timed(askCode({ address, q, back }, env), c)
    })
  }

  if (path == '/login/code' && req.method == 'POST') {
    let address = canon(field('address') || field('email'))
    let q = field('q')
    let back = field('return')
    // Each wait a named stage on the answer's `Server-Timing`, as asking
    // for the code has: this is the second thing a new person waits on.
    let c = clock()
    return c.counting(async () => {
      let refused = await c.time('check', async () =>
        codeCheck(
          meta(env),
          address,
          await mac(address, field('code'), secret(env)),
          q,
          back,
          env,
        ))
      if (refused) return timed(refused, c)
      // Nothing here asks what to call them (T-34236), so the front of their
      // address does — written, not merely derived, because a member row
      // names a person by their title and a titleless one reads back as a
      // bare eid (T-32733). It is theirs to change on their own space page. A
      // number is no name, and a person found by one is the one wearing it.
      let person = await c.time('person', async () =>
        personOf(
          meta(env),
          address,
          called(address),
          await newcomerAt(env, req),
        ))
      return timed(await landed(req, env, person, q, back, 'code', c), c)
    })
  }

  // One click instead of six digits (link.ts): the letter's own link, or a
  // standing one somebody was handed. Opening a letter's link spends nothing —
  // a preview fetch would spend it for nobody — so it answers one button that
  // posts the pass back here, and the press is the spend. A standing link is
  // not spent at all, and lands at once.
  if (path == LINK && req.method == 'GET') {
    let t = url.searchParams.get('t') ?? ''
    let pass = await passOf(t, secret(env))
    return pass?.once ? askLink(t, env) : await followed(req, env, pass)
  }
  if (path == LINK && req.method == 'POST' && field('t')) {
    return await followed(req, env, await passOf(field('t'), secret(env)))
  }

  // A standing link, minted for whoever is signed in and for nobody else — the
  // reviewer credential an app directory asks for, since it needs no mailbox
  // (T-34351). It grants nothing the request's own cookie does not already
  // carry, a session being the longer-lived credential of the two, and unlike
  // that cookie it can be taken back by name.
  //
  // The cookie is the only credential it takes (`browser`): an agent holding a
  // bearer must not be able to turn API access into a browser session it could
  // mail anywhere, which is the line billing.ts takes for a purchase (C-33033).
  if (path == LINK && req.method == 'POST') {
    let person = await browser(env, req)
    if (!person) return unauthorized(req, env)
    let book = links(env.OAUTH_KV)
    if (!book) {
      return Response.json({
        error: {
          code: 'no_ledger',
          message: 'a link nothing could revoke is not minted',
        },
      }, { status: 503 })
    }
    let said = field('revoke')
    if (said) {
      return Response.json({ revoked: await revoke(book, person, said) })
    }
    try {
      let { standing, url: link } = await stand(secret(env), book, {
        person,
        days: field('days') ? Number(field('days')) : undefined,
        host: apex(env),
      })
      return Response.json({
        url: link,
        id: standing.id,
        expires: new Date(standing.exp * 1000).toISOString(),
        // Every standing link this person still has, so whoever mints one can
        // see what else is outstanding and revoke it by name.
        links: await book.ids(person),
      })
    } catch (e) {
      let status = refusing(e, { request: `POST ${LINK}` })
      return Response.json({
        error: { code: 'refused', message: (e as Error).message },
      }, { status })
    }
  }

  // The consent page: the sign-in card wearing the client's name, or one
  // button for a browser that is already signed in.
  if (path == '/oauth/authorize' && req.method == 'GET') {
    let q = url.search.slice(1)
    let ask = await asked(req, env, q)
    if (ask instanceof Response) return ask
    let who = await withAuth(env, req)
    let [row] = who
      ? await meta(env).query(`.entity.eid=${who.person}`) as {
        email?: { address: string }
        phone?: { number: string }
      }[]
      : []
    step(env, 'connector_start', req, { who: addressIn(row) })
    if (!who) {
      return signCard(env, { q, who: await clientName(env, ask) })
    }
    return askAllow(
      row?.email?.address ??
        (row?.phone ? shown(row.phone.number) : 'yourself'),
      q,
      await clientName(env, ask),
      await consenting(secret(env), who.person, q),
      env,
    )
  }

  if (path == '/oauth/allow' && req.method == 'POST') {
    let who = await withAuth(env, req)
    let q = field('q')
    if (!who) return signCard(env, { q })
    if (!await consented(secret(env), who.person, q, field('consent'))) {
      return new Response('That consent page has expired. Connect again.', {
        status: 403,
      })
    }
    return allow(req, env, q, who.person)
  }

  return lost(env)
}

// Do we claim Client ID Metadata Documents? On unless the env says `off`.
// Read here, per request, rather than baked into a module constant, so the
// claim can be dropped and restored with one `wrangler secret put CIMD` —
// the header explains why a working feature has a lever at all.
let cimd = (env: Env) => env.CIMD != 'off'

// A year, in seconds: the access token's life (`opts` below says why).
let YEAR = 365 * 24 * 60 * 60

// The provider's configuration over this env, one value: `withAuth` reads it
// to unwrap a bearer, and `fetch` runs it. `/oauth/me` is the one protected
// resource the identity part serves itself — the door an agent calls to learn
// which person its token stands for, and the proof that `withAuth` and the
// provider agree. The MCP door at /mcp is protected the same way, through
// `withAuth` and `unauthorized`, in its own part.
let opts = (env: Env): OAuthProviderOptions<Env> => ({
  defaultHandler: { fetch: ours },
  apiRoute: '/oauth/me',
  apiHandler: {
    fetch: async (req: Request, env: Env) => {
      let who = await withAuth(env, req)
      return who ? Response.json(who) : unauthorized(req, env)
    },
  },
  authorizeEndpoint: OAUTH.authorize,
  tokenEndpoint: OAUTH.token,
  clientRegistrationEndpoint: OAUTH.register,
  clientIdMetadataDocumentEnabled: cimd(env),
  // The owner, 2026-09-05: "the oauth should never expire". A connector is a
  // door a person opened, and it closes when they close it and not before —
  // so the refresh token has no expiry (the library's own way of saying never
  // is an explicit `undefined`, which leaves the grant's KV row with no
  // expiration at all) and the access token lives a year, which is as near to
  // never as an integer TTL gets: the library will not take a value under a
  // minute and has no word for forever.
  //
  // Neither ceiling weakens revoking, which is what a person actually does:
  // `revokeGrant` deletes every token row along with the grant, so a
  // disconnected connector is refused on its next call whatever its token
  // said. The CLI's grants are the opposite by design and stay hours
  // (grants.ts) — those are pasted into a terminal, not held by a connector.
  accessTokenTTL: YEAR,
  refreshTokenTTL: undefined,
  // A re-authorization replaces the person's older grant for that client only
  // now, when the client holds the new grant (connected.ts `replace`).
  tokenExchangeCallback: async (o) => {
    if (o.grantType == 'authorization_code') {
      await replace(api(env), o.userId, o.grantId)
    }
  },
  scopesSupported: [OAUTH.scope],
  resourceMetadata: {
    scopes_supported: [OAUTH.scope],
    resource_name: 'yaks.app',
  },
})

// The Worker runtime hands a fetch handler an ExecutionContext; a kernel part
// is given only its request and its env (env.ts). The provider wants one to
// pass along and to hang `props` on, so it gets a plain object — nothing here
// defers work past the response.
let context = () => ({
  props: {},
  waitUntil: () => {},
  passThroughOnException: () => {},
})

// A token request's form, and the client id and secret it presented: in the
// form, or as Basic credentials, which carry the id with them. Null when
// either will not read.
let presented = async (req: Request) => {
  let basic = /^Basic\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  try {
    let form = new URLSearchParams(await req.clone().text())
    let named: [string, string | null] = basic
      ? atob(basic[1]).split(':').map(decodeURIComponent) as [string, string]
      : [form.get('client_id') ?? '', form.get('client_secret')]
    return { form, named }
  } catch {
    return null
  }
}

// A secret a public client was never issued, dropped before the provider sees
// it (T-34416). ChatGPT registers itself `token_endpoint_auth_method: none`
// and then puts a `client_secret` in the token request anyway — an empty one
// counts, the provider only asks whether the field is there — and the mismatch
// is refused `invalid_client`, which the person reads as "your yaks.app
// connection has expired, reconnect it".
//
// Accepting it gives up nothing. A public client has no registered secret to
// check the presented one against; what protects its code is PKCE, which is
// unchanged, and the check that just fired only compares two labels. So the
// field is removed and the request goes on as the `none` it always was — and
// only for a client that registered `none`. A client that registered a secret
// method still has to present the right one, which is the check that matters.
//
// Basic is the same mistake said in a header, and it takes the client_id with
// it, so the id moves into the form where the provider reads it next.
let plain = async (req: Request, env: Env): Promise<Request> => {
  if (req.method != 'POST' || new URL(req.url).pathname != OAUTH.token) {
    return req
  }
  // Anything unreadable here is the provider's to refuse, not ours to guess
  // at: a body that will not parse and Basic credentials that are not base64
  // go on untouched and meet the error they have coming.
  let read = await presented(req)
  if (!read) return req
  let { form, named: [id, secret] } = read
  // Nothing to drop unless a secret was offered at all.
  if (!id || secret == null) return req
  let client = await getOAuthApi<Env>(opts(env), env).lookupClient(id)
    .catch((e) => {
      caught(e, { request: 'POST /oauth/token' })
      return null
    })
  if (client?.tokenEndpointAuthMethod != 'none') return req
  form.delete('client_secret')
  form.set('client_id', id)
  let headers = new Headers(req.headers)
  headers.delete('authorization')
  headers.delete('content-length')
  return new Request(req.url, {
    method: 'POST',
    headers,
    body: form.toString(),
  })
}

// A provider per request, since its configuration is read from the env: the
// library builds its own implementation per call anyway (`getOAuthApi`), so
// this costs an object, not a connection.
export let fetch = async (req: Request, env: Env): Promise<Response> => {
  // An explicit apex also names the OAuth issuer behind a local proxy.
  if (env.APEX && hostOf(req, env) == apex(env)) {
    let at = new URL(req.url)
    req = new Request(hostUrl(env, at.pathname + at.search), req)
  }
  // Registering a client is the one provider door that writes on a stranger's
  // say-so (a KV row per client), so it is the one held to a rate (rate.ts).
  // The refusal is the RFC 6749 error shape a client already parses.
  if (
    req.method == 'POST' && new URL(req.url).pathname == OAUTH.register &&
    !await within(env.REGISTER_RATE, source(req))
  ) {
    return Response.json({
      error: 'too_many_requests',
      error_description: 'Too many registrations from one place. ' +
        'Try again in a minute.',
    }, { status: 429, headers: { 'retry-after': String(RETRY) } })
  }
  let path = new URL(req.url).pathname
  // Account discovery belongs to the same provider that minted the token.
  // Read the address live: tokens keep their existing format and held grants
  // are neither reissued nor changed. A cookie alone is not a userinfo token.
  if (path == '/oauth/userinfo') {
    let headers = {
      'cache-control': 'private, no-store',
      'access-control-allow-origin': '*',
    }
    if (req.method == 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': 'Authorization',
        },
      })
    }
    if (req.method != 'GET') {
      return new Response(null, {
        status: 405,
        headers: { ...headers, allow: 'GET, OPTIONS' },
      })
    }
    let who = await withAuth(env, req)
    if (who?.via != 'oauth') {
      let res = unauthorized(req, env)
      return new Response(res.body, {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), ...headers },
      })
    }
    // A person who signed up with a number has no address: their number is
    // OpenID's `phone_number` claim instead.
    let email = await directory(bound(env.DIRECTORY, dirPart.fetch, env))
      .emailAt(who.person)
    let number = email ? null : await phoneAt(env, who.person)
    if (!email && !number) {
      return Response.json({ error: 'no_account' }, { status: 404, headers })
    }
    return Response.json(
      email
        ? { sub: who.person, email }
        : { sub: who.person, phone_number: number },
      { headers },
    )
  }
  let sent = await plain(req, env)
  let res = await new OAuthProvider<Env>(opts(env))
    .fetch(sent, env, context() as never)
  // The provider owns all its metadata; add only the account-discovery door
  // it does not offer a configuration field for.
  if (
    path == '/.well-known/oauth-authorization-server' && res.ok &&
    req.method == 'GET'
  ) {
    let metadata = await res.json() as Record<string, unknown>
    let headers = new Headers(res.headers)
    headers.delete('content-length')
    return Response.json({
      ...metadata,
      userinfo_endpoint: hostUrl(env, '/oauth/userinfo'),
    }, { headers })
  }
  return res
}
