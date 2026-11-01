// yak-front's runtime entry; everything a test reaches is in front.ts.
import { type Lent, serve } from './front.ts'
import type { FrontEnv } from './front.ts'

export default {
  fetch: (req: Request, env: FrontEnv, ctx: Lent) => serve(req, env, ctx),
}
