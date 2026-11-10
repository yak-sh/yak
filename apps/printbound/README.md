# PrintBound

The PrintBound storefront saves chat or Markdown as a private book draft. Its
Worker uses the same prepare, document status, quote, purchase and order tools
as connected apps. A preparation job retains its input revision and resumes
composed page previews before the edition can be quoted or bought. Editing the
source invalidates the selected edition without losing an earlier receipt.

Public guides and policy routes retain the source content from `bindery` at
`10aaf7c`. The platform owns identity, private artifact grants, selling, refunds
and resumable calls; PrintBound owns document composition and print-provider
reconciliation. `documents.md` documents the preparation contract.

The initial fixture preview is explicit and makes no paid model or print calls.
`bin/print-previews.ts` provisions typography and preview settings as artifacts.
Live accounts, physical print proofs and domain cutover are separate decisions.
