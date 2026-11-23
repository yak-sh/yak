// The carrier's SIP accounts for one DID. Account names identify the line
// even after deletion, so its outstanding call records can still be billed.
import type { Login, SubmitLogin, Voice } from '@yaks/phone'
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
    .sort((a, b) => Number(a.id) - Number(b.id))

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

// Every step runs, and any failure fails the whole once all have ended.
let settled = async (steps: Promise<unknown>[]) => {
  let ends = await Promise.allSettled(steps)
  let errors = ends.flatMap((r) => r.status == 'rejected' ? [r.reason] : [])
  if (errors.length == 1) throw errors[0]
  if (errors.length) throw new AggregateError(errors, 'voip.ms refused a step')
}

let twice = <T>(step: () => Promise<T>) => step().catch(() => step())

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
  let routedToGroup = String(did?.routing ?? '').startsWith('grp:')
  let group = accounts.length > 1 ? await groupOf(call, digits) : undefined
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
  if (routedToGroup && accounts.length < 2) {
    let old = await groupOf(call, digits)
    if (old) await call('delRingGroup', { ringgroup: String(old.ring_group) })
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

let taken = async (
  call: Call,
  digits: string,
  seat: string,
  voice: Voice,
  submit?: SubmitLogin,
) => {
  let username = seatAccount(digits, seat, voice.legacy)
  let find = async () =>
    (await accountsOf(call, digits))
      .find((a) => belongs(a, digits, seat, voice.legacy))
  let account = await find()
  if (account) return account
  if (submit && !await submit(seat)) return undefined
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

export let allow = async (
  call: Call,
  digits: string,
  voice: Voice,
  submit?: SubmitLogin,
) => {
  let requested = new Set([voice.legacy, ...voice.requested ?? []])
  let seats = voice.seats.filter((seat) =>
    requested.has(seat) && !voice.revoked?.includes(seat)
  )
  // A shut line keeps its sign-ins, restricted, so a restore brings back
  // the passwords people's softphones hold. Restricting comes before
  // dropping departed owners' accounts, so calls out stop first.
  let keep = async () => {
    let kept = new Map<string, Fields>()
    let gone: Fields[] = []
    for (let account of await accountsOf(call, digits)) {
      let username = String(account.account)
      let mine = seats.some((seat) =>
        belongs(account, digits, seat, voice.legacy)
      )
      if (mine && !kept.has(username)) kept.set(username, account)
      else gone.push(account)
    }
    let out = voice.in && voice.out
    await settled([...kept.values()].map((a) => blocking(call, a, out)))
    await settled(gone.map((account) => drop(call, account)))
    return kept
  }
  if (!voice.in) {
    // Calls out stop first, asked again on their own before the DID is
    // routed to a hang-up; the hang-up is tried whatever that answered.
    let shut = await twice(keep).then(() => [], (e) => [e])
    let routed = await route(call, digits, []).then(() => [], (e) => [e])
    let errors = [...shut, ...routed]
    if (errors.length) {
      throw new AggregateError(errors, 'voip.ms could not shut all calls')
    }
    return
  }
  let kept = await keep()
  for (let seat of seats) {
    if (
      ![...kept.values()].some((a) => belongs(a, digits, seat, voice.legacy))
    ) {
      let account = await taken(call, digits, seat, voice, submit)
      if (account) kept.set(String(account.account), account)
    }
  }
  await route(call, digits, [...kept.values()])
}

export let release = async (call: Call, digits: string) => {
  // Cancel the DID itself before catalog cleanup. A slow list of SIP
  // accounts or groups must not hold up returning a number to the carrier.
  await call('cancelDID', { did: digits }).catch(async (error) => {
    if (await heldDid(call, digits)) throw error
  })
  await Promise.all([
    accountsOf(call, digits).then((accounts) =>
      Promise.all(accounts.map((account) => drop(call, account)))
    ),
    groupOf(call, digits).then(async (group) => {
      if (group) {
        await call('delRingGroup', { ringgroup: String(group.ring_group) })
      }
    }),
  ])
}

export let login = async (
  call: Call,
  digits: string,
  seat: string,
  voice: Voice,
  submit?: SubmitLogin,
): Promise<Login> => {
  if (!voice.in || !voice.seats.includes(seat)) {
    throw new Error('This seat cannot sign a softphone in')
  }
  let account = await taken(call, digits, seat, voice, submit)
  if (!account) throw new Unsent('voip.ms has yet to confirm the SIP account')
  if (!account.password) {
    throw new Error('voip.ms did not return the softphone sign-in')
  }
  await allow(call, digits, voice, submit)
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
