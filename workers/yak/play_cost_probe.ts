// Test-only workerd door: real SQL row counters, no account or live app.
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
    if (new URL(req.url).searchParams.has('idle')) {
      return Response.json(await idleWake(this.ctx.storage))
    }
    let n = Number(new URL(req.url).searchParams.get('players') ?? 2)
    if (![1, 2, 4].includes(n)) {
      return new Response('bad player count', { status: 400 })
    }
    return Response.json(await playMinute(this.ctx.storage, n))
  }
}
export default {
  fetch(req: Request, env: { PLAY: Namespace }): Promise<Response> {
    return env.PLAY.get(env.PLAY.idFromName(crypto.randomUUID())).fetch(req)
  },
}
