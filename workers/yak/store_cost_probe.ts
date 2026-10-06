// Test-only workerd door: real Store applies and SQL row counters.
import { fightUpdate } from './fight_update_fixture.ts'
import { reconnect } from './reconnect_fixture.ts'
import { storeCost } from './store_cost_fixture.ts'
import type { Namespace } from './door.ts'

export class StoreCost {
  constructor(private ctx: { storage: Parameters<typeof storeCost>[0] }) {}
  alarm(): void {}
  async fetch(req: Request): Promise<Response> {
    if (new URL(req.url).searchParams.get('kind') == 'fight-update') {
      return Response.json(await fightUpdate(this.ctx.storage))
    }
    if (new URL(req.url).searchParams.get('kind') == 'reconnect') {
      return Response.json(await reconnect(this.ctx.storage))
    }
    return Response.json(
      await storeCost(
        this.ctx.storage,
        new URL(req.url).searchParams.get('kind') ?? 'directory',
      ),
    )
  }
}
export default {
  fetch(req: Request, env: { COST: Namespace }): Promise<Response> {
    return env.COST.get(env.COST.idFromName(crypto.randomUUID())).fetch(req)
  },
}
