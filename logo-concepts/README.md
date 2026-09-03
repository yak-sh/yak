# yaks.app raster logo concepts

Four raster interpretations of the current yak, generated from
`workers/yak/public/yak.svg` as the character reference. None is wired into the
live site yet.

1. `yak-gouache.png` — soft, hand-painted, closest in spirit to the homepage.
2. `yak-monoprint-head.png` — a tighter crop intended to survive favicon sizes.
3. `yak-cut-paper.png` — layered paper with restrained depth and crisp shapes.
4. `yak-block-print.png` — higher-contrast, more graphic ink texture.

All four masters are 1254 × 1254 RGBA PNGs with genuine alpha transparency. Open
`index.html` to compare each one on the homepage's light and dark grounds, at
hero, header, app-icon, and favicon sizes.

After a direction is chosen, make a consistent production family from that
master: transparent homepage art, a deliberately simplified favicon, 180px Apple
touch icon, 192px and 512px app icons, and a padded 512px maskable icon. The
site currently has no web manifest or service worker, so generating the PWA
artwork does not by itself make it an installable offline app.

Generated with the built-in image generation tool using the existing yak as a
required reference. Prompts preserved its horn curve, three-lobed fringe,
centered face, broad body, cocoa/cream/pink palette, and restrained smile while
changing only medium and crop.
