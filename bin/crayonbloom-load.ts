// Load a CrayonBloom source export into a yaks.app store, and load it again:
// rows keep their derived ids, so a later export replays only what changed.
//
//   deno run -A bin/pg-export.ts <railway.dump> <tables.json>
//   deno run -A bin/crayonbloom-load.ts <tables.json> <backup dir> \
//     [--at crayonbloom/crayonbloom] [--as admin@bot.yak.sh]
//
// The backup directory holds the bucket's `bucket-inventory.json` and the
// objects it names. Every source user is staged under a private instrument
// derived from its own row, which nobody holds until a verified binding
// moves it to a person: an email never grants access. Rows with no user are
// staged under the installation's instrument.
import { createHash } from 'node:crypto'
import { compose } from '@yaks/cli/host'
import { configPath, read as configAt } from '@yaks/cli/config'
import { account } from '../packages/admin/account.ts'
import { storeArtifact, storeUpload } from '../packages/admin/api.ts'
import { type Imported, importedEid, type Tables } from './venture-import.ts'
import { storeCopy } from './venture-store.ts'
import { copyAssets } from './venture-assets.ts'
import { crayonbloom, crayonbloomProjection } from './crayonbloom-import.ts'
import { type Book, fingerprint, type Page } from '../apps/crayonbloom/model.ts'

/** The source installation: identical for the snapshot and every delta. */
export let SOURCE = 'railway/crayonbloom/production'

type Stored = {
  Key: string
  Size: number
  sha256: string
  backupFile: string
}

let flag = (name: string) =>
  Deno.args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
let [tablesPath, backup] = Deno.args.filter((a) => !a.startsWith('--'))
if (!tablesPath || !backup) {
  throw new Error(
    'Usage: deno run -A bin/crayonbloom-load.ts <tables.json> <backup dir>',
  )
}
let at = flag('at') ?? 'crayonbloom/crayonbloom'
let as = flag('as') ?? 'admin@bot.yak.sh'

let tables = JSON.parse(await Deno.readTextFile(tablesPath)) as Tables
let imported = crayonbloom(SOURCE, tables)
let byId = new Map(imported.rows.map((r) => [r.eid, r]))
let unattributed = importedEid(SOURCE, 'installation', [SOURCE])
let owner = (row: Imported): { via: string } => {
  if (row.table === 'users') return { via: row.eid }
  let parent = row.refs.user_id ?? row.refs.book_id ?? row.refs.order_id ??
    row.refs.record_id ?? row.refs.blob_id
  return parent ? owner(byId.get(parent)!) : { via: unattributed }
}

let host = await compose(configAt(configPath()!), ['graph'], undefined, {
  process: false,
})
try {
  let { bearer } = await account(host)(as)

  // Bytes first: a row naming an artwork is written only once it is copied.
  let inventory = JSON.parse(
    await Deno.readTextFile(`${backup}/bucket-inventory.json`),
  ).objects as Stored[]
  let objects = new Map(inventory.map((o) => [o.Key, o]))
  let blobs = imported.rows.filter((r) => r.table === 'active_storage_blobs')
  let uploaded = 0
  let mapped = await copyAssets(
    blobs.map((r) => {
      let o = objects.get(String(r.data.key))
      if (!o) throw new Error(`Source object missing: blob ${r.data.id}`)
      if (o.Size !== Number(r.data.byte_size)) {
        throw new Error(`Source size mismatch: blob ${r.data.id}`)
      }
      return { key: String(r.data.key), bytes: o.Size, hash: o.sha256 }
    }),
    {
      read: async (key) => {
        let bytes = await Deno.readFile(
          `${backup}/${objects.get(key)!.backupFile}`,
        )
        let row = blobs.find((r) => r.data.key === key)!
        let md5 = createHash('md5').update(bytes).digest('base64')
        if (md5 !== row.data.checksum) {
          throw new Error(`ActiveStorage checksum mismatch: ${key}`)
        }
        return bytes
      },
      get: (hash) => storeArtifact(bearer, at, hash),
      put: async (hash, bytes) => {
        let row = blobs.find((r) =>
          objects.get(String(r.data.key))!.sha256 === hash
        )!
        uploaded++
        await storeUpload(
          bearer,
          at,
          bytes,
          String(row.data.content_type),
          String(row.data.filename),
          owner(row),
        )
      },
    },
  )
  let project = crayonbloomProjection(imported, {
    owner,
    blobs: Object.fromEntries(blobs.map((r) => {
      let hash = mapped[String(r.data.key)] ??
        objects.get(String(r.data.key))!.sha256
      return [r.eid, {
        blob: hash,
        hash,
        mime: String(r.data.content_type),
      }]
    })),
    fingerprint: (book, page) =>
      fingerprint(book as Book, page as Page | undefined),
  })

  // Everything the store holds of this installation, read in one pass.
  let components = [
    'legacy_record',
    'legacy_asset',
    'legacy_page',
    'legacy_opt_out',
    'mail_opt_out',
    'doc',
    'coloring_book',
    'coloring_page',
    'gallery_consent',
    'page_failed',
    'artwork',
    'character_art',
    'print_receipt',
  ]
  let { written: first, reread: rerun } = await storeCopy(
    bearer,
    at,
    [
      `.legacy_record.source=${SOURCE}`,
      '.limit=1000',
      ...components.map((c) => `?${c}`),
    ],
    imported,
    project,
  )
  console.log(JSON.stringify(
    {
      at,
      source: SOURCE,
      counts: imported.counts,
      unmapped: imported.unmapped,
      assets: { objects: blobs.length, uploaded },
      written: first,
      reread: rerun,
    },
    null,
    2,
  ))
} finally {
  await host.close()
}
