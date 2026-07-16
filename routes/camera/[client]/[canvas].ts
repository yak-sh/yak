import { define } from '../../../utils.ts'
import { camera, db } from '../../../db.ts'

// The camera restore read: a client's camera over one canvas as JSON, null
// before its first look.
export let handler = define.handlers({
  GET(ctx) {
    return Response.json(
      camera(db, ctx.params.client, ctx.params.canvas) ?? null,
    )
  },
})
