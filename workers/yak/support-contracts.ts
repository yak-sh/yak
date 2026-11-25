import { mint } from '@yaks/graph'
import {
  type Contract,
  CONTRACT_REQUEST,
  contractEid,
  dayOf,
  entryOf,
  termsOf,
} from '@yaks/platform/support-contract'
import {
  allContracts,
  billingOf,
  contractOf,
  current,
  oneContract,
  pendingSetup,
  saveContract,
} from '@yaks/platform/support-contract-service'
import { apex } from '@yaks/platform/host'
import { managePath } from '@yaks/platform/routes'
import { CallError } from '@yaks/tools/errors'
import { admin } from './tool.ts'
import { ADMIN } from '@yaks/platform/bots'
import { adminWho } from './asking.ts'
import { badTo, DUE, invoicePlan } from './billing.ts'
import { operatorDoor } from './build-door.ts'
import {
  type Directory,
  directoryOf,
  META,
  type Space,
  stamp,
  type Walk,
} from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { nothingHere, page } from './pages.ts'
import { plans } from './payments.ts'
import { sessionAt } from './session.ts'

export let todayOf = (env: Env) => dayOf(env.CLOCK?.now() ?? Date.now())

export let supportFor = async (
  env: Env,
  space: Space | Walk,
  dir = directoryOf(env.STORE),
) => {
  let support = await oneContract(
    dir.read,
    'path' in space ? space : space.eid,
    todayOf(env),
  )
  if (!support) return null
  let name = await dir.nameAt(support.contract.provider)
  return { ...support, providerName: name || 'your support provider' }
}

export let allSupport = (env: Env) =>
  allContracts(meta(env).query, todayOf(env))

export let setupWaiting = async (env: Env, space: Space) =>
  pendingSetup((await meta(env).query(current(space.eid)))[0])

let getForm = (form: FormData) => (key: string) => String(form.get(key) ?? '')

let set = async (
  env: Env,
  dir: Directory,
  space: Space,
  person: string,
  get: (key: string) => string,
) => {
  let [row] = await meta(env).query(current(space.eid), { live: true })
  let pending = pendingSetup(row)
  let address = get('provider').trim()
  let providerId = address
    ? await dir.personAt(address)
    : pending?.terms.provider ?? contractOf(row)?.provider ?? person
  if (
    !providerId ||
    await dir.emailAt(providerId) == ADMIN ||
    (providerId != person && !await dir.role(space, providerId) &&
      !await admin({ dir, person: providerId }))
  ) {
    throw new CallError(
      'provider',
      'Choose the yaks.app account of the person providing support.',
    )
  }
  let terms: Contract = {
    ...termsOf(get),
    space: space.eid,
    provider: providerId,
  }
  let email = get('billing_email').trim()
  let to = email
    ? { email, name: get('billing_name').trim() || space.title }
    : pending?.to
  if (to) {
    let no = badTo(to)
    if (no) throw new CallError('billing_email', no)
  }
  let bill = billingOf(row)
  let method = get('billing')
  if (method && method != 'platform' && method != 'terms') {
    throw new CallError(
      'billing',
      'Choose platform billing or save the terms only.',
    )
  }
  let platform = bill
    ? !bill.account
    : pending?.bill ?? (method == 'platform' || (!method && !!to))
  let provider = await plans(env)
  let plan = space.plan
  let standing = plan?.subscription && provider.standing(plan.status)
  let sub = standing && standing != 'ended' ? plan?.subscription ?? '' : ''
  await saveContract(
    (row) => stamp(env, { entities: [row] }, { actor: { by: person } }),
    provider,
    space.eid,
    row,
    { terms, bill: platform, to },
    sub,
    plan?.customer ?? '',
    (item, to) => invoicePlan(env, dir, space, provider, to, to.email, item),
    { apex: apex(env), due: DUE },
    todayOf(env),
  )
}

let request = async (
  env: Env,
  req: Request,
  dir: Directory,
  space: Space,
  get: (name: string) => string,
) => {
  let who = await sessionAt(req, env)
  if (
    !who?.person || who.space && who.space != space.eid ||
    !await dir.role(space, who.person)
  ) {
    return nothingHere(env)
  }
  let [row] = await meta(env).query(current(space.eid))
  let contract = contractOf(row)
  if (!contract) return nothingHere(env)
  let words = get('message').trim()
  let id = get('id')
  if (!words) throw new CallError('message', 'Enter a request.')
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new CallError('id', 'Reload Billing and try again.')
  }
  let [recipientSpace, name, replyTo] = await Promise.all([
    dir.own(contract.provider),
    dir.nameAt(who.person),
    dir.emailAt(who.person),
  ])
  await operatorDoor(
    env,
    recipientSpace,
    {
      person: contract.provider,
      role: 'owner',
      administrative: true,
    },
    CONTRACT_REQUEST.slice('/operator/'.length),
    {
      id: `${space.eid}|${who.person}|${id}`,
      space: space.title,
      name: name || replyTo || 'Space member',
      replyTo: replyTo ?? '',
      words,
    },
  )
  return new Response(null, {
    status: 303,
    headers: {
      location: `${
        managePath('billing', space.slug)
      }?support=sent#contact-support`,
    },
  })
}

let logTime = (
  env: Env,
  space: Space,
  contract: Contract,
  person: string,
  get: (name: string) => string,
  via?: string,
) =>
  stamp(env, {
    entities: [{
      entity: { eid: mint() },
      support_contract_time: entryOf(
        get,
        contractEid(space.eid),
        contract,
        todayOf(env),
      ),
    }],
  }, { actor: { by: person, via } })

export let supportDoor = async (req: Request, env: Env) => {
  let url = new URL(req.url)
  if (req.method != 'GET' && req.method != 'POST') return nothingHere(env)
  if (req.headers.get('origin') && req.headers.get('origin') != url.origin) {
    return nothingHere(env)
  }
  let form = req.method == 'POST'
    ? await req.formData().catch(() => null)
    : null
  if (req.method == 'POST' && !form) {
    return Response.json({
      error: { code: 'arguments', message: 'Send the form fields.' },
    }, { status: 400 })
  }
  let get = form
    ? getForm(form)
    : (key: string) => url.searchParams.get(key) ?? ''
  let op = get('op')
  let dir = directoryOf(env.STORE)
  try {
    if (req.method == 'POST' && op == 'request') {
      let space = await dir.space(get('space'))
      return space && !space.trashed
        ? await request(env, req, dir, space, get)
        : nothingHere(env)
    }
    if (req.method == 'POST' && op == 'log' && get('provider_log')) {
      let who = await sessionAt(req, env)
      let space = await dir.space(get('space'))
      let row = space
        ? (await meta(env).query(current(space.eid)))[0]
        : undefined
      let contract = contractOf(row)
      if (
        !who?.person || !space || space.trashed || !contract ||
        who.space && who.space != space.eid ||
        contract.provider != who.person ||
        !await dir.role(space, who.person)
      ) return nothingHere(env)
      await logTime(env, space, contract, who.person, get)
      return new Response(null, {
        status: 303,
        headers: {
          location: managePath('billing', space.slug) + '#contact-support',
        },
      })
    }
    let platform = await dir.space(META.space)
    let who = await adminWho(
      env,
      req,
      (person) => platform ? dir.role(platform, person) : Promise.resolve(null),
    )
    if (!who.person || who.role != 'owner') return nothingHere(env)
    let slug = get('space')
    if (req.method == 'GET' && !slug) {
      return Response.json(await allSupport(env))
    }
    let space = await dir.space(slug)
    if (!space || space.trashed) return nothingHere(env)
    if (req.method == 'POST') {
      if (op == 'set') {
        await set(env, dir, space, who.person, get)
      } else if (op == 'log') {
        let [row] = await meta(env).query(current(space.eid))
        let contract = contractOf(row)
        if (!contract) {
          throw new CallError('space', 'Set the support contract first.')
        }
        await logTime(env, space, contract, who.person, get, who.via)
      } else {
        throw new CallError('op', 'Choose set or log.')
      }
      if (get('browser')) {
        return new Response(null, {
          status: 303,
          headers: { location: `/admin/${space.eid}#support-contract` },
        })
      }
    }
    return Response.json(await supportFor(env, space))
  } catch (e) {
    if (!(e instanceof CallError)) throw e
    return get('browser')
      ? page(env, { title: 'Support contract', lead: e.message, status: 400 })
      : Response.json({ error: { code: e.code, message: e.message } }, {
        status: 400,
      })
  }
}
