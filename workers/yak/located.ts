// Where each person is, roughly (@yaks/platform/located), kept in the
// directory as `located` rows: what each source last said of one of their
// places. The inputs say it here as they arrive: their own words through
// their Operator's place_set (operator.ts), the billing address of a
// checkout they paid (billing.ts), and their connection when they sign in
// (browser-sessions.ts) and each time they write to their Operator from its
// page (operator-page.ts). Their phone's area code is read off their
// `phone{number}` as it stands. Only the person and their own Operator read
// any of it.
import {
  type Address,
  billed,
  type Cf,
  heard,
  note,
} from '@yaks/platform/located'
import type { Env } from './env.ts'
import { kept } from './whereabouts.ts'

/** Note where a request's connection places its sender now. */
export let connected = async (
  env: Pick<Env, 'STORE'>,
  person: string,
  req: Request & { cf?: Cf },
) => {
  let area = heard(req.cf ?? {})
  if (!Object.keys(area).length) return
  await note(kept(env), person, {
    kind: 'current',
    source: 'network',
    ...area,
  })
}

/** Note the home a person's billing address names. */
export let billedTo = async (
  env: Pick<Env, 'STORE'>,
  person: string,
  address: Address,
) => {
  let area = billed(address)
  if (!Object.keys(area).length) return
  await note(kept(env), person, {
    kind: 'home',
    source: 'billing',
    ...area,
  })
}
