import type { Bundle, Comp, Tx } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { after, together } from '@yaks/fp'
import { line } from '@yaks/query'
import { ceilings } from './plans.ts'

export type Offer = {
  app: string
  from: string
  to: string
  giver: string
  recipient: string
  editor: boolean
}

export type Answer = 'accept' | 'accept-with-editor' | 'decline'
export type Transfer = Bundle & { app_transfer: Offer }
export type Request =
  & {
    person: string
    at: string
  }
  & ({ eid: string; offer: Omit<Offer, 'giver' | 'to'> } | {
    transfer: string
    space: string
    answer: Answer
  })

export let answers: Answer[] = ['accept', 'accept-with-editor', 'decline']

let part = (row: Bundle | undefined, name: string) =>
  row?.[name] as Comp | undefined

let id = (value: unknown) =>
  typeof value == 'string'
    ? value
    : String((value as { eid?: string })?.eid ?? '')

let one = (tx: Tx, eid: string) => after(tx.get([eid]), (rows) => rows[0])

let owners = (tx: Tx, person: string) =>
  tx.read(line`.member.person=${person}&.member.role=owner&?created`)

let live = (row: Bundle | undefined, name: string) =>
  !!row?.[name] && !row.trashed

let home = (tx: Tx, person: string) =>
  after(owners(tx, person), (seats) => {
    let seat = seats.sort((a, b) =>
      Number(!!part(b, 'member')?.own) - Number(!!part(a, 'member')?.own) ||
      String(part(a, 'created')?.at ?? '').localeCompare(
        String(part(b, 'created')?.at ?? ''),
      )
    )[0]
    return seat ? one(tx, id(part(seat, 'member')?.space)) : undefined
  })

let offered = (
  tx: Tx,
  { person, eid, offer: asked }: Extract<Request, { offer: unknown }>,
) =>
  after(
    together([
      one(tx, asked.app),
      one(tx, asked.from),
      one(tx, asked.recipient),
      owners(tx, person),
      home(tx, asked.recipient),
    ]),
    ([app, source, recipient, seats, target]): Bundle[] | Promise<Bundle[]> => {
      if (
        !live(app, 'app') || id(part(app, 'app')?.space) != asked.from ||
        !live(source, 'space') || part(source, 'space')?.slug == 'yak' ||
        !seats.some((r) => id(part(r, 'member')?.space) == asked.from)
      ) {
        throw new Refused('Only an owner of this app’s space can offer it.')
      }
      if (
        !live(recipient, 'person') || !target || !live(target, 'space') ||
        target.entity.eid == asked.from ||
        part(target, 'space')?.slug == 'yak' ||
        asked.recipient == person
      ) {
        throw new Refused(
          'Choose a different person who owns an active yaks.app space.',
        )
      }
      let offer = { ...asked, giver: person, to: target.entity.eid }
      return after(
        tx.read(
          line`.app_transfer.app=${offer.app}&.app_transfer.from=${offer.from}&.app_transfer.to=${offer.to}&.app_transfer.giver=${person}&.app_transfer.recipient=${offer.recipient}&!app_transfer_answer`,
        ),
        ([prior]) => {
          if (prior && part(prior, 'app_transfer')?.editor != offer.editor) {
            throw new Refused(
              'This person already has an offer for this app. Ask them to decline it before changing the offer.',
            )
          }
          return [{
            entity: { eid: prior?.entity.eid ?? eid },
            app_transfer: offer,
          }]
        },
      )
    },
  )

let changed = (
  tx: Tx,
  transfer: string,
  o: Offer,
  answer: Answer,
  at: string,
) =>
  after(
    together([
      one(tx, o.app),
      one(tx, o.from),
      one(tx, o.to),
      owners(tx, o.giver),
      owners(tx, o.recipient),
      tx.read(line`.app.space=${o.to}&!trashed&?former`),
      tx.read(line`.grant.app=${o.app}&.grant.person=${o.giver}`),
      tx.read(line`.edge.from=${o.app}&.uses`),
    ]),
    (
      [app, source, target, givers, recipients, apps, grants, connections],
    ): Bundle[] => {
      if (
        !live(app, 'app') || id(part(app, 'app')?.space) != o.from ||
        !live(source, 'space') || !live(target, 'space') ||
        !givers.some((r) => id(part(r, 'member')?.space) == o.from) ||
        !recipients.some((r) => id(part(r, 'member')?.space) == o.to)
      ) {
        throw new Refused('This offer is no longer available.')
      }
      let data = part(app, 'app')!
      let slug = String(data.slug)
      let to = part(target, 'space')!
      if (
        apps.some((r) =>
          part(r, 'app')?.slug == slug ||
          String(part(r, 'former')?.slugs ?? '').split(/\s+/).includes(slug)
        )
      ) {
        throw new Refused(`The address ${to.slug}/${slug} is already in use.`)
      }
      let cap = ceilings(
        part(target, 'plan')?.tier as Parameters<typeof ceilings>[0],
        String(to.slug),
      )?.apps
      if (cap != null && apps.length >= cap) {
        throw new Refused(`${to.slug} has reached its plan’s app limit.`)
      }
      if (data.fence) {
        throw new Refused(
          'This app is releasing a version. Try again when it finishes.',
        )
      }
      if (
        connections.some((row) => {
          let use = part(row, 'uses')!
          return use.direct || !use.each && !use.lender
        })
      ) {
        throw new Refused(
          'Disconnect the app’s shared credentials before transferring it. Personal connections and borrowed integrations can stay.',
        )
      }
      let grant = grants[0]
      let keep = answer == 'accept-with-editor'
      let prefix = String(
        part(source, 'space')?.store ?? part(source, 'space')?.slug,
      )
      let former = part(app, 'former')
      return [
        {
          entity: { eid: o.app },
          app: {
            space: o.to,
            files: data.files ?? `${prefix}/${slug}`,
            store: data.store ?? `${part(source, 'space')?.slug}/${slug}`,
          },
          former: { slug, slugs: slug },
          ...(app?.home ? { home: null } : {}),
        },
        ...(grant || keep
          ? [{
            entity: {
              eid: grant?.entity.eid ??
                derivedEid(`transfer-editor|${o.app}|${o.giver}`),
            },
            ...(keep
              ? {
                grant: {
                  app: o.app,
                  person: o.giver,
                  access: 'editor',
                  build: true,
                },
              }
              : { $delete: true }),
          }]
          : []),
        {
          entity: { eid: transfer },
          app_transfer_answer: {
            at,
            answer,
            slugs: [
              ...new Set([
                slug,
                ...String(former?.slugs ?? '').split(/\s+/).filter(Boolean),
              ]),
            ].join(' '),
          },
        },
      ]
    },
  )

let answered = (tx: Tx, asked: Extract<Request, { transfer: string }>) =>
  after(one(tx, asked.transfer), (row): Bundle[] | Promise<Bundle[]> => {
    let offer = part(row, 'app_transfer')
    if (
      !offer || id(offer.recipient) != asked.person ||
      id(offer.to) != asked.space
    ) {
      throw new Refused('This offer is not in your Updates.')
    }
    if (part(row, 'app_transfer_answer')?.answer == asked.answer) return []
    if (row?.app_transfer_answer) {
      throw new Refused('This offer has already been answered.')
    }
    if (
      !answers.includes(asked.answer) ||
      asked.answer == 'accept-with-editor' && !offer.editor
    ) {
      throw new Refused('Choose an answer from the offer.')
    }
    if (asked.answer == 'decline') {
      return [{
        entity: { eid: asked.transfer },
        app_transfer_answer: { answer: 'decline', at: asked.at },
      }]
    }
    return changed(
      tx,
      asked.transfer,
      {
        app: id(offer.app),
        from: id(offer.from),
        to: id(offer.to),
        recipient: id(offer.recipient),
        giver: id(offer.giver),
        editor: !!offer.editor,
      },
      asked.answer,
      asked.at,
    )
  })

export let decide = (tx: Tx, asked: Request) =>
  'offer' in asked ? offered(tx, asked) : answered(tx, asked)
