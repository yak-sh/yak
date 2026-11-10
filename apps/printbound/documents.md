# Print document preparation

`start(product, draft)` creates a serializable preparation checkpoint. Each
`advance(checkpoint, io)` completes one stage: four ordered source pages, eight
immutable PDF fragments, or four page previews. Persist the returned checkpoint
and schedule the next command. Only a result carrying `revision` is a complete
manifest; pending work cannot be reviewed, quoted or purchased. A failed stage
retries from the last checkpoint without restarting completed stages. At most
ten document-door operations occur in a stage, including source reads. The
deployed service uses scheduled commands; `prepare(product, draft, io)` is an
in-process convenience that runs all stages. Preparation composes and inspects
an interior PDF and a single-page wraparound cover. A **manifest** names the
complete PDFs and a PNG preview of every composed page, including padding. Each
artifact carries its SHA-256; `revision` binds the product, title, output hashes
and page inspection. Persist a manifest on a fresh document entity. A changed
draft produces another document; quotes name that document and its revision.

`Draft` accepts an interior/cover PDF pair, Markdown, or ordered PNG, JPEG and
single-page PDF assets. Page PDFs support vector puzzles. `kind: 'blank'`
creates an intentional blank page; missing artwork fails preparation. Captions
use a reserved band. `bleed: true` fills the sheet and crops to its edge.
Full-color art stays in color; coloring interiors flatten PNG transparency,
remove near-white backgrounds and convert artwork to grayscale. Uploaded
coloring PDFs are checked against their rendered pages. Covers may use color for
every product. `frontBleed: false` places front artwork in an inset panel
between the title and author bands, retaining native print resolution. The
default front artwork fills the cover. Neither mode enlarges insufficient
resolution artwork.

`layout.ts` owns binding padding, trim, bleed, perfect-bound spines and casewrap
board bands. `inspection.ts` uses pdf-lib's object and stream parser, walks font
resources and nested artwork, and follows content transforms to measure image
resolution. It checks every page's print dimensions, embedded fonts, artwork
resolution and unflattened transparency before publishing a manifest. PNG
artwork is reduced to the product's print resolution; each image is embedded
immediately so decoded art is released before the next page.

`render.ts` binds preparation to app doors. Its
`preparation(APP, STORE, buyer,
product, draft, font)` takes the customer's
vouched store separately from the app's privileged door. Customer source
artifacts are read through `STORE`; the configured font and private output
uploads use `APP`. The font argument comes from service configuration and
replaces any customer-selected font. Cross-app sources use renewed HTTPS
artifact tickets through the supplied fetch boundary. Final outputs remain
private artifacts in the PrintBound app.

Provision the licensed Crimson Text TTF from the existing PrintBound renderer as
a private blob and record its identity in service configuration. Fonts and
generated print assets belong in blob storage. The 924-byte generated font in
`font_fixture.ts` is for tests and draws placeholder glyph shapes; it is not
customer typography.

PDF previews call `APP.fetch('/pdf?page=1&render=1', {method: 'POST', body})`.
The platform's authenticated PDF door uses its existing PDFium raster worker.
App code loads no WebAssembly or local files, starts no browser, and calls no
external rendering service. Invalid supplied PDFs and artwork raise
`DocumentInputError`, which the service answers as a correction request.
Transport and generated-document failures propagate to the app's error
reporting; the caller retains its source draft and publishes no incomplete
manifest.

The binding geometry and layout rules come from the PrintBound and CrayonBloom
renderers. Lulu requires downloadable interior and cover PDFs, embedded fonts,
bleed dimensions and print-resolution artwork:
[production files](https://help.api.lulu.com/en/support/solutions/articles/64000254607-what-files-are-required-for-lulu-print-api-production-)
and
[PDF creation settings](https://help.lulu.com/en/support/solutions/articles/64000255519-pdf-creation-settings).
Physical print quality requires a separate proof order.
