// store_attach (attached.ts, D-469): the owner's verb that attaches one app
// to another app's store, writing the `uses` link the serving path reads.
import { link, unlink } from '@yaks/edge'
import { USES } from '@yaks/connections/identity'
import { addressOf, bindingOf, comp, held } from './attached.ts'
import { ctxOf } from './connections.ts'
import { APP, inApp, refuse, SPACE, str, text } from './tool.ts'
import { type Row, worded } from './tool-words.ts'

let NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

let ROWS: Row[] = [{
  name: 'store_attach',
  role: 'owner',
  destructive: false,
  idempotent: true,
  input: {
    type: 'object',
    properties: {
      space: SPACE,
      app: APP,
      store: str('the slug of the app in the same space whose store it uses'),
      binding: str(
        'the name the app reads the store’s address by, env.NAME in ' +
          'worker.js and from ./api/env in a page; omit for the store’s ' +
          'slug in capitals',
      ),
      detach: {
        type: 'boolean',
        description: 'true takes the store away from the app again',
      },
    },
    required: ['app', 'store'],
  },
  run: async (ctx, args) => {
    let { space, app, who } = await inApp(ctx, args)
    let { graph } = ctxOf(ctx.env, who)
    let slug = text(args.store, 'store')
    let store = await ctx.dir.app(space, slug)
    if (!store) {
      throw refuse('missing', `${space.slug} has no app ${slug}`)
    }
    if (store.eid == app.eid) {
      throw refuse('conflict', 'An app already reaches its own store')
    }
    let name = `${space.slug}/${app.slug}`
    let [was] = await held(ctx.env, app.eid, store.eid)
    if (args.detach === true) {
      if (was) await graph.apply([unlink(app.eid, USES, store.eid)])
      return { space, text: `${name} no longer uses the store of ${slug}.` }
    }
    let binding = args.binding == null
      ? String(comp(was, USES).binding ?? bindingOf(slug))
      : text(args.binding, 'binding')
    if (!NAME.test(binding)) {
      throw refuse('binding', 'The binding must be a name code can read')
    }
    await graph.apply([{
      ...link(app.eid, USES, store.eid),
      [USES]: { binding },
    }])
    return {
      space,
      text: `${name} uses the store of ${slug}, at ${addressOf(slug)}, ` +
        `read as env.${binding}: store(env.${binding}) in a page. ` +
        'It reads and writes there as whoever uses it, with their own role ' +
        `in ${slug}, sandboxed or not.`,
    }
  },
}]

export let attachTools = ROWS.map(worded)
