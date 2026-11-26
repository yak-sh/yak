import { type Clock, system, within } from '@yaks/fp'
import {
  fenceRegionalCopies,
  REGIONAL_LEASE_MS,
  regionalAnswerFits,
  type RegionalLease,
  regionalLeaseCurrent,
} from './regional-serving-copy.ts'

/** Private headers between the gateway, Site and the directory. */
export let EDGE_REGION = 'x-yak-edge-region'
export let PAGE_ROUTE = 'x-yak-page-route'

export type Region = 'weur' | 'apac' | 'oc'
export let regionOf = (value: unknown): Region | undefined =>
  value === 'weur' || value === 'apac' || value === 'oc' ? value : undefined

export let edgeRegion = (request: Request): Region | undefined => {
  let { cf } = request as Request & { cf?: { continent?: string } }
  let continent = cf?.continent
  return continent === 'EU'
    ? 'weur'
    : continent === 'AS'
    ? 'apac'
    : continent === 'OC'
    ? 'oc'
    : undefined
}

/** Restrict a deployment's grants and reads to named spaces when configured. */
export let regionalSpace = (spaces: string | undefined, space: string) =>
  spaces === undefined || spaces.split(',').some((s) => s.trim() === space)

export type RegionalAnswer = Pick<RegionalLease, 'revision' | 'until'> & {
  body: string
}
export type RegionalDoor = {
  regionalRead(key: string): Promise<RegionalAnswer | null>
  regionalPublish(
    lease: RegionalLease,
    key: string,
    body: string,
  ): Promise<boolean>
  regionalInvalidate(epoch: number): Promise<void>
}

/** A reachable copy can be filled on a miss. An outage does not extend its lease. */
export let regionalLook = async (
  read: () => Promise<RegionalAnswer | null>,
  clock: Clock = system,
) => {
  let heard = await within(read().then((answer) => ({ answer })), 120, clock)
  let answer = heard?.answer
  return {
    reachable: heard !== null,
    answer: answer && regionalLeaseCurrent(answer.until, clock.now())
      ? answer
      : null,
  }
}

export type RegionalJournal = {
  epoch: number
  until: Partial<Record<Region, number>>
}

type AuthorityOptions = {
  read(): RegionalJournal | undefined
  /** Durably record the journal before any grant leaves the authority. */
  write(journal: RegionalJournal): void
  committed(): number
  door(region: Region): RegionalDoor
  clock?: Clock
  failed?(error: unknown, region: Region): void
}

/** The sole issuer. Holds cover every write of a regional route's source. */
export class RegionalAuthority {
  #holds = new Set<symbol>()

  constructor(private readonly options: AuthorityOptions) {}

  hold() {
    let turn = Symbol()
    this.#holds.add(turn)
    return () => void this.#holds.delete(turn)
  }

  async publish(region: Region, revision: number, key: string, body: string) {
    if (
      this.#holds.size || revision !== this.options.committed() ||
      !regionalAnswerFits(key, body)
    ) return false
    let { now } = this.options.clock ?? system
    let was = this.options.read() ?? { epoch: 0, until: {} }
    let until = was.until[region] ?? 0
    // Fills within the same window share a deadline. They cannot continually
    // push the start of an outage's drain forward.
    if (!regionalLeaseCurrent(until, now())) {
      until = now() + REGIONAL_LEASE_MS
      this.options.write({
        epoch: was.epoch,
        until: { ...was.until, [region]: until },
      })
    }
    return await this.options.door(region).regionalPublish(
      { epoch: was.epoch, revision, until },
      key,
      body,
    )
  }

  async fence() {
    let was = this.options.read()
    if (!was || !Object.keys(was.until).length) return
    let epoch = was.epoch + 1
    // Keep the deadlines until every grant is revoked or expires. A restart
    // between these writes must drain the same outstanding grants.
    this.options.write({ epoch, until: was.until })
    let regions = Object.keys(was.until) as Region[]
    let failures = new Set<Region>()
    let copies = regions.map((region) => ({
      until: was.until[region]!,
      invalidate: async () => {
        try {
          await this.options.door(region).regionalInvalidate(epoch)
        } catch (e) {
          failures.add(region)
          this.options.failed?.(e, region)
          throw e
        }
      },
    }))
    let revoked = await fenceRegionalCopies(copies, this.options.clock)
    revoked.forEach((ok, index) => {
      if (!ok && !failures.has(regions[index])) {
        this.options.failed?.(
          new Error(
            'Regional route lease expired before invalidation was confirmed',
          ),
          regions[index],
        )
      }
    })
    this.options.write({ epoch, until: {} })
  }
}
