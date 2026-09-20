// The words every other plugin stands on, and the machinery under them: the
// entity spine and its marks, the name a thing answers to, the sentence an
// edge is, the prose kept beside the row, and the log of who wrote what.
//
// It is one module rather than eight because none of these is a DOMAIN — no
// fleet word is spelled here. They are the floor: a host that speaks none of
// the domains below still speaks these, and a domain module that brought its
// own copy of them would be declaring a word twice.

import { archetypeDoc, archetypes } from '@yaks/archetype'
import { aliasDoc, aliases } from '@yaks/alias'
import {
  artifactDoc,
  blobKeywords,
  blobRead,
  blobs,
  blobSchema,
  blobText,
  sqliteBlobs,
} from '@yaks/blob'
import { docDoc, docs as docRules } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { effectDoc } from '@yaks/effects'
import { fields as ftsFields, schema as ftsSchema } from '@yaks/fts'
import type { Plugin } from '@yaks/graph'
import { idKeywords } from '@yaks/id'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { ddl as journalDdl, journal, log } from '@yaks/journal'
import { nameKeywords } from '@yaks/names'
import type { Derived } from '@yaks/sql'
import type { Keywords, Vocab, VocabDoc } from '@yaks/vocab'
import type { Host } from '@yaks/cli/serve'

export let vocab: VocabDoc[] = [
  kernelDoc,
  keyDoc,
  aliasDoc,
  edgeDoc,
  artifactDoc,
  docDoc,
  archetypeDoc,
  effectDoc,
]

export let keywords: Keywords[] = [
  kernelKeywords,
  blobKeywords,
  edgeKeywords,
  idKeywords,
  keyKeywords,
  nameKeywords,
]

/** A body column reads as the text it addresses, resolved in the statement. */
export let derived = (v: Vocab): Derived => blobRead(v)

export let rules = (host: Host): Plugin[] => {
  for (let statement of blobSchema()) host.sql.exec(statement)
  host.sql.exec(journalDdl())
  // The search index is SQLite's own: triggers on every component that
  // declared a searchable column, so it keeps itself and a bulk load needs no
  // second pass. It is raised after `store.install()` has made those tables.
  for (
    let statement of ftsSchema(ftsFields(host.vocab), blobText(host.vocab))
  ) host.sql.exec(statement)
  return [
    blobs(host.vocab, sqliteBlobs(host.sql)),
    keys(host.vocab),
    aliases(host.vocab),
    edges(host.vocab),
    docRules(),
    archetypes(),
    journal(
      log({
        rows: (sql, params) =>
          host.sql.query(sql, params as Parameters<typeof host.sql.query>[1]),
      }),
    ),
  ]
}
