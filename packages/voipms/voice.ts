// The carrier's SIP accounts for one DID. Account names identify the line
// even after deletion, so its outstanding call records can still be billed.
import type { Login, Voice } from '@yaks/phone'
import { Unsent } from '@yaks/host/senders'
import { type Call, type Params, TimedOut, VOIPMS } from './request.ts'

type Fields = Record<string, string | number | undefined>

export let accountFor = (digits: string) => `y${digits}`

// voip.ms silently truncates the username suffix to twelve characters.
let seatPrefix = (digits: string) =>
  `y${Number(digits).toString(36).padStart(7, '0')}`

let seatAccount = (digits: string, seat: string, legacy: string | null) =>
  seat == legacy ? accountFor(digits) : seatPrefix(digits) +
    (parseInt(seat.slice(0, 8), 16) % (36 ** 4)).toString(36).padStart(4, '0')

export let callsAs = (digits: string, account: string) =>
  account.endsWith(`_${accountFor(digits)}`) ||
  new RegExp(`_${seatPrefix(digits)}[0-9a-z]{4}$`).test(account)

let accountsOf = async (call: Call, digits: string) =>
  (((await call('getSubAccounts')).accounts ?? []) as Fields[])
    .filter((a) => callsAs(digits, String(a.account)))

let drop = (call: Call, account: Fields) =>
  call('delSubAccount', { id: String(account.id) })

/** A purchase failed before the DID could be put to use. */
export let abandon = async (call: Call, digits: string) => {
  await call('cancelDID', { did: digits })
  for (let account of await accountsOf(call, digits)) await drop(call, account)
}

export let heldDid = async (call: Call, digits: string) => {
  let held = await call('getDIDsInfo', { did: digits }).then(
    (said) => (said.dids ?? []) as Fields[],
    (error) => {
      if (/invalid_did|no_did/.test(String(error))) return []
      throw error
    },
  )
  return held.find((d) => String(d.did) == digits)
}

let NOWHERE = '192.0.2.1'

let restriction = (out: boolean): Params => ({
  enable_ip_restriction: out ? '0' : '1',
  ip_restriction: out ? '' : NOWHERE,
})

let described = (digits: string, seat?: string) =>
  seat ? `+1${digits} ${seat}` : `+1${digits}`

export let made = (
  call: Call,
  digits: string,
  username: string,
  out: boolean,
  seat?: string,
) =>
  call('createSubAccount', {
    username,
    protocol: '1',
    description: described(digits, seat),
    auth_type: '1',
    password: `Y${crypto.randomUUID().replaceAll('-', '')}`,
    device_type: '2',
    callerid_number: digits,
    lock_international: '1',
    international_route: '1',
    music_on_hold: 'default',
    allowed_codecs: 'ulaw;g729;gsm',
    dtmf_mode: 'AUTO',
    nat: 'yes',
    ...restriction(out),
  })

let blocking = async (call: Call, account: Fields, out: boolean) => {
  let shut = String(account.enable_ip_restriction) == '1' &&
    account.ip_restriction == NOWHERE
  if (shut != out) return
  let { account: _, ...said } = account
  await call('setSubAccount', {
    ...Object.fromEntries(
      Object.entries(said).map(([k, v]) => [k, String(v ?? '')]),
    ),
    ...restriction(out),
  })
}

let groupOf = async (call: Call, digits: string) => {
  let groups = await call('getRingGroups').catch((error) => {
    if (/no_ringgroup/.test(String(error))) return { ring_groups: [] }
    throw error
  })
  return ((groups.ring_groups ?? []) as Fields[])
    .find((g) => g.name == accountFor(digits))
}

let route = async (call: Call, digits: string, accounts: Fields[]) => {
  let did = await heldDid(call, digits)
  let group = await groupOf(call, digits)
  let members = accounts.map((a) => `account:${a.account},25,0`).sort().join(
    ';',
  )
  let routing = accounts.length
    ? `account:${accounts[0].account}`
    : 'sys:hangup'
  if (accounts.length > 1) {
    let id = group?.ring_group
    if (!group || group.members != members) {
      let set = await call('setRingGroup', {
        name: accountFor(digits),
        members,
        ...(id ? { ring_group: String(id) } : {}),
      })
      id = (set.ring_group ?? id) as string | undefined
    }
    if (!id) throw new Error('voip.ms did not return the ring group ID')
    routing = `grp:${id}`
  }
  if (did && did.routing != routing) {
    await call('setDIDRouting', { did: digits, routing })
  }
  if (group && accounts.length < 2) {
    await call('delRingGroup', { ringgroup: String(group.ring_group) })
  }
}

let belongs = (
  account: Fields,
  digits: string,
  seat: string,
  legacy: string | null,
) =>
  account.username == seatAccount(digits, seat, legacy) &&
  (seat == legacy || account.description == described(digits, seat))

let taken = async (call: Call, digits: string, seat: string, voice: Voice) => {
  let username = seatAccount(digits, seat, voice.legacy)
  let find = async () =>
    (await accountsOf(call, digits))
      .find((a) => belongs(a, digits, seat, voice.legacy))
  let account = await find()
  if (account) return account
  await made(
    call,
    digits,
    username,
    voice.out,
    seat == voice.legacy ? undefined : seat,
  )
    .catch(async (error) => {
      if (await find()) return
      if (error instanceof TimedOut) {
        throw new Unsent('voip.ms has yet to confirm the SIP account')
      }
      throw error
    })
  account = await find()
  if (!account) throw new Error('voip.ms did not return the new SIP account')
  return account
}

export let allow = async (call: Call, digits: string, voice: Voice) => {
  let requested = new Set([voice.legacy, ...voice.requested ?? []])
  let seats = voice.seats.filter((seat) =>
    requested.has(seat) && !voice.revoked?.includes(seat)
  )
  let accounts = await accountsOf(call, digits)
  if (!voice.in) {
    // Try both stops even if the carrier fails to apply one of them.
    let ends = await Promise.allSettled([
      route(call, digits, []),
      ...accounts.map((account) => drop(call, account)),
    ])
    let errors = ends.flatMap((r) => r.status == 'rejected' ? [r.reason] : [])
    if (errors.length) {
      throw new AggregateError(errors, 'voip.ms could not shut all calls')
    }
    return
  }
  let kept: Fields[] = []
  for (let account of accounts) {
    if (
      seats.some((seat) => belongs(account, digits, seat, voice.legacy))
    ) {
      await blocking(call, account, voice.out)
      kept.push(account)
    } else {
      await drop(call, account)
    }
  }
  for (let seat of seats) {
    if (!kept.some((a) => belongs(a, digits, seat, voice.legacy))) {
      kept.push(await taken(call, digits, seat, voice))
    }
  }
  await route(call, digits, kept)
}

export let release = async (call: Call, digits: string) => {
  await allow(call, digits, { in: false, out: false, seats: [], legacy: null })
  if (await heldDid(call, digits)) await call('cancelDID', { did: digits })
}

export let login = async (
  call: Call,
  digits: string,
  seat: string,
  voice: Voice,
): Promise<Login> => {
  if (!voice.in || !voice.seats.includes(seat)) {
    throw new Error('This seat cannot sign a softphone in')
  }
  let account = await taken(call, digits, seat, voice)
  if (!account.password) {
    throw new Error('voip.ms did not return the softphone sign-in')
  }
  await allow(call, digits, voice)
  let [server] = ((await call('getServersInfo', { server_pop: VOIPMS.pop }))
    .servers ?? []) as Fields[]
  if (!server?.server_hostname) {
    throw new Error('voip.ms did not return the SIP server')
  }
  return {
    server: String(server.server_hostname),
    user: String(account.account),
    password: String(account.password),
  }
}
