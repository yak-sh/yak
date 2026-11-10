// Load PrintBound's waitlist into its yaks.app store, and load it again: rows
// keep their derived ids, so a later read replays only what changed.
//
//   wrangler d1 execute printbound-waitlist --remote --json \
//     --command "SELECT * FROM signups ORDER BY id" > signups.json
//   deno run -A bin/printbound-load.ts signups.json \
//     [--at printbound/printbound] [--as printbound@bot.yak.sh]
//
// The input is wrangler's own answer. Each signup keeps its consent evidence
// and the digest of its mailed unsubscribe token; nothing is sent. Signups are
// staged under the installation's private instrument, which nobody holds: an
// email never grants access.
import { compose } from '@yaks/cli/host'
import { configPath, read as configAt } from '@yaks/cli/config'
import { account } from '../packages/admin/account.ts'
import { importedEid, inventory, type Row } from './venture-import.ts'
import { printboundSignup, printboundWaitlist } from './printbound-import.ts'
import { storeCopy } from './venture-store.ts'

/** The source installation: identical for the snapshot and every delta. */
export let SOURCE = 'cloudflare/printbound-waitlist'

let flag = (name: string) =>
  Deno.args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
let [path] = Deno.args.filter((a) => !a.startsWith('--'))
if (!path) {
  throw new Error('Usage: deno run -A bin/printbound-load.ts <signups.json>')
}
let at = flag('at') ?? 'printbound/printbound'
let as = flag('as') ?? 'printbound@bot.yak.sh'

let [answer] = JSON.parse(await Deno.readTextFile(path)) as {
  results: Row[]
  meta: { changed_db: boolean }
}[]
if (answer.meta.changed_db) {
  throw new Error('The source read changed its store')
}
let imported = inventory(
  SOURCE,
  { signups: answer.results },
  printboundWaitlist,
)
let staged = { via: importedEid(SOURCE, 'installation', [SOURCE]) }

let host = await compose(configAt(configPath()!), ['graph'], undefined, {
  process: false,
})
try {
  let { bearer } = await account(host)(as)
  let { written, reread } = await storeCopy(
    bearer,
    at,
    [
      `.legacy_signup.source=${SOURCE}`,
      '.limit=1000',
      '?legacy_opt_out',
      '?mail_opt_out',
    ],
    imported,
    (row) => printboundSignup(SOURCE, row, () => staged),
  )
  console.log(JSON.stringify(
    { at, source: SOURCE, counts: imported.counts, written, reread },
    null,
    2,
  ))
} finally {
  await host.close()
}
