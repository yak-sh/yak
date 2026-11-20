// The sealed link an app_preview answer about a draft stands for, at the page
// its short link names: what the preview's browser opens, needing no sign-in.
// The short link answered needs one (preview.ts `short`).
import { route } from '@yaks/platform/routes'
import { sealed } from './preview.ts'
import type { Ctx } from './tool.ts'

export let sealedAt = async (
  ctx: Ctx,
  out: { value?: Record<string, unknown> },
) => {
  let short = new URL(String(out.value!.url))
  let { space: slug, app: name, path } = route(
    short.hostname,
    short.pathname,
    ctx.env,
  )
  let space = (await ctx.dir.space(slug!))!
  let app = (await ctx.dir.app(space, name!))!
  let rest = path.split('/').slice(2).join('/')
  return (await sealed(ctx, space, app, String(out.value!.draft))).at + rest
}
