// The tracker Worker's mail providers: the plugins its letters leave through
// (mail.ts) and whose notices about them it reads (worker.ts). An option names
// the Worker's env it is read from when accessed: `{"secret": NAME}` a secret
// or var, `{"binding": NAME}` a binding the Worker holds. The Worker never
// names a provider anywhere else.
import type { Config } from '@yaks/host/config'
import type { GraphFacet } from '@yaks/host'
import * as cloudflare from '@yaks/cloudflare-mail/graph'
import * as resend from '@yaks/resend/graph'

export let post: Config & {
  /** the sender letters take where the deploy's MAIL_VIA names none */
  via: string
} = {
  via: 'binding',
  plugins: [
    { use: '@yaks/cloudflare-mail', with: { binding: { binding: 'MAIL' } } },
    {
      use: '@yaks/resend',
      with: {
        token: { secret: 'RESEND_TOKEN' },
        base: { secret: 'RESEND_API' },
        fetch: { binding: 'MAIL_FETCH' },
        receipts: { secret: { secret: 'RESEND_WEBHOOK_SECRET' } },
      },
    },
  ],
}

/** The graph facet of each plugin `post` names: a Worker holds only the
 * modules it was bundled with. */
export let facets: Record<string, GraphFacet> = {
  '@yaks/cloudflare-mail': cloudflare,
  '@yaks/resend': resend,
}
