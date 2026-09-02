// The connector part (D-32318 §Code, build, deploy): the MCP door at `/mcp`
// and the platform API under `/api/*` at the apex. T-32329 fills this
// handler in — the graph tier scoped to the caller's space, app_new /
// app_files / app_commit / app_deploy, unseen errors on every reply. Until
// then it answers a JSON 404 that says so.
import type { Env } from './env.ts'

export let fetch = (_req: Request, _env: Env): Promise<Response> =>
  Promise.resolve(
    Response.json({ error: { code: 'not_here_yet' } }, { status: 404 }),
  )
