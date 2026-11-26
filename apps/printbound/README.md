# PrintBound

The PrintBound storefront saves chat or Markdown as a private book draft. Its
Worker uses the same prepare, document status, quote, purchase and order tools
as connected apps. A preparation job retains its input revision and resumes
composed page previews before the edition can be quoted or bought. Editing the
source invalidates the selected edition without losing an earlier receipt.

The platform owns identity, private artifact grants, selling, refunds and
resumable calls; PrintBound owns document composition and print-provider
reconciliation. `documents.md` documents the preparation contract.

## Pages and look

The Worker draws every page a visitor reads (`site.ts`) from @yaks/ui's parts
and the app's own (`site/parts.ts`): the home page (`site/home.ts`), and each
guide and policy from its Markdown in `pages/` (`site/doc.ts`), inside one frame
(`site/frame.ts`). The studio is a Preact page on the same parts (`studio.html`,
`studio.ts`), with the frame set into its file. The app is private, so a visitor
gets only what that door hands over.

The look is Spellbound, the design of the site PrintBound had before it moved
here (`bindery` at `10aaf7c`; `public/spellbound.md` has its reasons): a theme
of the kit's roles (`look/spellbound.css`), a skin laid over the kit's parts
(`look/skin.css`) and the sheets of the app's own parts. `look/links.ts` embeds
the kit, skin and part styles in cascade order on public pages and in the
studio. The theme stays linked at its content-addressed URL so the browser can
reuse it and its fonts. The fonts (`fonts/`) and pictures (`img/`, `og.png`) are
released as app assets (`apps/.gitignore`).

The initial fixture preview is explicit and makes no paid model or print calls.
`bin/print-previews.ts` provisions typography and preview settings as artifacts.
Live accounts, physical print proofs and domain cutover are separate decisions.
