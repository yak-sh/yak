import { ask, type Keyed } from './mod.ts'

let NAME = 'yaks.app monthly gifts'
let CANCEL = { enabled: true, mode: 'immediately', proration_behavior: 'none' }

let configuration = async (options: Keyed, account: string) => {
  let next: string | undefined
  do {
    let params = new URLSearchParams({ active: 'true', limit: '100' })
    if (next) params.set('starting_after', next)
    let page = await ask(
      options,
      `/v1/billing_portal/configurations?${params}`,
      undefined,
      account,
    ) as {
      data: { id: string; metadata?: { yaks?: string } }[]
      has_more: boolean
    }
    let held = page.data.find((c) => c.metadata?.yaks == NAME)
    if (held) return held.id
    next = page.has_more ? page.data.at(-1)?.id : undefined
  } while (next)
  let made = await ask(
    options,
    '/v1/billing_portal/configurations',
    {
      name: NAME,
      metadata: { yaks: NAME },
      features: { subscription_cancel: CANCEL },
    },
    account,
    'POST',
    'yaks-gifts-portal-v1',
  )
  if (!made.id) throw new Error('stripe made a portal configuration with no id')
  return String(made.id)
}

export let giftPortal = async (
  options: Keyed,
  account: string,
  payer: string,
  subscription: string,
  back: string,
) => {
  if (!account) throw new Error('a gift portal requires a connected account')
  let portal = await ask(options, '/v1/billing_portal/sessions', {
    customer: payer,
    return_url: back,
    configuration: await configuration(options, account),
    flow_data: {
      type: 'subscription_cancel',
      subscription_cancel: { subscription },
      after_completion: {
        type: 'redirect',
        redirect: { return_url: back },
      },
    },
  }, account)
  if (!portal.url) throw new Error('stripe made a portal session with no url')
  return String(portal.url)
}
