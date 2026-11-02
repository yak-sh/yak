import type { Bundle } from '@yaks/graph'
import { draftEid } from '@yaks/draft'
import type { Held } from './build.ts'
import { readOperator } from './operator.ts'
import { receive, type Request } from './operator-channels.ts'
import type { operatorStore } from './operator-store.ts'
import { texts, textsEid } from './operator-texts.ts'

let drafts = (bundles: Bundle[], person: string) =>
  bundles.filter((b) => b.draft).map((b) => ({
    entity: { eid: draftEid(person, 'operator') },
    draft: {
      by: person,
      place: 'operator',
      text: String((b.draft as { text?: string })?.text ?? ''),
    },
    typed: { over: String((b.typed as { over?: string })?.over ?? '') },
    $actor: { by: person },
  }))

export let operatorRequest = async (
  store: ReturnType<typeof operatorStore>,
  held: Held,
  path: string,
  args: Record<string, unknown>,
  armed: () => Promise<void> | undefined,
): Promise<Response | null> => {
  let { person, space: spaceId } = held
  let access = held
  if (path == '/operator/draft') {
    let eid = draftEid(person, 'operator')
    if (Array.isArray(args.bundles)) {
      await store.g.apply(drafts(args.bundles as Bundle[], person))
    }
    return Response.json({ bundles: await store.g.get([eid]) })
  }
  if (path == '/operator/texts') {
    if (typeof args.number == 'string') {
      await store.g.apply([{
        ...texts(person, args.number, args.agreed === true),
        $actor: { by: person },
      }])
    }
    let [row] = await store.g.get([textsEid(person)])
    return Response.json(row?.sms_consent ?? null)
  }
  if (path == '/operator/receive') {
    let intake = {
      ...args.request as Request,
      person,
      space: spaceId,
      administrative: access.administrative === true,
    }
    if (typeof args.in_reply_to == 'string') {
      let message = args.in_reply_to.replace(/[<>]/g, '')
      let previous = await store.g.read(
        `(.operator_answer.message_id=${
          JSON.stringify(message)
        }|.mail.message_id=${
          JSON.stringify(message)
        }) ?operator_request ?operator_answer`,
      )
      let same = previous.find((r) =>
        (r.operator_request as { person?: string })?.person == person
      )
      if (same) {
        intake.task = (same.operator_answer as { task?: string })?.task
      }
    }
    let options = args.options as Parameters<typeof receive>[3]
    if (Array.isArray(args.draft)) {
      options = { ...options, also: drafts(args.draft as Bundle[], person) }
    }
    let [old] = options?.id ? await store.g.get([options.id]) : []
    let id = await receive(store, intake, String(args.say ?? ''), options)
    await armed()
    return Response.json({
      request: id,
      ...(options?.also
        ? {
          bundles: await store.g.get(options.also.map((b) => b.entity.eid)),
        }
        : {}),
    }, {
      status: old?.operator_request ? 200 : 202,
    })
  }
  if (path == '/operator/request') {
    let [row] = await store.g.get([String(args.id ?? '')])
    return row?.operator_request
      ? Response.json(row)
      : Response.json({ message: 'That request is missing.' }, { status: 404 })
  }
  if (path == '/operator/messages') {
    let rows = (await store.g.read(
      '.operator_request ?operator_answer ?doc ?delivered ?failed ?bounced .order=-created.at .limit=100',
    )).reverse()
    let failed = await store.g.read('.effect.state=failed')
    return Response.json(rows.map((row) => {
      let run = failed.find((b) =>
        (b.effect as { target?: string }).target == row.entity.eid
      )
      return run
        ? {
          ...row,
          failed: { reason: (run.effect as { error?: string }).error },
        }
        : row
    }))
  }
  if (path == '/operator/read') {
    return Response.json(
      await readOperator(
        store,
        typeof args.task == 'string' ? args.task : undefined,
        args.context === true,
      ),
    )
  }
  return null
}
