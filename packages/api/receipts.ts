// Successful keyed JSON writes keep their canonical answer in the mutation's
// transaction. The request token is an in-process capability, not client input.
import { after } from '@yaks/fp'
import {
  type Actor,
  type Bundle,
  type Graph,
  type Plugin,
  token,
} from '@yaks/graph'
import { composed } from '@yaks/graph/bundle'
import { derivedEid } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import { published } from './publish.ts'

type Receipt = { digest: string; answer: string }
type Pending = { eid: string; digest: string; empty: boolean }
let pending = new Map<string, Pending>()
let requestKey = '$apiReceipt'

class Replay extends Error {
  constructor(public answer: Bundle[]) {
    super('committed write replay')
    this.name = 'Refused'
  }
}

/** API-owned graph hooks, also loaded by the box's graph facet. */
export let receipts = (): Plugin => {
  let writes = new WeakMap<object, Pending>()
  return {
    name: '@yaks/api/receipts',
    requests: [requestKey],
    // Mandatory scope applies before predicates/aggregates and to subscriptions.
    // Transaction hooks use tx.get directly, not a caller-scoped graph read.
    scope: () => ({ entity: '!apply_receipt' }),
    authorize: (bundles, tx, _error, context) => {
      if (!context?.trusted && bundles.some((b) => 'apply_receipt' in b)) {
        throw new Refused('apply_receipt is server-owned')
      }
      let deleted = bundles.filter((b) => b.$delete).map((b) => b.entity.eid)
      let protect = deleted.length && !context?.trusted
        ? tx.get(deleted, ['apply_receipt'])
        : []
      return after(protect, (rows) => {
        if (rows.some((b) => b.apply_receipt)) {
          throw new Refused('apply_receipt is server-owned')
        }
        let marked = bundles.find((b) => requestKey in b)
        if (!marked) return bundles
        let key = marked[requestKey]
        let held = typeof key == 'string' ? pending.get(key) : undefined
        if (!held || !context?.transaction) {
          throw new Refused('invalid API receipt capability')
        }
        return after(tx.get([held.eid], ['apply_receipt']), (found) => {
          let receipt = found[0]?.apply_receipt as Receipt | undefined
          if (receipt) {
            if (receipt.digest != held.digest) {
              throw new Refused(
                'Idempotency-Key already used with a different body',
              )
            }
            throw new Replay(JSON.parse(receipt.answer))
          }
          writes.set(context.transaction!, held)
          return bundles.flatMap((b) => {
            if (!(requestKey in b)) return [b]
            let { [requestKey]: _key, ...rest } = b
            return held.empty ? [] : [rest as Bundle]
          })
        })
      })
    },
    hooks: {
      commit: (bundles, tx, _error, context) => {
        let held = context?.transaction && writes.get(context.transaction)
        if (!held) return bundles
        let answer = JSON.stringify(
          published((context!.graph as Graph).vocab, composed(bundles)),
        )
        return after(
          tx.patch([{
            entity: { eid: held.eid },
            apply_receipt: { digest: held.digest, answer },
          }]),
          () => bundles,
        )
      },
    },
  }
}

/** Apply with an indefinite, exact-body-bound receipt scoped to the writer.
 * No time expiry: a durable browser outbox may replay after an arbitrary delay. */
export let received = async (
  graph: Graph,
  key: string,
  body: string,
  actor: Actor | null,
  bundles: Bundle[],
  options: Parameters<Graph['apply']>[1],
): Promise<Bundle[]> => {
  if (!graph.vocab.comp('apply_receipt')) {
    throw new Refused('Idempotency-Key needs the @yaks/api receipt vocabulary')
  }
  if (!graph.plugins.some((p) => p.name == '@yaks/api/receipts')) {
    graph.use(receipts())
  }
  if (bundles.some((b) => requestKey in b)) {
    throw new Refused('invalid API receipt capability')
  }
  let capability = crypto.randomUUID()
  pending.set(capability, {
    eid: derivedEid(
      `api receipt|${token([actor?.by ?? null, actor?.via ?? null, key])}`,
    ),
    digest: token(body)!,
    empty: !bundles.length,
  })
  try {
    let marked = bundles.length
      ? bundles.map((b, i) => i ? b : { ...b, [requestKey]: capability })
      : [{
        entity: { eid: crypto.randomUUID() },
        $quiet: true,
        [requestKey]: capability,
      }]
    return await graph.apply(marked, options)
  } catch (error) {
    if (error instanceof Replay) return error.answer
    throw error
  } finally {
    pending.delete(capability)
  }
}
