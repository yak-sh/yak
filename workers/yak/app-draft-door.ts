import type { Bundle } from '@yaks/graph'
import type { DraftAction } from '@yaks/platform/app-canvas'
import { issued } from './preview.ts'
import { type Ctx, inApp, refuse } from './tool.ts'
import { call, discardOpen } from './tools.ts'
import { openDraft } from './written.ts'

let draftIn = async (ctx: Ctx, app: string, draft: string) => {
  let at = await ctx.dir.appAt(app)
  if (!at) throw refuse('missing', 'This app is unavailable.')
  let found = await inApp(ctx, { space: at.space.slug, app }, true)
  return { ...found, of: await openDraft(ctx.dir, found.app, draft) }
}

export let previewDraft = async (ctx: Ctx, q: URLSearchParams) => {
  let { space, app, of } = await draftIn(
    ctx,
    q.get('app') ?? '',
    q.get('draft') ?? '',
  )
  let link = await issued(ctx, space, app, of.eid)
  return new Response(null, {
    status: 303,
    headers: { location: link.at, 'cache-control': 'private, no-store' },
  })
}

export let actOnDraft = async (ctx: Ctx, bundle: Bundle) => {
  let { app, draft, act } = bundle.appDraftAct as Partial<DraftAction>
  if (
    typeof app != 'string' || typeof draft != 'string' ||
    !app || !draft || (act != 'release' && act != 'discard')
  ) {
    throw refuse('arguments', 'Choose an open draft to release or discard.')
  }
  let found = await draftIn(ctx, app, draft)
  let said: string
  if (act == 'discard') {
    await discardOpen(ctx, found.space, found.app, found.who, found.of)
    said = 'Draft discarded.'
  } else {
    let out = await call(ctx, 'app_deploy', {
      space: found.space.slug,
      app,
      draft,
    })
    said = out.value?.deployed ? `Released v${out.value.version}.` : out.text
  }
  return [{ entity: bundle.entity, appDraftActed: { said } }]
}
