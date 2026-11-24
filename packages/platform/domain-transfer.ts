import type { Bundle, Comp, Tx } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { after, together } from '@yaks/fp'
import { line } from '@yaks/query'
import { type Id, idOf } from './listing.ts'

export type Offer = {
  host: string
  name: string
  from: string
  to: string
  giver: string
}

export type Answer = 'accept' | 'decline'
type Answered = Answer | 'withdrawn'

export type Request =
  & {
    person: string
    at: string
  }
  & (
    | { eid: string; offer: Omit<Offer, 'giver' | 'name'> }
    | { transfer: string; space: string; answer: Answer }
  )

let part = (row: Bundle | undefined, name: string) =>
  row?.[name] as Comp | undefined

let id = (value: unknown) => value == null ? '' : idOf(value as Id)
let one = (tx: Tx, eid: string) => after(tx.get([eid]), (rows) => rows[0])

let owns = (tx: Tx, person: string, space: string) =>
  after(
    tx.read(
      line`.member.person=${person}&.member.space=${space}&.member.role=owner`,
    ),
    (rows) => rows.length > 0,
  )

let live = (row: Bundle | undefined, name: string) =>
  !!row?.[name] && !row.trashed

let places = (tx: Tx, host: string) =>
  after(one(tx, host), (row) => {
    let hostname = part(row, 'hostname')
    if (!live(row, 'hostname') || !hostname) return undefined
    let name = String(hostname.name)
    let destination = id(hostname.serves)
    return after(
      together([
        tx.read(line`.domain_order.name=${name}&.domain_registered`),
        destination ? one(tx, destination) : undefined,
      ]),
      ([orders, at]) => ({
        name,
        destination,
        space: id(hostname.space) ||
          id(part(orders[0], 'domain_order')?.space) ||
          (part(at, 'space') ? destination : id(part(at, 'app')?.space)),
        order: orders[0],
      }),
    )
  })

let pending = (tx: Tx, host: string) =>
  tx.read(line`.domain_transfer.host=${host}&!domain_transfer_answer`)

let offered = (
  tx: Tx,
  { person, eid, offer }: Extract<Request, { offer: unknown }>,
) =>
  after(
    together([
      places(tx, offer.host),
      one(tx, offer.from),
      one(tx, offer.to),
      owns(tx, person, offer.from),
      pending(tx, offer.host),
    ]),
    ([held, source, target, owner, offers]): Bundle[] => {
      if (
        !held || held.space != offer.from || !owner || !live(source, 'space')
      ) {
        throw new Refused(
          'Only an owner of the space that holds this domain can offer it.',
        )
      }
      if (
        offer.from == offer.to || !live(target, 'space') ||
        part(target, 'space')?.slug == 'yak'
      ) {
        throw new Refused('Choose a different active space.')
      }
      let existing = offers.find((r) =>
        id(part(r, 'domain_transfer')?.from) == offer.from &&
        id(part(r, 'domain_transfer')?.to) == offer.to
      )
      if (existing) return []
      return [{
        entity: { eid },
        domain_transfer: { ...offer, name: held.name, giver: person },
      }]
    },
  )

let receipt = (eid: string, answer: Answered, at: string): Bundle => ({
  entity: { eid },
  domain_transfer_answer: { answer, at },
})

let accepted = (
  tx: Tx,
  offer: Comp,
  transfer: string,
  at: string,
) => {
  let host = id(offer.host)
  let from = id(offer.from)
  let to = id(offer.to)
  let name = String(offer.name)
  return after(
    together([
      places(tx, host),
      one(tx, from),
      one(tx, to),
      owns(tx, id(offer.giver), from),
      pending(tx, host),
      tx.read(line`.hostname.to=${name}`),
    ]),
    ([held, source, target, giver, otherOffers, redirects]): Bundle[] => {
      if (
        !held || held.space != from || !giver ||
        !live(source, 'space') || !live(target, 'space')
      ) {
        throw new Refused('This offer is no longer available.')
      }
      let order = part(held.order, 'domain_order')
      return [
        {
          entity: { eid: host },
          hostname: { space: to, serves: null, to: null },
        },
        ...held.order && order
          ? [{
            entity: { eid: held.order.entity.eid },
            domain_order: { space: to, bought_by: id(order.bought_by) || from },
          }]
          : [],
        ...redirects.map((r) => ({
          entity: { eid: r.entity.eid },
          hostname: { to: null },
        })),
        ...otherOffers.filter((r) => r.entity.eid != transfer)
          .map((r) => receipt(r.entity.eid, 'withdrawn', at)),
        receipt(transfer, 'accept', at),
      ]
    },
  )
}

let answered = (
  tx: Tx,
  { person, space, transfer, answer, at }: Extract<
    Request,
    { transfer: string }
  >,
) =>
  after(
    together([one(tx, transfer), owns(tx, person, space)]),
    ([row, owner]): Bundle[] | Promise<Bundle[]> => {
      let offer = part(row, 'domain_transfer')
      if (!owner || !offer || id(offer.to) != space) {
        throw new Refused('This offer is not in your Updates.')
      }
      let previous = part(row, 'domain_transfer_answer')?.answer
      if (previous == answer) return []
      if (previous) throw new Refused('This offer is no longer available.')
      if (answer == 'decline') return [receipt(transfer, answer, at)]
      if (answer != 'accept') {
        throw new Refused('Choose an answer from the offer.')
      }
      return accepted(tx, offer, transfer, at)
    },
  )

export let decide = (tx: Tx, asked: Request) =>
  'offer' in asked ? offered(tx, asked) : answered(tx, asked)
