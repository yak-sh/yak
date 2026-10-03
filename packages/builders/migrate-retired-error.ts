// Repair the saved memory-marking builder query left behind when tool
// refusals replaced error{code}. Keep all other builder state and history.
import { token } from '@yaks/graph'
import { compose } from '../cli/host.ts'
import { read } from '../cli/config.ts'

let config = Deno.args[0]
if (!config) throw new Error('usage: migrate-retired-error.ts <config>')
let host = await compose(read(config), ['graph'])
try {
  let eid = '733bbb05-3984-4167-a4a9-6948d5e55b53'
  let [row] = await host.graph.get([eid])
  let query = (row?.builder as { query?: string } | undefined)?.query
  if (!query) throw new Error('memory-marking builder is missing its query')
  let fixed = query.replace(/!error(?=&)/g, '!refusal')
  if (query == fixed) {
    console.log('0 queries changed')
  } else {
    await host.graph.apply([{
      entity: { eid },
      builder: { query: fixed },
      $was: { builder: { query: token(query) } },
    }])
    console.log(
      '1 query changed: !error → !refusal; other components preserved',
    )
  }
} finally {
  await host.close()
}
