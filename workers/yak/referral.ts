// A person's own invite (D-136811 'Invites', T-138777): a QR code a friend
// scans to open a text to yaks.app's number, or a letter to its sign-up
// address, with the words already written. The words carry the person's code
// (`referral_code{code}` on their row in the directory), and that code in a
// first message is how a sign-up is traced back to whoever invited them.
//
// Not a seat: invite.ts offers a seat in a space to an address, and this
// offers yaks.app itself to whoever is standing in front of you.
import { identityEid } from '@yaks/graph/identity'
import { encode } from 'uqr'
import { caught } from './defects.ts'
import type { Directory } from './directory.ts'
import type { Env } from './env.ts'
import { esc } from './html.ts'
import { signupAddress } from './host.ts'
import { settings, texter } from './phone-providers.ts'

// Letters and digits a person can read off a screen without mistaking one
// for another: no 0 or o, no 1, i or l.
let ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** How long a code is: 31⁵, some 28 million, so a fresh one is free almost
 * every time. */
export let LENGTH = 5

/// minted(new Uint8Array([0, 1, 2, 3, 30])) -> 'abcd9'
/** A fresh code, from `random` bytes. */
export let minted = (
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(LENGTH)),
) => [...random].map((b) => ALPHABET[b % ALPHABET.length]).join('')

// A name as the words carry it: one line, nothing the code's brackets could
// be mistaken for.
let plain = (name: string) =>
  name.replace(/[(),\s]+/g, ' ').trim().slice(0, 40) || 'a friend'

/// words('Jeff', 'k7q2m') -> 'Hi yaks.app, sign me up! (invite from Jeff, k7q2m)'
/// words('Ana (Books), Ltd', 'k7q2m') -> 'Hi yaks.app, sign me up! (invite from Ana Books Ltd, k7q2m)'
/** What the text or the letter says: the person who invited them by name,
 * and their code. */
export let words = (name: string, code: string) =>
  `Hi yaks.app, sign me up! (invite from ${plain(name)}, ${code})`

/// codeIn('Hi yaks.app, sign me up! (invite from Jeff, k7q2m)') -> 'k7q2m'
/// codeIn('hi yaks.app sign me up (Invite from Jeff,K7Q2M)') -> 'k7q2m'
/// codeIn('Hi yaks.app, sign me up!') -> null
/** The code in the words someone sent, wherever they put it, or null. */
export let codeIn = (said: string) =>
  /\(\s*invite from [^()]*,\s*([a-z0-9]{4,12})\s*\)/i.exec(said)?.[1]
    .toLowerCase() ?? null

/// texted('+18885550100', 'Hi') -> 'sms:+18885550100?&body=Hi'
/** The `sms:` link that opens a text to `number` holding `said`. `?&body=`
 * is the spelling both iOS and Android read. */
export let texted = (number: string, said: string) =>
  `sms:${number}?&body=${encodeURIComponent(said)}`

/// mailed('signup@yaks.app', 'Hi') -> 'mailto:signup@yaks.app?subject=Sign%20me%20up&body=Hi'
/** The `mailto:` link that opens a letter to `address` holding `said`. */
export let mailed = (address: string, said: string) =>
  `mailto:${address}?subject=${encodeURIComponent('Sign me up')}&body=${
    encodeURIComponent(said)
  }`

/**
 * `text` as a QR code, an inline SVG a module to a unit: each row's runs of
 * dark modules are one path, a few kilobytes where a square a module is
 * fifteen. The quiet zone is drawn white, so the code reads on a dark page.
 *
 * ```ts
 * import { ok } from '@yaks/testing'
 * import { qr } from './referral.ts'
 * let svg = qr('sms:+18885550100?&body=Hi', 'Scan to text yaks.app')
 * ok(svg.startsWith('<svg') && svg.includes('aria-label="Scan to text yaks.app"'))
 * ```
 */
export let qr = (text: string, label: string) => {
  let { data, size } = encode(text, { ecc: 'M', border: 3 })
  let d = data.flatMap((row, y) => {
    let runs: string[] = []
    for (let x = 0; x < size; x++) {
      if (!row[x]) continue
      let n = 1
      while (row[x + n]) n++
      runs.push(`M${x} ${y}h${n}v1h-${n}z`)
      x += n
    }
    return runs
  }).join('')
  return `<svg class="Qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${
    esc(label)
  }" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`
}

/** How many times a fresh code is tried before minting gives up: two
 * collisions in a row among 28 million codes is already a bug. */
let TRIES = 3

/**
 * The person's code, minted the first time they ask for it and theirs after
 * that. Two codes are never one: the directory holds `referral_code.code`
 * unique, so a code somebody already holds is refused and another is tried.
 */
export let codeOf = async (
  dir: Pick<Directory, 'referralCode' | 'stamp'>,
  person: string,
  mint = minted,
): Promise<string> => {
  let held = await dir.referralCode(person)
  if (held) return held
  for (let n = 1;; n++) {
    let code = mint()
    try {
      await dir.stamp({
        entities: [{ entity: { eid: person }, referral_code: { code } }],
      })
      return code
    } catch (e) {
      if (n == TRIES) throw e
    }
  }
}

/**
 * The number a friend texts to sign up: the platform sender's own
 * (`PHONE_SENDER`'s `number`, else the one its provider picks). Null until
 * signing up by text is on (`TEXT_SIGNUP`) and where no provider holds a key
 * here, so the invite offers no text nobody would read; a provider that can't
 * say just now is reported, and the invite offers the letter alone.
 */
export let numberOf = async (env: Env): Promise<string | null> => {
  if (env.TEXT_SIGNUP != 'on' || !settings(env).key) return null
  try {
    return await texter(env).from?.() ?? null
  } catch (e) {
    caught(e, { request: 'invite number' })
    return null
  }
}

/** What a person's invite page draws: the words, the links that open them
 * as a text (where there is a number to text) and as a letter, and how many
 * people signed up through it and how many of them built an app. */
export type Invitation = {
  said: string
  text: string | null
  mail: string
  address: string
  joined: number
  built: number
}

/** The person's invite, their code minted if they had none. */
export let invitation = async (
  env: Env,
  dir: Pick<Directory, 'referralCode' | 'stamp' | 'nameAt' | 'referrals'>,
  person: string,
): Promise<Invitation> => {
  let [code, number, name, referrals] = await Promise.all([
    codeOf(dir, person),
    numberOf(env),
    dir.nameAt(person),
    dir.referrals(person),
  ])
  let said = words(name ?? '', code)
  let address = signupAddress(env)
  return {
    said,
    text: number ? texted(number, said) : null,
    mail: mailed(address, said),
    address,
    joined: referrals.length,
    built: referrals.filter((r) => r.rewarded).length,
  }
}

/** The eid of the referral that brought `invitee` in, derived from them, so
 * a person is invited once. */
export let referralEid = (invitee: string) => identityEid('referral', [invitee])

/**
 * Who invited `invitee`, read from the code in what their first message said:
 * their referral, written for the month it gives once they build an app.
 * Nothing is refused, and nothing is written where the words carry no code
 * anybody holds, the code is their own, an invite already brought them in, or
 * they had built an app before, which makes this no sign-up of theirs.
 * Answers the inviter, or null.
 */
export let credit = async (
  dir: Pick<Directory, 'referrer' | 'referral' | 'built' | 'stamp'>,
  invitee: string,
  said: string,
): Promise<string | null> => {
  let code = codeIn(said)
  if (!code) return null
  let [inviter, had, built] = await Promise.all([
    dir.referrer(code),
    dir.referral(invitee),
    dir.built(invitee),
  ])
  if (!inviter || inviter == invitee || had || built) return null
  await dir.stamp({
    entities: [{
      entity: { eid: referralEid(invitee) },
      referral: { inviter, invitee },
    }],
  })
  return inviter
}
