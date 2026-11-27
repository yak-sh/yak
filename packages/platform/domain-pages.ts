import { createElement as h } from 'react'
import { Button, Card, Field, Form, More, Notice, Rows } from '@yaks/ui/parts'
import { DOMAIN_RENEWAL } from './plans.ts'
import { amount } from './price.ts'
import { managePath } from './routes.ts'

export type Domain = {
  name: string
  destination: string
  dns?: string
  certificate?: string
  renewal?: string
  chosen?: boolean
  canChoose?: boolean
  payment?: { expires: string; cents: number; extra: number }
  status?: string
  canPoint?: boolean
  canTransfer?: boolean
}

export type DomainOffer = {
  name: string
  first?: string
  renewal?: string
  cents?: number
  renews?: number
  unavailable?: string
}

export type DomainApp = { eid: string; title: string; slug: string }

/** What came of a press on the page, said where it was pressed. */
export type Note = { words: string; refused?: boolean }

/** What came of each press, by the form it was in: `point:<name>`,
 * `transfer:<name>`, `choose:<name>`, and `search` for the search and its
 * checkouts. */
export type Notes = Record<string, Note>

// Where a form says what came of it: hidden until something did.
let noted = (note: Note | undefined, attr: string) =>
  h(Notice, {
    role: 'status',
    [attr]: '',
    hidden: !note,
    mod: note?.refused ? 'negative' : undefined,
  }, note?.words)

let title = (name: string) => h(Card.Head, null, h(Card.Title, null, name))

let hidden = (name: string, value: string | number) =>
  h(Form.Hidden, { name, value })

export let offers = (
  path: string,
  found: DomainOffer[],
  checkout: boolean,
  error?: string,
) =>
  error ? h(Notice, { mod: 'negative' }, error) : [
    found.some((o) => o.first) ? null : h(
      Rows.Note,
      null,
      'No available domains match this search. Try another name.',
    ),
    h(
      Rows,
      { as: 'ul' },
      found.map((offer) =>
        h(
          Rows.Item,
          {
            as: 'li',
            key: offer.name,
            'data-available': offer.first ? '' : undefined,
          },
          h(
            Rows.Main,
            null,
            h(Rows.Name, null, offer.name),
            offer.first
              ? h(
                Rows.Meta,
                null,
                `${offer.first} first year · ${offer.renewal} per year to renew.`,
              )
              : h(Rows.Meta, null, offer.unavailable),
          ),
          offer.first && checkout
            ? h(
              Rows.Form,
              {
                className: 'Rows_Actions',
                method: 'post',
                action: path,
                'data-domain-buy': '',
              },
              hidden('billing', 'domain'),
              hidden('domain', offer.name),
              hidden('cents', offer.cents!),
              offer.renews == null ? null : hidden('renews', offer.renews),
              h(Button, {
                mod: 'go',
                type: 'submit',
                'aria-label': `Buy ${offer.name} for ${offer.first}`,
              }, `Buy · ${offer.first}`),
            )
            : null,
        )
      ),
    ),
  ]

let option = (id: string, name: string, current: string) =>
  h('option', { value: id, selected: id == current }, name)

let transfer = (path: string, name: string, note?: Note) =>
  h(
    More,
    { mod: 'quiet' },
    h(More.Summary, { 'aria-label': `Transfer ${name}` }, 'Transfer…'),
    h(
      More.Body,
      null,
      h(
        Form,
        { method: 'post', action: path, 'data-domain-transfer': '' },
        hidden('transfer_domain', name),
        h(
          Form.Field,
          null,
          h(Form.Label, { for: `transfer-${name}` }, 'Receiving space'),
          h(
            Form.Line,
            null,
            h(Field, {
              id: `transfer-${name}`,
              name: 'receiving_space',
              placeholder: 'e.g. oak-studio',
              autocomplete: 'off',
              maxLength: 63,
              required: true,
            }),
            h(Button, { type: 'submit' }, 'Offer transfer'),
          ),
          h(
            Form.Hint,
            null,
            'An owner can accept in Updates. The domain and its renewal then move to their space.',
          ),
        ),
        noted(note, 'data-domain-message'),
      ),
    ),
  )

export let ownedDomain = (
  path: string,
  domain: Domain,
  apps: DomainApp[],
  checkout = false,
  notes: Notes = {},
) => {
  let app = apps.find((a) => a.eid == domain.destination)
  let destination = domain.destination == 'space'
    ? 'Opens this space'
    : app
    ? app.title || app.slug
    : 'Unattached'
  return h(
    Rows.Item,
    { as: 'li', id: domain.name, 'data-owned-domain': '' },
    h(
      Rows.Main,
      null,
      h(Rows.Name, null, domain.name),
      h(
        Rows.Meta,
        null,
        domain.status || destination,
      ),
      domain.dns && h(Rows.Meta, null, `DNS · ${domain.dns}`),
      domain.certificate &&
        h(Rows.Meta, null, `Certificate · ${domain.certificate}`),
      domain.renewal && h(Rows.Meta, null, domain.renewal),
      domain.chosen && h(Rows.Meta, null, 'Included domain'),
      domain.canChoose && h(
        Rows.Form,
        { method: 'post', action: path, 'data-domain-choose': '' },
        hidden('choose_domain', domain.name),
        h(
          Form.Line,
          null,
          h(Button, {
            type: 'submit',
            'aria-label': `Include renewal for ${domain.name}`,
          }, 'Make included domain'),
        ),
        noted(notes[`choose:${domain.name}`], 'data-domain-message'),
      ),
      checkout && domain.payment && h(
        Rows.Form,
        { method: 'post', action: path },
        hidden('renew_domain', domain.name),
        hidden('cents', domain.payment.cents),
        hidden('expires', domain.payment.expires),
        h(
          Form.Line,
          null,
          h(
            Button,
            { type: 'submit', mod: 'go' },
            `Renew · ${amount(domain.payment.cents)}`,
          ),
        ),
      ),
      checkout && domain.payment && domain.payment.extra > 0 && h(
        Rows.Meta,
        null,
        `Checkout charges ${
          amount(domain.payment.cents + domain.payment.extra)
        } and automatically refunds ${amount(domain.payment.extra)}.`,
      ),
      domain.canTransfer
        ? transfer(path, domain.name, notes[`transfer:${domain.name}`])
        : null,
    ),
    domain.canPoint
      ? h(
        Rows.Form,
        {
          className: 'Rows_Actions',
          method: 'post',
          action: path,
          'data-domain-target': '',
        },
        hidden('point_domain', domain.name),
        h(
          Field,
          {
            choose: true,
            name: 'destination',
            'aria-label': `App for ${domain.name}`,
          },
          option('', 'Unattached', domain.destination),
          domain.destination == 'space' &&
            option('space', 'This space', domain.destination),
          apps.map((a) => option(a.eid, a.title || a.slug, domain.destination)),
        ),
        h(Button, {
          type: 'submit',
          'aria-label': `Save destination for ${domain.name}`,
        }, 'Save'),
        noted(notes[`point:${domain.name}`], 'data-domain-message'),
      )
      : null,
  )
}

export type DomainPage = {
  domains: Domain[]
  search?: string
  found?: DomainOffer[]
  error?: string
  checkout: boolean
  canBuy: boolean
  renewed?: string
  ordered?: string
  /** What came of each press. */
  notes?: Notes
}

export let domainsPage = (
  space: string,
  apps: DomainApp[],
  page: DomainPage,
) => {
  let path = managePath('domains', space)
  return [
    h(
      Card,
      { id: 'owned-domains' },
      title('Your domains'),
      h(Card.Sub, null, DOMAIN_RENEWAL),
      page.renewed && h(
        Notice,
        { role: 'status' },
        `Checkout finished for ${page.renewed}. Renewal updates once payment is confirmed.`,
      ),
      page.ordered &&
        h(
          Notice,
          { role: 'status' },
          `Checkout finished for ${page.ordered}. Registration can take a few minutes.`,
        ),
      page.domains.length
        ? h(
          Rows,
          { as: 'ul' },
          page.domains.map((d) =>
            ownedDomain(path, d, apps, page.checkout, page.notes)
          ),
        )
        : h(Card.Sub, null, 'This space has no domains yet.'),
    ),
    h(
      Card,
      { id: 'domain-search' },
      title('Find a domain'),
      h(
        Card.Sub,
        null,
        'Pay the registrar’s price for the first year, with no markup.',
      ),
      page.canBuy ? null : h(
        Notice,
        null,
        'Buying a domain comes with the Plus plan. ',
        h('a', { href: managePath('billing', space) }, 'Compare plans'),
        '.',
      ),
      page.canBuy && !page.checkout
        ? h(Notice, null, 'Checkout is currently unavailable.')
        : null,
      h(
        Form,
        {
          method: 'get',
          action: path,
          role: 'search',
          'data-domain-search': '',
        },
        h(
          Form.Field,
          null,
          h(Form.Label, { for: 'domain-query' }, 'Domain name or keywords'),
          h(
            Form.Line,
            null,
            h(Field, {
              id: 'domain-query',
              name: 'q',
              type: 'search',
              value: page.search ?? '',
              placeholder: 'e.g. oak meadow or oakmeadow.com',
              autocomplete: 'off',
              maxLength: 253,
              spellcheck: false,
            }),
            h(Button, { type: 'submit' }, 'Search'),
          ),
        ),
      ),
      noted(page.notes?.search, 'data-search-status'),
      h(
        'div',
        { 'data-domain-results': '' },
        page.found
          ? offers(path, page.found, page.canBuy && page.checkout, page.error)
          : null,
      ),
    ),
  ]
}

export let domainRenewals = (space: string, domains: Domain[]) =>
  domains.length
    ? h(
      Card,
      null,
      title('Domain renewals'),
      h(
        Rows,
        { as: 'ul' },
        domains.map((domain) =>
          h(
            Rows.Item,
            { as: 'li' },
            h(
              Rows.Main,
              null,
              h(
                Rows.Name,
                null,
                h('a', {
                  href: `${managePath('domains', space)}#${
                    encodeURIComponent(domain.name)
                  }`,
                }, domain.name),
              ),
              h(Rows.Meta, null, domain.renewal),
            ),
          )
        ),
      ),
    )
    : null
