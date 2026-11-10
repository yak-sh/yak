// Set up deterministic PrintBound and CrayonBloom previews through app doors.
import { fileURLToPath } from 'node:url'
import { compose } from '@yaks/cli/host'
import { configPath, read as configAt } from '@yaks/cli/config'
import { type Bundle, mint } from '@yaks/graph'
import { type Account, account } from '../packages/admin/account.ts'
import {
  claimsOf,
  type Reply,
  rpc,
  saidBy,
  storeApply,
  storeQuery,
  storeUpload,
} from '../packages/admin/api.ts'
import { push, read } from '../packages/admin/push.ts'

type Target = { at: string; id: string; as: string; buyer?: string }
type Config = {
  font: string
  assets?: string
  printer: Target
  coloring: Target
}
type Selected = Target & Account & { buyer: string }

let local = (name: string) =>
  fileURLToPath(new URL('../apps/' + name, import.meta.url))
let tool = async (at: Selected, name: string, args: Record<string, unknown>) =>
  saidBy(await rpc(at.bearer)('tools/call', { name, arguments: args }) as Reply)
let target = ({ at }: Target) => {
  let [space, app] = at.split('/')
  return { space, app }
}
let configure = async (
  at: Selected,
  component: string,
  fields: Record<string, unknown>,
) => {
  let rows = await storeQuery(at.bearer, at.at, [
    `.${component}`,
    '.limit=1',
  ]) as Bundle[]
  await storeApply(at.bearer, at.at, [{
    entity: { eid: rows[0]?.entity.eid ?? mint() },
    [component]: fields,
  }])
}
let install = async (at: Selected, source: string, assets?: string) => {
  let files = await read(local(source))
  if (assets) files.push(...await read(assets))
  console.log(`Deploying ${at.at}`)
  for (
    let line of await push(rpc(at.bearer), files, target(at), {
      progress: (event) =>
        console.log(JSON.stringify({ app: at.at, ...event })),
    })
  ) {
    console.log(line)
  }
}
let font = async (at: Selected, path: string) =>
  (await storeUpload(
    at.bearer,
    at.at,
    await Deno.readFile(path),
    'font/ttf',
    'Crimson Text',
    { buyer: at.buyer },
  )).eid

let path = Deno.args[0]
if (!path) {
  throw new Error(
    'Usage: deno run -A bin/print-previews.ts <fixture-config.json>',
  )
}
let config = JSON.parse(await Deno.readTextFile(path)) as Config
let localConfig = configPath()
if (!localConfig) {
  throw new Error(
    'Sign in to the selected fixture accounts with yak auth first',
  )
}
let host = await compose(configAt(localConfig), ['graph'], undefined, {
  process: false,
})
try {
  let select = async (to: Target): Promise<Selected> => {
    let login = await account(host)(to.as)
    let buyer = to.buyer ?? (login.session && claimsOf(login.session)?.person)
    if (!buyer) throw new Error(`Name the fixture customer id for ${to.as}`)
    return { ...to, ...login, buyer }
  }
  let printer = await select(config.printer),
    coloring = await select(config.coloring)
  await install(printer, 'printbound')
  await install(coloring, 'crayonbloom', config.assets)
  await configure(printer, 'print_service', {
    preview: true,
    font: await font(printer, config.font),
    product: 'text',
    margin: 0,
    contact: 'preview@example.invalid',
  })
  await configure(coloring, 'coloring_runtime', {
    preview: true,
    font: await font(coloring, config.font),
    printer: printer.id,
  })
  await tool(printer, 'integration_publish', {
    ...target(printer),
    listed: false,
    title: 'PrintBound fixture preview',
    description:
      'Deterministic fixture quotes and receipts; no payments or print orders.',
  })
  await tool(coloring, 'service_connect', {
    ...target(coloring),
    service: printer.id,
    operations: [
      'prepare',
      'document_status',
      'quote',
      'purchase',
      'order_status',
      'cancel',
      'document_file',
    ],
  })
  console.log(
    `PrintBound: https://${printer.at.split('/')[0]}.yaks.app/${
      printer.at.split('/')[1]
    }/studio`,
  )
  console.log(
    `CrayonBloom: https://${coloring.at.split('/')[0]}.yaks.app/${
      coloring.at.split('/')[1]
    }/studio`,
  )
} finally {
  await host.close()
}
