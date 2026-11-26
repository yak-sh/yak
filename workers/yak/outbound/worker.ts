// yak-out: the outbound Worker of the kernel's dispatch namespace. Every fetch
// an app's worker makes arrives here instead of leaving, with the CALLER the
// kernel said for that request (dispatch.ts), and goes straight back to the
// kernel's `Outbound` entrypoint, which sends it (outbound.ts). It is its own
// Worker only because a Worker cannot be its own namespace's outbound; it
// holds nothing and decides nothing.

import { outgoing } from '@yaks/platform/app-outbound'

type Env = {
  YAK: Parameters<typeof outgoing>[2]
  CALLER: unknown
}

export default {
  fetch: (req: Request, env: Env): Promise<Response> =>
    outgoing(req, env.CALLER, env.YAK),
}
