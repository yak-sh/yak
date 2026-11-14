// The Worker sets up, reads and removes a mail domain naming only its name;
// config.ts names the provider and the key.
import { equal, test } from '@yaks/testing'
import { domainsApi } from '../../packages/resend/testing.ts'
import { mailDomains } from './mail-domains.ts'

test('a mail domain is set up, read and removed through the configured provider', async () => {
  let api = domainsApi('domains-key')
  let env: Record<string, unknown> = { MAIL_FETCH: api.fetch }
  let mail = await mailDomains(env)
  equal(
    mail.waiting?.(),
    'waiting for credentials: Resend mail domains need `domains.token`',
  )
  env.RESEND_DOMAINS_TOKEN = 'domains-key'
  equal(mail.waiting?.(), undefined)
  let set = await mail.setup('ada.yaks.app')
  equal(set.records.map((r) => `${r.type} ${r.name}`), [
    'TXT resend._domainkey.ada.yaks.app',
    'MX send.ada.yaks.app',
    'TXT send.ada.yaks.app',
    'CNAME rsend.ada.yaks.app',
    'MX ada.yaks.app',
  ])
  api.arrive('ada.yaks.app')
  equal(
    (await mail.read('ada.yaks.app'))?.records.every((r) => r.arrived),
    true,
  )
  await mail.remove('ada.yaks.app')
  equal(await mail.read('ada.yaks.app'), undefined)
  equal(api.calls[0], 'GET /domains')
})
