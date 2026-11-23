import {
  type Answer,
  answers,
  type Request as TransferRequest,
  type Transfer,
} from '@yaks/platform/app-transfer'
import { mint } from '@yaks/graph/identity'
import { line } from '@yaks/query'
import { sendable } from '@yaks/mail'
import { managePath } from '@yaks/platform/routes'
import { canon } from './signin.ts'
import {
  type Directory,
  directory,
  fetch,
  idOf,
  type Row,
  type Space,
} from './directory.ts'
import { bound, type Env } from './env.ts'
import type { Who } from './session.ts'
import { vouched } from './session.ts'
import {
  APP,
  EID,
  flag,
  inApp,
  owner,
  refuse,
  SPACE,
  str,
  text,
  type Tool,
} from './tool.ts'
import type { Update } from './operator-updates.ts'

let open = (env: Env) => directory(bound(env.DIRECTORY, fetch, env))

let apply = (dir: Directory, who: Who, asked: TransferRequest) =>
  dir.stamp({
    entities: [{ entity: { eid: '$appTransfer' }, $appTransfer: asked }],
  }, vouched(who))

export let transferTool: Tool = {
  name: 'app_transfer',
  title: 'Offer an app transfer',
  description:
    'Offer to give an app you own to another yaks.app user. Use when the person asks to give or transfer their app. Ask for the recipient’s sign-in email if it is unclear. The app stays where it is until that person accepts in their own Updates. Acceptance moves the app, data, files, releases and future billing to their space. Offer to keep editing access only if the giver asks for it. The recipient can choose whether to allow it.',
  destructive: false,
  idempotent: true,
  role: 'owner',
  input: {
    type: 'object',
    properties: {
      space: SPACE,
      app: APP,
      email: str('the recipient’s yaks.app sign-in email'),
      editor: {
        type: 'boolean',
        description:
          'offer to remain an editor of this app if the recipient agrees',
      },
    },
    required: ['app', 'email'],
  },
  run: async (ctx, args) => {
    let { space, app, who } = owner(await inApp(ctx, args, true))
    let email = canon(text(args.email, 'email'))
    if (!sendable(email)) {
      throw refuse('arguments', 'Enter the recipient’s yaks.app sign-in email.')
    }
    let dir = open(ctx.env)
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
      text: `${
        app.title || app.slug
      } was offered to ${email}. They can accept or decline it in their Updates.`,
      space,
      value: { transfer: offer.entity.eid },
    }
  },
}

let offers = (dir: Directory, space: Space, who: Who) =>
  !who.person || who.role != 'owner' ? [] : dir.read(
    line`.app_transfer.to=${space.eid}&.app_transfer.recipient=${who.person}&?app_transfer_answer&?created`,
  )

export let transferUpdates = async (
  env: Env,
  space: Space,
  who: Who,
): Promise<Update[]> => {
  let dir = open(env)
  let items = (await offers(dir, space, who) as unknown as Row[])
    .sort((a, b) => (b.created?.at ?? '').localeCompare(a.created?.at ?? ''))
    .slice(0, 40)
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
  await apply(open(env), who, {
    person: who.person,
    at: new Date().toISOString(),
    space: space.eid,
    transfer,
    answer: answer as Answer,
  })
  return managePath('updates', space.slug)
}
