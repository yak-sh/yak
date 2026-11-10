import { token } from '@yaks/graph/sha256'
import { allowed } from './store.ts'
import { DocumentInputError, type Preparation } from './document.ts'
import { apply, compare, query } from './orders.ts'
import { InputError } from './refusal.ts'
import { preparationRecovery } from './preparation-errors.ts'
import { renewal } from './preparation-renewal.ts'
import type { Prepared, ServicePorts, Who } from './service.ts'

export type PreparationRow = {
  entity: { eid: string }
  print_preparation: {
    state: Preparation
    run: string
    continuation?: string
    person?: string
    via?: string
    source: string
    seller: string
    authority?: string
  }
  print_document?: { manifest: Prepared }
  print_preparation_failed?: {
    at?: string
    reason: string
    call?: string
    refusal?: boolean
  }
}
let key = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)
  ) {
    throw new InputError('A prepared document UUID is required')
  }
  return value
}
let whoOf = (row: PreparationRow): Who => {
  let { person, via, source, seller, authority } = row.print_preparation
  return { person, via, source, seller, authority }
}
let read = async (ports: ServicePorts, value: unknown) => {
  let [row] = await query<PreparationRow>(
    ports.store,
    `.entity.eid=${key(value)}`,
  )
  if (!row?.print_preparation) {
    throw new InputError('This prepared document is not available')
  }
  return row
}
let owned = async (
  ports: ServicePorts,
  value: unknown,
  who: Who,
): Promise<PreparationRow> => {
  let row = await read(ports, value)
  if (
    !allowed(
      { owner: row.print_preparation.person, via: row.print_preparation.via },
      who,
    ) ||
    row.print_preparation.source !== who.source
  ) throw new InputError('This prepared document is not available')
  if (who.person && !row.print_preparation.person) {
    await compare(ports.store, [{
      entity: row.entity,
      print_preparation: { person: who.person },
      $was: {
        print_preparation: {
          person: null,
          via: token(row.print_preparation.via),
        },
      },
    }])
    return owned(ports, value, who)
  }
  return row
}
let status = (ports: ServicePorts, row: PreparationRow) =>
  row.print_document
    ? {
      ...row.print_document.manifest,
      id: row.entity.eid,
      pending: false,
      preview: ports.preview,
    }
    : {
      id: row.entity.eid,
      pending: !row.print_preparation_failed,
      preview: ports.preview,
      prepared: row.print_preparation.state.pages.length,
      ...(row.print_preparation_failed
        ? {
          error: row.print_preparation_failed.refusal === true
            ? row.print_preparation_failed.reason
            : preparationRecovery,
        }
        : {}),
    }

let continuation = async (ports: ServicePorts, document: string) => {
  let [tool] = await query<{ entity: { eid: string } }>(
    ports.store,
    '.tool.name=print_prepare_step',
  )
  if (!tool) {
    throw new Error('The document preparation command is not installed')
  }
  return {
    entity: { eid: crypto.randomUUID() },
    call: { to: tool.entity.eid, source: document, args: { document } },
  }
}

export let prepareCommand = async (
  ports: ServicePorts,
  args: Record<string, unknown>,
  who: Who,
) => {
  if (args.document) {
    let row = await owned(ports, args.document, who)
    if (row.print_document) return status(ports, row)
    let nextCall = await continuation(ports, row.entity.eid)
    await compare(ports.store, [{
      entity: row.entity,
      print_preparation: {
        ...row.print_preparation,
        continuation: nextCall.entity.eid,
        state: renewal(row.print_preparation.state, args),
        run: crypto.randomUUID(),
        ...(who.authority ? { authority: who.authority } : {}),
      },
      print_preparation_failed: null,
      $was: {
        print_preparation: {
          state: token(row.print_preparation.state),
          run: token(row.print_preparation.run),
          authority: token(row.print_preparation.authority),
        },
      },
    }, nextCall])
    return status(ports, await read(ports, row.entity.eid))
  }
  if (typeof args.title !== 'string' || !args.title.trim()) {
    throw new InputError('Give the document a title')
  }
  let state = await ports.begin(args, who), eid = crypto.randomUUID()
  let nextCall = await continuation(ports, eid)
  await apply(ports.store, [{
    entity: { eid },
    print_preparation: {
      state,
      continuation: nextCall.entity.eid,
      run: crypto.randomUUID(),
      person: who.person,
      via: who.via,
      source: who.source,
      seller: who.seller,
      authority: who.authority,
    },
  }, nextCall])
  return { id: eid, pending: true, preview: ports.preview }
}

export let documentStatus = async (
  ports: ServicePorts,
  args: Record<string, unknown>,
  who: Who,
) => status(ports, await owned(ports, args.document, who))

export let prepareStep = async (ports: ServicePorts, value: unknown) => {
  let row = await read(ports, value), id = row.entity.eid
  if (row.print_document || row.print_preparation_failed) {
    return status(ports, row)
  }
  try {
    await ports.verifyPreparation(whoOf(row))
    let next = await ports.advance(row.print_preparation.state, whoOf(row))
    let guard = {
      print_preparation: {
        state: token(row.print_preparation.state),
        run: token(row.print_preparation.run),
        authority: token(row.print_preparation.authority),
      },
    }
    let nextCall = 'revision' in next ? null : await continuation(ports, id)
    let changes = 'revision' in next
      ? [{
        entity: row.entity,
        print_document: { manifest: next },
        print_preparation: { continuation: null },
        print_preparation_done: { at: ports.now() },
        $was: guard,
      }]
      : [{
        entity: row.entity,
        print_preparation: { state: next, continuation: nextCall!.entity.eid },
        $was: guard,
      }, nextCall!]
    await compare(ports.store, changes)
    return status(ports, await read(ports, id))
  } catch (error) {
    let refusal = error instanceof InputError ||
      error instanceof DocumentInputError
    await compare(ports.store, [{
      entity: row.entity,
      print_preparation_failed: {
        at: ports.now(),
        reason: refusal && error instanceof Error
          ? error.message
          : preparationRecovery,
        refusal,
      },
      $was: {
        print_preparation: {
          state: token(row.print_preparation.state),
          run: token(row.print_preparation.run),
          authority: token(row.print_preparation.authority),
        },
      },
    }])
    if (!refusal) {
      await ports.report(error, {
        order: id,
        location: 'printbound.prepareStep',
      })
      throw error
    }
    return status(ports, await read(ports, id))
  }
}
