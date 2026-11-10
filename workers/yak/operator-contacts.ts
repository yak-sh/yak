// Contact changes start in the conversation. Email ownership codes and the
// person's optional SMS consent put contacts on the directory person.
import type { Bundle, Comp } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { kindOf, type Tool } from '@yaks/session'
import { mobile } from '@yaks/phone/mobile'
import { Unsent } from '@yaks/mail'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import { type Ctx, refuse } from './tool.ts'
import type { OperatorStore } from './operator-store.ts'
import { owns } from './operator-access.ts'
import { inputSource } from './operator-provenance.ts'
import { canon, LIFE, mac, mint, TRIES } from './signin.ts'
import { KERNEL, meta } from './meta.ts'
import { type Mail, mail } from './mail.ts'
import { managePath } from './route.ts'
import { CONSENT, REPLIES, tell, texts } from './operator-texts.ts'
import { alert, alertsRow } from './operator-alerts.ts'

type Contact = {
  person: string
  address: string
  source: string
  request: string
  code?: string
  expires?: string
  tries?: number
  consent?: string
  consent_source?: string
  session: string
}
let comp = (row: Bundle | undefined, name: string) =>
  row?.[name] as Comp | undefined
let addressOf = (typed: unknown) => {
  let address = canon(String(typed ?? ''))
  if (!mobile(address) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    throw refuse(
      'arguments',
      'Give an email address or a US mobile number with its area code.',
    )
  }
  return address
}

let sourceOf = async (
  store: OperatorStore,
  ctx: Ctx,
  space: Space,
  id: unknown,
) => {
  let eid = String(id ?? '')
  let [row] = eid ? await store.g.get([eid]) : []
  let from = comp(row, 'entry')?.from
  if (
    !row || kindOf(row) != 'input' || row.system || row.notice || row.prompt ||
    (inputSource(row) && inputSource(row) != 'the person on the phone') ||
    (from && from != 'the person') ||
    !await owns(store, eid, { person: ctx.person, space: space.eid })
  ) {
    throw refuse(
      'arguments',
      'source must name this person’s own conversation entry.',
    )
  }
  return { eid, words: String(comp(row, 'content')?.body ?? '') }
}

let available = async (ctx: Ctx, address: string) => {
  let person = mobile(address)
    ? await ctx.dir.phoned(address)
    : await ctx.dir.personAt(address)
  if (person && person != ctx.person) {
    throw refuse(
      'conflict',
      'That contact belongs to another account. Sign in with it to use that account.',
    )
  }
}

let pending = async (
  store: OperatorStore,
  person: string,
  session: string,
  address: string,
) =>
  (await store.g.read(
    `.operator_contact.person=${person} .operator_contact.session=${session} .operator_contact.address=${
      JSON.stringify(address)
    } !cancelled ?created ?verified .order=-created.at .limit=1`,
  ))[0]

let sendCode = async (send: Mail, address: string, code: string) => {
  await send({
    to: address,
    subject: `${code} is your yaks.app contact code`,
    body:
      `Your yaks.app contact verification code is ${code}.\n\nType it in your Operator conversation to confirm this email address. It expires in ten minutes. If you did not ask for this, ignore it; no contact has changed.`,
  })
}

// Only the source entry's code opens the request. A model's guessed code or
// another person's words cannot verify a contact. CAS counts concurrent tries.
let checked = async (
  store: OperatorStore,
  row: Bundle,
  secret: string,
  code: string,
  words: string,
) => {
  let c = row.operator_contact as Contact
  if (!/^\d{6}$/.test(code) || !words.includes(code)) {
    throw refuse(
      'arguments',
      'Ask them to type the six-digit code they received in this conversation.',
    )
  }
  if (
    !c.code || Date.parse(c.expires ?? '') <= Date.now() ||
    (c.tries ?? 0) >= TRIES
  ) {
    throw refuse(
      'expired',
      'That code expired or has no guesses left. Ask for a new code.',
    )
  }
  await store.g.apply([{
    entity: row.entity,
    operator_contact: { tries: (c.tries ?? 0) + 1 },
    $was: { operator_contact: { tries: token(c.tries) } },
  }], { trusted: true })
  if (await mac(c.address, code, secret) != c.code) {
    throw refuse(
      'arguments',
      'That code does not match. Check it and try again.',
    )
  }
}

let confirmed = async (
  env: Env,
  ctx: Ctx,
  space: Space,
  store: OperatorStore,
  row: Bundle,
  source: string,
) => {
  let c = row.operator_contact as Contact
  await available(ctx, c.address)
  let at = new Date().toISOString()
  let sms = !!mobile(c.address)
  let entities = sms
    ? texts(ctx.person, c.address, true, at, space.eid).map((b) =>
      b.sms_consent
        ? { ...b, sms_consent: { ...b.sms_consent as Comp, source } }
        : b
    )
    : [{ entity: { eid: ctx.person }, email: { address: c.address } }]
  await meta(env).apply([
    ...entities,
    alertsRow(ctx.person, sms ? 'text' : 'email'),
  ], KERNEL)
  await store.g.apply([{
    entity: row.entity,
    verified: {},
    operator_contact: {
      code: null,
      ...(sms ? { consent: CONSENT, consent_source: source } : {}),
    },
  }], { trusted: true })
  if (sms) {
    await tell(
      env,
      { to: c.address, text: REPLIES.welcome },
      'contact text welcome',
    )
  }
  // A completion written while the address was still unverified stays owed.
  let [request] = await store.g.get([c.request ?? c.source], ['created'])
  let since = String(
    comp(request, 'created')?.at ?? comp(row, 'created')?.at ??
      new Date().toISOString(),
  )
  let owed = await store.g.read(
    `.notification .deliver.to=${ctx.person} !delivered !bounced .created.by=${space.eid} .created.at>=${
      JSON.stringify(since)
    }`,
  )
  for (let note of owed) {
    if (await inConversation(store, note, c.session)) {
      await alert(env, store, note.entity.eid)
    }
  }
  return JSON.stringify({
    confirmed: c.address,
    person: ctx.person,
    stored: 'directory person',
    channel: sms ? 'text' : 'email',
  })
}

/** Conversation-side configuration, with pending requests available through
 * graph_query(self:true); the directory remains the source of contacts. */
export let contactAdd = (
  env: Env,
  ctx: Ctx,
  space: Space,
  store: OperatorStore,
  send: Mail = mail(env),
): Tool => ({
  name: 'contact_add',
  title: 'Add your contact',
  description:
    'Add the email address or US mobile number the person asked you to reach them at, including in an anonymous conversation. source is their own entry id: find it with graph_query(self:true). A mobile number shows an inline optional consent form for them to confirm; you cannot agree for them. An email receives an ownership verification code. Ask them to type it here, then call with code and source naming their code entry. Until confirmed it is not a contact and receives no work or alerts. On confirmation it becomes their directory email{address} or phone{number} + sms_consent{person,consent,at,space,source}, and chosen notification channel. Use notification_send for their requested completion, even while verification is pending; it waits for confirmation. Read confirmed contacts by calling without address. Never use mail_send to bypass verification of their own new address. Pending requests are operator_contact{person,address,source,session,code,expires,tries} in your graph; only this confirmation path changes directory contacts.',
  parameters: {
    type: 'object',
    properties: {
      address: {
        type: 'string',
        description: 'The email address or US mobile number they gave.',
      },
      source: {
        type: 'string',
        description:
          'Their own entry id containing the request, agreement, or verification code.',
      },
      code: {
        type: 'string',
        description:
          'The six digits they received and typed in their own entry.',
      },
    },
  },
  run: async (args) => {
    if (!args.address) {
      return JSON.stringify({
        email: await ctx.dir.emailAt(ctx.person),
        phone: await ctx.dir.phoneAt(ctx.person),
        texting: await ctx.dir.texting(ctx.person),
      })
    }
    let address = addressOf(args.address)
    let source = await sourceOf(store, ctx, space, args.source)
    await available(ctx, address)
    let [entry] = await store.g.get([source.eid], ['entry'])
    let session = String(comp(entry, 'entry')!.session)
    let row = await pending(store, ctx.person, session, address)
    if (args.code) {
      if (!row || row.verified || row.cancelled) {
        throw refuse('missing', 'Ask for a contact verification code first.')
      }
      try {
        await checked(
          store,
          row,
          env.SESSION_SECRET!,
          String(args.code).trim(),
          source.words,
        )
      } catch (e) {
        if (e instanceof Stale) {
          throw refuse(
            'conflict',
            'Another code was checked at the same time. Try again.',
          )
        }
        throw e
      }
      return confirmed(env, ctx, space, store, row, source.eid)
    }
    let [open] = await store.g.read(
      `.operator_contact.person=${ctx.person} .operator_contact.session=${session} !verified !cancelled ?created .order=created.at .limit=1`,
    )
    let id = open?.entity.eid ?? crypto.randomUUID()
    let request = comp(open, 'operator_contact')?.request ??
      comp(open, 'operator_contact')?.source ?? source.eid
    let sms = !!mobile(address)
    let mentioned = sms
      ? source.words.replace(/\D/g, '').includes(address.slice(-10))
      : source.words.toLowerCase().includes(address)
    if (!mentioned) {
      throw refuse(
        'arguments',
        'source must be the person’s own request giving this contact.',
      )
    }
    if (sms) {
      await supersede(store, ctx.person, session, id)
      let offered = {
        contact: {
          id,
          number: address,
          action: `${managePath('operator', space.slug)}?texts=1`,
        },
        next:
          'The inline form asks them to agree to texts. Wait for them to confirm; you cannot do it for them.',
      }
      await store.g.apply([{
        entity: { eid: id },
        entry: { session, from: 'the system' },
        notice: {},
        system: {},
        content: { body: JSON.stringify(offered) },
        operator_contact: {
          person: ctx.person,
          address,
          source: source.eid,
          request,
          session,
          code: null,
          expires: null,
          tries: null,
        },
      }], { trusted: true })
      return JSON.stringify(offered)
    }
    let secret = env.SESSION_SECRET
    if (!secret) throw new Error('Contact verification has no session secret')
    if (
      row && !row.verified &&
      Date.parse(String(comp(row, 'operator_contact')?.expires)) > Date.now()
    ) {
      return JSON.stringify({
        address,
        next: 'A code is already on its way. Ask them to type it here.',
      })
    }
    let code = await mint(meta(env), secret, address)
    if (!code) {
      throw refuse(
        'limit',
        'That address has had three codes this hour. Use one already sent or try later.',
      )
    }
    await supersede(store, ctx.person, session, id)
    await store.g.apply([{
      entity: { eid: id },
      operator_contact: {
        person: ctx.person,
        address,
        source: source.eid,
        request,
        session,
        code: await mac(address, code, secret),
        expires: new Date(Date.now() + LIFE).toISOString(),
        tries: 0,
      },
    }], { trusted: true })
    try {
      await sendCode(send, address, code)
    } catch (error) {
      if (error instanceof Unsent) {
        await store.g.apply([{
          entity: { eid: id },
          operator_contact: { code: null, expires: null },
        }], { trusted: true })
      }
      throw error
    }
    return JSON.stringify({
      address,
      next: 'Ask them to type the six-digit code here to confirm ownership.',
    })
  },
})

/** The authenticated form action; a tool call cannot give this consent. */
export let confirmTextContact = async (
  env: Env,
  ctx: Ctx,
  space: Space,
  store: OperatorStore,
  id: string,
  number: string,
  agreed: boolean,
) => {
  let [row] = await store.g.get([id])
  let c = row?.operator_contact as Contact | undefined
  if (
    !row || row.cancelled || !c || c.person != ctx.person ||
    !mobile(c.address) ||
    c.address != mobile(number)
  ) {
    throw refuse('missing', 'That contact request is missing.')
  }
  if (!agreed) throw refuse('arguments', 'Tick the box to agree to texts.')
  if (row.verified) return { confirmed: c.address }
  await sourceOf(store, ctx, space, c.source)
  await confirmed(env, ctx, space, store, row, id)
  return { confirmed: c.address }
}

let inConversation = async (
  store: Pick<OperatorStore, 'g'>,
  row: Bundle,
  session: string,
) => {
  let via = String(comp(row, 'created')?.via ?? '')
  let seen = new Set<string>()
  while (via && !seen.has(via) && via != session) {
    seen.add(via)
    let [parent] = await store.g.get([via], ['spawned'])
    via = String(comp(parent, 'spawned')?.parent ?? '')
  }
  return via == session
}

/** Only fresh notices in the requesting conversation wait for its contact;
 * historical Updates are never sent when a person adds a destination. */
export let waitingContact = async (
  store: Pick<OperatorStore, 'g'>,
  note: Bundle,
) => {
  let person = comp(note, 'deliver')?.to
  let at = String(comp(note, 'created')?.at ?? '')
  if (!person || !at) return false
  let rows = await store.g.read(
    `.operator_contact.person=${person} !verified !cancelled`,
  )
  for (let row of rows) {
    if (
      await inConversation(
        store,
        note,
        String(comp(row, 'operator_contact')?.session),
      )
    ) {
      let c = row.operator_contact as Contact
      let [request] = await store.g.get([c.request ?? c.source], ['created'])
      if (String(comp(request, 'created')?.at ?? '') <= at) {
        return 'confirmation' as const
      }
    }
  }
  let session = String(comp(note, 'created')?.via ?? '')
  if (!session) return false
  let calls = await store.g.read(
    `.call.to.tool.name=contact_add .entry.session=${session} ?execution`,
  )
  return calls.some((row) => {
      let args = comp(row, 'call')?.args as Record<string, unknown> | undefined
      return args?.address && !args.code &&
        (!row.execution || comp(row, 'execution')?.state == 'running')
    })
    ? 'tool' as const
    : false
}

let supersede = async (
  store: OperatorStore,
  person: string,
  session: string,
  keep: string,
) => {
  let older = await store.g.read(
    `.operator_contact.person=${person} .operator_contact.session=${session} !verified !cancelled`,
  )
  await store.g.apply(
    older.filter((r) => r.entity.eid != keep).map((r) => ({
      entity: r.entity,
      cancelled: { reason: 'Replaced by another contact request.' },
    })),
    { trusted: true },
  )
}
