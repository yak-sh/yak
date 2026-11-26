// The `@yaks/admin/graph` facet: the keeper this plugin lends its host,
// `worker`, which puts a key on a Worker script of the account this config
// names as one of its secrets. Its place is `<script>/<NAME>`: an ask
// naming `{via: "worker", at: "yak/BUILD_LOG_TOKEN"}` (@yaks/connections
// `keep`) has a pasted key put on yak's Worker as BUILD_LOG_TOKEN. It puts
// with the admin's own Cloudflare token, `CLOUDFLARE_ADMIN_TOKEN` in this
// box's vault (Workers Scripts write), read when it puts.
import type { Host } from '@yaks/host'
import type { Keeper } from '@yaks/host/keepers'
import { reveal } from '@yaks/secrets'
import { putSecret } from '@yaks/cloudflare/scripts'
import type { Options } from './service.ts'

let TOKEN = 'CLOUDFLARE_ADMIN_TOKEN'

/** `worker`: a Worker script's secret, at `<script>/<NAME>`. */
export let keepers = (
  host: Pick<Host, 'vault'>,
  options: Options = {},
): Record<string, Keeper> => ({
  worker: {
    waiting: () => options.account ? undefined : 'waiting for an account',
    keep: async (at, value) => {
      let [script, name, ...rest] = at.split('/')
      if (!script || !name || rest.length) {
        throw new Error(`a Worker secret is <script>/<NAME>, not ${at}`)
      }
      let token = await reveal(host.vault, TOKEN)
      if (!token) throw new Error(`${TOKEN} is not in this box's vault`)
      await putSecret(
        { CF_ACCOUNT: options.account, token },
        script,
        name,
        value,
      )
    },
  },
})
