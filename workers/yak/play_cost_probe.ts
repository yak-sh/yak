import { coldMessages } from './cold_message_fixture.ts'
import {
  descriptorGatherCost,
  entryPageCost,
} from './entry_page_cost_fixture.ts'
// Test-only workerd door: real SQL row counters, no account or live app.
import { directoryCost, queryCost } from './query_cost_fixture.ts'
import { writeCost } from './write_cost_fixture.ts'
import { productionGap } from './production_gap_fixture.ts'
import { worldTick } from './play_world_fixture.ts'
import { deployCost } from './deploy_cost_fixture.ts'
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
    if (new URL(req.url).searchParams.has('descriptorgather')) {
      return Response.json(descriptorGatherCost(this.ctx.storage))
    }
    if (new URL(req.url).searchParams.has('coldmessages')) {
      return Response.json(
        await coldMessages(
          this.ctx.storage,
          Number(new URL(req.url).searchParams.get('outputs') ?? 10),
        ),
      )
    }
    if (new URL(req.url).searchParams.has('entrypage')) {
      return Response.json(entryPageCost(this.ctx.storage))
    }
    if (new URL(req.url).searchParams.has('directory-query')) {
      return Response.json(await directoryCost(this.ctx.storage))
    }
    if (new URL(req.url).searchParams.has('query')) {
      return Response.json(
        await queryCost(
          this.ctx.storage,
          new URL(req.url).searchParams.has('screened'),
          new URL(req.url).searchParams.has('stale'),
        ),
      )
    }
    if (new URL(req.url).searchParams.has('deploy')) {
      let history = Number(new URL(req.url).searchParams.get('history') ?? 100)
      if (![100, 5000].includes(history)) {
        return new Response('bad history', { status: 400 })
      }
      return Response.json(await deployCost(this.ctx.storage, history))
    }
    if (new URL(req.url).searchParams.has('writes')) {
      return Response.json(await writeCost(this.ctx.storage))
    }
    if (new URL(req.url).searchParams.has('production')) {
      let q = new URL(req.url).searchParams
      return Response.json(
        await productionGap(
          this.ctx.storage,
          Number(q.get('history') ?? 79000),
          Number(q.get('villagers') ?? 6),
          Number(q.get('turns') ?? 16),
          Number(q.get('outputs') ?? 0),
          q.has('cold'),
          q.has('unsequenced'),
        ),
      )
    }
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
        params.has('join') ? 0 : Number(params.get('minutes') ?? 1),
      ),
    )
  }
}
export default {
  fetch(req: Request, env: { PLAY: Namespace }): Promise<Response> {
    return env.PLAY.get(env.PLAY.idFromName(crypto.randomUUID())).fetch(req)
  },
}
