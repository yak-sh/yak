import {
  type Answer,
  answers,
  type Request as TransferRequest,
  type Transfer,
} from '@yaks/platform/app-transfer'
import type {
  Answer as DomainAnswer,
  Request as DomainTransfer,
} from '@yaks/platform/domain-transfer'
import { mint } from '@yaks/graph/identity'
import { line, sub } from '@yaks/query'
import { sendable } from '@yaks/mail'
import { canon } from './signin.ts'
import {
  type Directory,
  directory,
  fetch,
  idOf,
  type Row,
  type Space,
  type Walk,
  walkTo,
} from './directory.ts'
import { bound, type Env } from './env.ts'
import type { Who } from './session.ts'
import { vouched } from './session.ts'
import { APP, EID, flag, inApp, owner, refuse, SPACE, str } from './tool.ts'
import type { Update } from './operator-updates.ts'
import type { Row as ToolRow } from './tool-words.ts'
import { FRIEND, recipientOf } from './friends.ts'

let open = (env: Env) => directory(bound(env.DIRECTORY, fetch, env))

let apply = (
  dir: Directory,
  who: Who,
  asked: TransferRequest | DomainTransfer,
  key = '$appTransfer',
) =>
  dir.stamp({
    entities: [{ entity: { eid: key }, [key]: asked }],
  }, vouched(who))

export let offerDomain = async (
  dir: Directory,
  space: Space,
  who: Who,
  hostname: string,
  destination: string,
) => {
  if (!who.person || who.role != 'owner') {
    throw refuse('access', 'Only an owner can offer this domain.')
  }
  let [hosts, target] = await Promise.all([
    dir.hosts(space),
    dir.space(destination),
  ])
  let host = hosts.find((row) => row.name == hostname && !row.trashed)
  if (!host) throw refuse('missing', 'This space does not hold that domain.')
  if (!target) throw refuse('missing', 'No space has that address.')
  await apply(dir, who, {
    person: who.person,
    at: new Date().toISOString(),
    eid: mint(),
    offer: { host: host.eid, from: space.eid, to: target.eid },
  }, '$domainTransfer')
  return `Transfer offered. An owner of ${
    target.title || target.slug
  } can respond in Updates.`
}

export let transferEmail = async (
  dir: Directory,
  person: string,
  args: Record<string, unknown>,
) => {
  let email = canon(await recipientOf(dir, person, args))
  if (!sendable(email)) {
    throw refuse('arguments', 'Enter the recipient’s yaks.app sign-in email.')
  }
  return email
}

export let transferTool: ToolRow = {
  name: 'app_transfer',
  destructive: false,
  idempotent: true,
  role: 'owner',
  input: {
    type: 'object',
    properties: {
      space: SPACE,
      app: APP,
      friend: FRIEND,
      email: str('the recipient’s yaks.app sign-in email, when not a friend'),
      editor: {
        type: 'boolean',
        description:
          'offer to remain an editor of this app if the recipient agrees',
      },
    },
    required: ['app'],
  },
  run: async (ctx, args) => {
    let { space, app, who } = owner(await inApp(ctx, args, true))
    let dir = open(ctx.env)
    let email = await transferEmail(dir, ctx.person, args)
    let recipient = await dir.personAt(email)
    if (!recipient) {
      throw refuse('missing', 'No yaks.app account has that sign-in email.')
    }
    let applied = await apply(dir, who, {
      person: ctx.person,
      at: new Date().toISOString(),
      eid: mint(),
      offer: {
        app: app.eid,
        from: space.eid,
        recipient,
        editor: args.editor == null ? false : flag(args.editor, 'editor'),
      },
    })
    let offer = applied.find((b) => b.app_transfer) as Transfer | undefined
    if (!offer) throw new Error('App transfer did not return its offer')
    return {
      text:
        `${
          app.title || app.slug
        } was offered to ${email}. They can accept or decline it in their Updates. ` +
        'If they accept, other apps attached to this app’s store will be detached.',
      space,
      value: { transfer: offer.entity.eid },
    }
  },
}

/** The offers of apps and domains to the space at `walk` that `person` is
 * to answer, by the walk, so a page asks them beside the read that learns
 * the space (manage.ts `foresee`). */
export let offered = (dir: Directory, walk: Walk, person: string) =>
  Promise.all([
    dir.read(
      line`.app_transfer.to${
        sub(walk.path)
      }&.app_transfer.recipient=${person}&?app_transfer_answer&?created`,
    ),
    dir.domainTransfersTo(walk),
  ])

let newest = (rows: Row[], history: boolean) =>
  rows.toSorted((a, b) =>
    (b.created?.at ?? '').localeCompare(a.created?.at ?? '')
  ).slice(0, history ? undefined : 40)

let appUpdates = async (
  dir: Directory,
  space: Space,
  offers: Row[],
  history: boolean,
): Promise<Update[]> => {
  let items = newest(offers, history)
  return (await Promise.all(items.map(async (row) => {
    let offer = row.app_transfer!
    let response = row.app_transfer_answer
    let [held, giver] = await Promise.all([
      dir.appAt(idOf(offer.app)),
      dir.nameAt(idOf(offer.giver)),
    ])
    if (
      !held ||
      !response &&
        (held.app.trashed || held.space.trashed ||
          held.space.eid != idOf(offer.from))
    ) return null
    let name = held.app.title || held.app.slug
    let person = giver || 'The owner'
    let needs = !response
    return {
      eid: row.entity.eid,
      at: response?.at ?? row.created?.at ?? '',
      subject: name,
      words: needs
        ? `${person} offered you ${name} from ${held.space.slug}. Accepting moves the app, its data, files, and future charges to ${space.slug}.${
          offer.editor ? ` ${person} asked to keep editing this app.` : ''
        }`
        : response?.answer == 'decline'
        ? `You declined ${name}.`
        : `You accepted ${name}.`,
      needs,
      unread: false,
      dismissed: false,
      transfer: { editor: !!offer.editor && needs },
    } satisfies Update
  }))).filter((row) => row != null)
}

let domainUpdates = async (
  dir: Directory,
  space: Space,
  offers: Row[],
  history: boolean,
): Promise<Update[]> => {
  let rows = newest(offers, history)
  return (await Promise.all(rows.map(async (row) => {
    let offer = row.domain_transfer!
    let response = row.domain_transfer_answer
    if (response?.answer == 'withdrawn') return null
    let from = await dir.at(idOf(offer.from))
    if (!response && (!from || from.trashed)) return null
    let fromName = from?.title || from?.slug || 'another space'
    let name = offer.name
    return {
      eid: row.entity.eid,
      at: response?.at ?? row.created?.at ?? '',
      subject: name,
      words: !response
        ? `${fromName} offered you ${name}. Accepting moves the domain and its renewal to ${
          space.title || space.slug
        }. The domain arrives unattached.`
        : response.answer == 'decline'
        ? `You declined ${name}.`
        : `You accepted ${name}.`,
      needs: !response,
      unread: false,
      dismissed: false,
      transfer: { editor: false, kind: 'domain' },
    } satisfies Update
  }))).filter((row) => row != null)
}

export let transferUpdates = async (
  dir: Directory,
  space: Space,
  who: Who,
  history = false,
) => {
  if (!who.person || who.role != 'owner') return []
  let [apps, domains] = await offered(
    dir,
    walkTo(space.slug, space.eid),
    who.person,
  )
  return (await Promise.all([
    appUpdates(dir, space, apps as unknown as Row[], history),
    domainUpdates(dir, space, domains, history),
  ])).flat()
}

export let answerTransfer = async (
  env: Env,
  space: Space,
  who: Who,
  transfer: string,
  answer: string,
) => {
  if (!who.person || who.role != 'owner') {
    throw refuse('access', 'Only the recipient can answer this offer.')
  }
  if (!EID.test(transfer) || !answers.includes(answer as Answer)) {
    throw refuse('arguments', 'Choose an answer from the offer.')
  }
  let dir = open(env)
  let domain = await dir.domainTransferAt(transfer)
  let request = {
    person: who.person,
    at: new Date().toISOString(),
    space: space.eid,
    transfer,
  }
  if (domain) {
    await apply(
      dir,
      who,
      { ...request, answer: answer as DomainAnswer },
      '$domainTransfer',
    )
  } else await apply(dir, who, { ...request, answer: answer as Answer })
  return domain ? 'domain' : 'app'
}
