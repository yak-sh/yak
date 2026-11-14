// A mail domain set up, read and removed through Resend's Domains API, by
// its name alone.
import { equal, test, throws } from '@yaks/testing'
import { domains } from './domains.ts'
import { mailDomains } from './graph.ts'
import { domainsApi } from './testing.ts'

let made = (token = 'full-access') => {
  let api = domainsApi()
  return { api, mail: domains({ token, fetch: api.fetch }) }
}

let rows = (
  d?: { records: { type: string; name: string; arrived: boolean }[] },
) =>
  d?.records.map((r) =>
    `${r.type} ${r.name} ${r.arrived ? 'arrived' : 'waiting'}`
  )

test('a subdomain is set up for both ways, its records named in full', async () => {
  let { api, mail } = made()
  let domain = await mail.setup('ada.yaks.app')
  equal(domain.name, 'ada.yaks.app')
  equal(rows(domain), [
    'TXT resend._domainkey.ada.yaks.app waiting',
    'MX send.ada.yaks.app waiting',
    'TXT send.ada.yaks.app waiting',
    'CNAME rsend.ada.yaks.app waiting',
    'MX ada.yaks.app waiting',
  ])
  equal(domain.records[4].value, 'receive.forge.rmta.net')
  equal(domain.records[4].priority, 10)
  equal([...api.held.values()][0].capabilities, {
    sending: 'enabled',
    receiving: 'enabled',
  })
  // Setting it up again answers it as it is.
  equal(await mail.setup('ada.yaks.app'), domain)
  equal(api.held.size, 1)
})

test('an apex domain receives at its own name', async () => {
  let { mail } = made()
  let domain = await mail.setup('nottawa.org')
  equal(domain.records.map((r) => r.name), [
    'resend._domainkey.nottawa.org',
    'send.nottawa.org',
    'send.nottawa.org',
    'rsend.nottawa.org',
    'nottawa.org',
  ])
})

test('a domain set up to send only is turned to receive too', async () => {
  let { api, mail } = made()
  await api.fetch('https://api.resend.com/domains', {
    method: 'POST',
    headers: { authorization: 'Bearer full-access' },
    body: JSON.stringify({ name: 'bob.yaks.app' }),
  })
  equal((await mail.setup('bob.yaks.app')).records.length, 5)
  equal([...api.held.values()][0].capabilities.receiving, 'enabled')
})

test('a read checks again only while nothing is being checked', async () => {
  let { api, mail } = made()
  equal(await mail.read('ada.yaks.app'), undefined)
  await mail.setup('ada.yaks.app')
  api.calls.length = 0
  equal(
    rows(await mail.read('ada.yaks.app'))?.[0],
    'TXT resend._domainkey.ada.yaks.app waiting',
  )
  await mail.read('ada.yaks.app')
  equal(api.calls.filter((c) => c.endsWith('/verify')).length, 1)
  api.arrive('ada.yaks.app')
  let read = await mail.read('ada.yaks.app')
  equal(read?.records.every((r) => r.arrived), true)
  equal(api.calls.filter((c) => c.endsWith('/verify')).length, 1)
})

test('removing deletes the domain, and removing it again does nothing', async () => {
  let { api, mail } = made()
  await mail.setup('ada.yaks.app')
  await mail.setup('bob.yaks.app')
  await mail.remove('ada.yaks.app')
  await mail.remove('ada.yaks.app')
  equal([...api.held.values()].map((d) => d.name), ['bob.yaks.app'])
})

test("a refusal says Resend's code and message", async () => {
  await throws(
    () => made('sending-only').mail.setup('ada.yaks.app'),
    'Resend refused to list domains (HTTP 401 restricted_api_key): This API key is restricted to only send emails',
  )
  await throws(
    () => made().mail.setup('*.yaks.app'),
    'Resend refused to set up *.yaks.app (HTTP 422 validation_error): The `name` field is invalid',
  )
})

test('the lent domains wait for their key, read at every call', async () => {
  let api = domainsApi()
  let options: { domains?: { token?: string }; fetch?: typeof api.fetch } = {
    fetch: api.fetch,
  }
  let { resend: lent } = mailDomains(null, options)
  equal(
    lent.waiting?.(),
    'waiting for credentials: Resend mail domains need `domains.token`',
  )
  await throws(() => lent.setup('ada.yaks.app'), lent.waiting!()!)
  options.domains = { token: 'full-access' }
  equal(lent.waiting?.(), undefined)
  equal((await lent.setup('ada.yaks.app')).name, 'ada.yaks.app')
})
