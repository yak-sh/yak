// Test-only workerd door: real SQL row counters, no account or live app.
import { worldTick } from './play_world_fixture.ts'
import { idleWake, playMinute } from './play_cost_fixture.ts'
import type { DurableStorage } from '@yaks/durable-object'
import type { Namespace } from './door.ts'

export class PlayCost {
  constructor(
    private ctx: {
      storage: DurableStorage & {
        sql: DurableStorage['sql'] & { databaseSize: number }
        deleteAll(): Promise<void>
        getAlarm(): Promise<number | null>
        deleteAlarm(): Promise<void>
        setAlarm(at: number): Promise<void>
      }
    },
  ) {}
  alarm(): void {}
  async fetch(req: Request): Promise<Response> {
    try {
      return await this.measure(req)
    } catch (e) {
      return Response.json({
        error: String(e),
        stack: e instanceof Error ? e.stack : null,
      }, { status: 500 })
    }
  }
  async measure(req: Request): Promise<Response> {
    if (new URL(req.url).searchParams.has('world')) {
      return Response.json(
        await worldTick(
          this.ctx.storage,
          Number(new URL(req.url).searchParams.get('history') ?? 79000),
        ),
      )
    }
    if (new URL(req.url).searchParams.has('idle')) {
      return Response.json(await idleWake(this.ctx.storage))
    }
    let params = new URL(req.url).searchParams
    let history = Number(params.get('history') ?? 79000)
    if (![100, 79000].includes(history)) {
      return new Response('bad history', { status: 400 })
    }
    let n = Number(new URL(req.url).searchParams.get('players') ?? 2)
    if (![1, 2, 4].includes(n)) {
      return new Response('bad player count', { status: 400 })
    }
    return Response.json(
      await playMinute(
        this.ctx.storage,
        n,
        history,
        params.has('join') ? 0 : 5,
      ),
    )
  }
}
export default {
  fetch(req: Request, env: { PLAY: Namespace }): Promise<Response> {
    return env.PLAY.get(env.PLAY.idFromName(crypto.randomUUID())).fetch(req)
  },
}
