import { define } from '../../utils.ts'
import { db, setView } from '../../db.ts'

// The first write path: a tab button POSTs the lens it wants for this card,
// then we bounce back to the canvas. No client JS — the page IS the state.
export let handler = define.handlers({
  async POST(ctx) {
    let form = await ctx.req.formData()
    let view = form.get('view')
    if (typeof view == 'string') setView(db, ctx.params.card, view)
    return new Response(null, { status: 303, headers: { location: '/' } })
  },
})
