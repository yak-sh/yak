// Old contact requests kept a second code digest. Give its directory proof
// the contact's scope before removing that copy; retries preserve the request.
import { line } from '@yaks/query'
import type { Bundle, Comp } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import type { Env } from './env.ts'
import type { OperatorStore } from './operator-store.ts'
import { KERNEL, meta } from './meta.ts'

let moved = async (
  store: OperatorStore,
  env: Env,
  row: Bundle,
) => {
  let c = row.operator_contact as Comp
  if (!c?.code) return
  let [session] = await store.g.get([String(c.session)])
  let space = (session?.operator_session as Comp | undefined)?.space
  if (!space) throw new Error('A pending contact has no conversation space')
  let directory = meta(env)
  let proofs = await directory.query(
    line`.signin.email=${String(c.address)}&.signin.code=${
      String(c.code)
    }&!signin.person`,
  )
  if (proofs.length) {
    await directory.apply(
      proofs.map((proof) => {
        let before = proof.signin as Comp
        return {
          entity: proof.entity,
          signin: {
            person: c.person,
            space,
            tries: Math.max(Number(before.tries ?? 0), Number(c.tries ?? 0)),
          },
          $was: { signin: { code: token(c.code), person: token(undefined) } },
        }
      }),
      KERNEL,
    )
  }
  await store.g.apply([{
    entity: row.entity,
    operator_contact: { code: null, tries: null },
    $was: { operator_contact: { code: token(c.code) } },
  }], { trusted: true })
}

export let moveContact = async (
  store: OperatorStore,
  env: Env,
  row: Bundle,
) => {
  for (;;) {
    try {
      return await moved(store, env, row)
    } catch (error) {
      if (!(error instanceof Stale)) throw error
      let [current] = await store.g.get([row.entity.eid])
      if (!current) return
      row = current
    }
  }
}

/** One bounded alarm batch, also used by a contact read before it confirms. */
export let contactBackfill = async (store: OperatorStore, env: Env) => {
  if (store.waiting?.()) return true
  let rows = await store.g.read('.operator_contact.code&.limit=50')
  for (let row of rows) {
    if (store.waiting?.()) return true
    await moveContact(store, env, row)
  }
  return rows.length == 50
}
