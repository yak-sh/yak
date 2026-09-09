import type { Sql } from './store/sql.ts'

// READY grants the supervisor permission to open effectsd's writer. Refuse
// that grant if boot left a transaction open or its WAL frames uncheckpointed.
// FULL writes every committed frame without requiring readers to detach (or
// resetting WAL/SHM). In-memory test databases report log=checkpointed=-1.
export let checkpointBoot = (db: Sql, pid: number) => {
  if (db.inTransaction) throw new Error('server boot left a transaction open')
  let result = db.prepare('pragma wal_checkpoint(FULL)').get<{
    busy: number
    log: number
    checkpointed: number
  }>()
  console.error(
    `server pid ${pid} boot wal_checkpoint(FULL) busy=${result?.busy} log=${result?.log} checkpointed=${result?.checkpointed}`,
  )
  if (
    !result || Number(result.busy) != 0 ||
    Number(result.log) != Number(result.checkpointed)
  ) throw new Error('server boot checkpoint incomplete — refusing ready')
}
