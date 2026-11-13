// The catalog: a broker's providers as listings, merged with the built
// integrations direct first, searched, and written as an integration once
// someone connects one.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Listing, listingOf, logoSources, nango } from './brokers.ts'
import {
  adopted,
  catalogue,
  find,
  initialLogo,
  isSvg,
  kinds,
} from './catalog.ts'
import { install, type Integration } from './integrations.ts'
import { integrationEid } from './identity.ts'

let provider = (name: string, auth_mode: string, more = {}) => ({
  name,
  display_name: name.toUpperCase(),
  logo_url: `https://logos.example/${name}.svg`,
  categories: ['crm', 'popular'],
  auth_mode,
  proxy: { base_url: `https://api.${name}.example/v1` },
  ...more,
})

test('a Nango provider is a listing only where a connection here can use it', () => {
  assertEquals(listingOf(provider('hub', 'OAUTH2')), {
    name: 'hub',
    title: 'HUB',
    logo: 'https://logos.example/hub.svg',
    categories: ['crm'],
    hosts: ['api.hub.example'],
    connects: 'signin',
    popular: true,
  })
  assertEquals(listingOf(provider('cc', 'OAUTH2_CC'))?.connects, 'client')
  assertEquals(listingOf(provider('tba', 'TBA')), undefined)
  // Hosts the account names are not known yet.
  assertEquals(
    listingOf(
      provider('sub', 'API_KEY', {
        proxy: { base_url: 'https://${connectionConfig.subdomain}.sub.io' },
      }),
    )?.hosts,
    [],
  )
  // A key of several fields says each, and what each is.
  let basic = listingOf(provider('bas', 'BASIC', {
    credentials: {
      username: { title: 'Username', description: 'Your login' },
      apiSecret: { title: 'API Secret' },
    },
  }))
  assertEquals(basic?.fields, [
    { name: 'username', label: 'Username', shown: true },
    { name: 'api_secret', label: 'API Secret' },
  ])
  assertEquals(basic?.instructions, '- **Username**: Your login')
})

let listing = (name: string, more: Partial<Listing> = {}): Listing => ({
  name,
  title: name.charAt(0).toUpperCase() + name.slice(1),
  logo: `https://logos.example/${name}.svg`,
  categories: ['productivity'],
  hosts: [`api.${name}.example`],
  connects: 'signin',
  ...more,
})

let built: Integration[] = [
  {
    name: 'gmail',
    title: 'Gmail',
    hosts: ['gmail.googleapis.com'],
    broker: { name: 'nango', integration: 'google-mail' },
    built: true,
  },
  {
    name: 'openai',
    title: 'OpenAI',
    hosts: ['api.openai.com'],
    logo: '<svg/>',
    built: true,
  },
  { name: 'voipms', title: 'voip.ms', hosts: ['voip.ms'], built: true },
  {
    name: 'beta',
    title: 'Beta',
    hosts: ['beta.example'],
    testing: true,
    built: true,
  },
]

test('the catalog is direct first: a built integration stands in for its listing', () => {
  let all = catalogue(built, [
    listing('google-mail', {
      title: 'Gmail',
      popular: true,
      categories: ['communication'],
    }),
    listing('openai', { categories: ['dev-tools'] }),
    listing('hubspot', { categories: ['crm'], popular: true }),
    listing('abyssale', { connects: 'key', instructions: '- **Key**: yours' }),
    listing('subbed', { hosts: [] }),
  ], 'nango')
  assertEquals(all.map((o) => o.name), [
    'abyssale',
    'gmail',
    'hubspot',
    'openai',
    'voipms',
  ])
  let at = Object.fromEntries(all.map((o) => [o.name, o]))
  // The built one takes its listing's kinds, and a logo only where it has none.
  assertEquals(at.gmail.categories, ['communication'])
  assertEquals(at.gmail.image, 'https://logos.example/google-mail.svg')
  assertEquals(at.openai.image, undefined)
  // A built one is featured, and a listing where the broker features it.
  assertEquals(all.filter((o) => o.featured).map((o) => o.name), [
    'gmail',
    'hubspot',
    'openai',
    'voipms',
  ])
  // Signed in to through the broker, or a key kept here and never brokered.
  assertEquals(at.hubspot.broker, { name: 'nango', integration: 'hubspot' })
  assertEquals(at.abyssale.broker, undefined)
  assertEquals(at.abyssale.instructions, '- **Key**: yours')
  assertEquals(at.hubspot.tagline, 'CRM')
  // Written once connected: built, its logo the SVG fetched, and never
  // featured, which is the platform's mark rather than the row's.
  assertEquals(adopted(at.hubspot, '<svg/>'), {
    name: 'hubspot',
    title: 'Hubspot',
    tagline: 'CRM',
    connects: 'signin',
    categories: ['crm'],
    image: 'https://logos.example/hubspot.svg',
    hosts: ['api.hubspot.example'],
    broker: { name: 'nango', integration: 'hubspot' },
    logo: '<svg/>',
    built: true,
  })
})

test('search ranks a title that starts with the words first, then featured', () => {
  let all = catalogue([], [
    listing('salesforce', { title: 'Salesforce', categories: ['crm'] }),
    listing('sage', { title: 'Sage Intacct', categories: ['accounting'] }),
    listing('pipe', { title: 'Pipedrive', categories: ['crm'], popular: true }),
    listing('acme', { title: 'Acme Sales Tools', categories: ['marketing'] }),
  ], 'nango')
  let names = (words: string) => find(all, words).map((o) => o.name)
  assertEquals(names('sa'), ['sage', 'salesforce', 'acme'])
  assertEquals(names('crm'), ['pipe', 'salesforce'])
  assertEquals(names('sales crm'), ['salesforce'])
  assertEquals(names('Hiring'), [])
  assertEquals(names('').length, 4)
  assertEquals(kinds(all), ['crm', 'accounting', 'marketing'])
})

test('enabling a service at Nango makes its integration once, through Nango’s own app for a sign-in', async () => {
  let asked: string[] = []
  let made = new Set(['ready'])
  let fetch = (url: RequestInfo | URL, init?: RequestInit) => {
    let u = new URL(String(url))
    asked.push(
      `${init?.method ?? 'GET'} ${u.pathname} ${init?.body ?? ''}`.trim(),
    )
    let name = u.pathname.split('/')[2]
    let status = init?.method == 'POST' ? 200 : made.has(name) ? 200 : 404
    return Promise.resolve(Response.json({ data: {} }, { status }))
  }
  let n = nango('nk', fetch as typeof globalThis.fetch)
  await n.enable('ready', 'signin')
  await n.enable('hub', 'signin')
  await n.enable('cc', 'client')
  assertEquals(asked, [
    'GET /integrations/ready',
    'GET /integrations/hub',
    'POST /integrations {"unique_key":"hub","provider":"hub","credentials":{"type":"NANGO_MANAGED"}}',
    'GET /integrations/cc',
    'POST /integrations {"unique_key":"cc","provider":"cc"}',
  ])
})

test("a Nango logo is also fetched from Nango's repository", () => {
  assertEquals(
    logoSources('https://app.nango.dev/images/template-logos/hubspot.svg'),
    [
      'https://app.nango.dev/images/template-logos/hubspot.svg',
      'https://raw.githubusercontent.com/NangoHQ/nango/master/packages/webapp/public/images/template-logos/hubspot.svg',
    ],
  )
})

test('a service with no logo wears its initial, as an SVG document', () => {
  for (
    let [title, letter] of [['hubSpot', 'H'], [' é', 'É'], ['<x>', '&lt;'], [
      '',
      '?',
    ]]
  ) {
    let svg = initialLogo(title)
    assertEquals([isSvg(svg), svg.includes(`>${letter}</text>`)], [true, true])
  }
})

test('graph catalog details survive broker refresh and adoption without exposing custom rows', () => {
  let described: Integration = {
    name: 'hub',
    title: 'Hub',
    hosts: ['api.hub.example'],
    tagline: 'Customer relationships',
    description: 'A CRM for teams.',
    details: 'Reads contacts with the account permissions.',
    docs: 'https://hub.example/docs',
    site: 'https://hub.example',
    categories: ['crm'],
    image: 'https://hub.example/logo.svg',
    broker: { name: 'nango', integration: 'hub' },
    connects: 'signin',
  }
  let own = { ...described, name: 'private', owner: 'space' }
  let [offer] = catalogue([described, own], [
    listing('hub', { title: 'Changed title', categories: ['other'] }),
  ], 'nango')
  assertEquals(offer.title, 'Hub')
  assertEquals(offer.categories, ['crm'])
  assertEquals(offer.details, described.details)
  assertEquals(offer.built, undefined)
  let installed = adopted(offer)
  assertEquals(installed.description, described.description)
  assertEquals(installed.docs, described.docs)
  assertEquals(installed.built, true)
  assertEquals(catalogue([described, own], [], 'nango').map((o) => o.name), [
    'hub',
  ])
})

test('seed installation updates operational fields and preserves graph descriptions', async () => {
  let seed: Integration = {
    name: 'hub',
    hosts: ['api.new.example'],
    title: 'Hub',
  }
  let integration = {
    ...seed,
    hosts: ['api.old.example'],
    token: 'https://old.example/token',
    tagline: 'CRM for teams',
    description: 'A shared customer workspace.',
    details: 'Reads contacts.',
    docs: 'https://hub.example/docs',
    built: true,
  }
  let entity = { eid: integrationEid('hub') }
  let [patch] = await install(() => [{ entity, integration }], [seed])
  let updated = {
    ...integration,
    ...(patch.integration as Partial<Integration>),
  } as Integration
  assertEquals(updated.hosts, seed.hosts)
  assertEquals(updated.token, null)
  assertEquals(updated.description, integration.description)
  assertEquals(updated.tagline, integration.tagline)
  assertEquals(updated.details, integration.details)
  assertEquals(updated.docs, integration.docs)
  assertEquals(
    await install(() => [{ entity, integration: updated }], [seed]),
    [],
  )
})
