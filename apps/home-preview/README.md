# yaks.app home preview

A separate consumer home page experiment at https://yak.yaks.app/home-preview/.
It does not replace the platform home page in `workers/yak/public/index.html`.

The workbench is a guided demonstration over the live recipe app in the
`yourname` demo space. A fixed, read-only worker route reads its recipe cards.
Visitors can reshape those cards into category groups, select recipes to pull
out their ingredient lists, open the original app, and explore the other live
examples. The page explicitly distinguishes the guided demonstration from a live
AI conversation. It does not write to the source app or spend model budget.

CSS View Transitions carry each recipe from its card to its category row.
Unsupported browsers use an immediate redraw; reduced-motion preferences disable
the animation. The page uses keyboard-operable buttons, checkboxes and details.
Recipe contents are escaped before rendering. An unavailable source shows a
retry and a link to the original rather than invented fallback data.

Deploy from the repository root:

```sh
yak admin push apps/home-preview --space yak --app home-preview --as admin
```

Checks:

```sh
deno task test apps/home-preview
deno lint apps/home-preview
deno fmt --check apps/home-preview
```

The agent buttons are deterministic presentation changes, not an autonomous
agent or a general natural-language command interpreter. Recipe selections and
checked ingredients belong to the current tab and reset when it reloads.
