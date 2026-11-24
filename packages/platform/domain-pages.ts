import { h } from 'preact'
import { Button, Card, Field, Form, More, Notice, Rows } from '@yaks/ui/parts'
import { managePath } from './routes.ts'

export type Domain = {
  name: string
  destination: string
  dns?: string
  certificate?: string
  renewal?: string
  price?: string
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
                class: 'Rows_Actions',
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

let transfer = (path: string, name: string) =>
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
        h(Notice, { role: 'status', 'data-domain-message': '', hidden: true }),
      ),
    ),
  )

export let ownedDomain = (
  path: string,
  domain: Domain,
  apps: DomainApp[],
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
      domain.price && h(Rows.Meta, null, domain.price),
      domain.canTransfer ? transfer(path, domain.name) : null,
    ),
    domain.canPoint
      ? h(
        Rows.Form,
        {
          class: 'Rows_Actions',
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
        h(Notice, { role: 'status', 'data-domain-message': '', hidden: true }),
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
  included: boolean
  ordered?: string
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
          page.domains.map((d) => ownedDomain(path, d, apps)),
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
        'Pay the registrar’s price for the first year. There’s no markup. ' +
          'Yearly renewals are included while your space stays on a paid plan.',
      ),
      page.included ? null : h(
        Notice,
        null,
        'Buying a domain comes with the Plus plan. ',
        h('a', { href: managePath('billing', space) }, 'Compare plans'),
        '.',
      ),
      page.included && !page.checkout
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
      h(Notice, { role: 'status', 'data-search-status': '', hidden: true }),
      h(
        'div',
        { 'data-domain-results': '' },
        page.found ? offers(path, page.found, page.checkout, page.error) : null,
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
