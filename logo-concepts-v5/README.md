# yaks.app yak gallery, round five

This is the complete review page. It includes every retained image from the four
earlier galleries and every output from the current logo, transparency, and
character passes—including rejected anatomy, opaque checkerboards, baked
vignettes, and visual drift.

The official icon is `../logo-concepts-v4/04-simple-watercolor.png`. A resized
copy now serves the yaks.app homepage, favicon, Apple touch icon, and 192/512
app-icon exports.

## Generation groups

- `reference-*`: generated with the official number four as an image reference
  in the ongoing conversation.
- `extracted-*`: attempts to turn the generated checkerboard into alpha.
- `clean-*`: generated without image inputs, but inside the ongoing
  conversation.
- `isolated-text-*`: generated in fresh isolated contexts from text only.
- `isolated-reference-*`: generated in fresh isolated contexts with exactly one
  image input: the official number four.

Files stay in the gallery even when rejected. The page labels opaque
checkerboards, baked vignettes, extra limbs, sideburn drift, drafts, and failed
repairs instead of silently discarding them.

## Character rules

- Cute does not mean kawaii. Keep tiny, widely spaced, parallel eyes and a
  restrained smile.
- Keep the head level. A tilt is not shorthand for friendliness.
- Keep logo poses static and compact. Character spot illustrations may explain a
  situation, but should not become action scenes.
- Preserve exactly four limbs and check them visually before accepting a pose.
- Preserve the approved cinnamon body, cream face and horns, small pink nose,
  and three rounded forehead lobes.
- Do not add sideburns, cheek tufts, mutton chops, or face-framing hair.
- Detailed material and lighting work belongs only to the modeled icon variants.
  Watercolor, gouache, and paper variants stay structurally simple.

## Durable generation lesson

Omitting image inputs does not guarantee a clean visual reset when generation
continues inside the same conversation: repeated motifs can still recur. For a
clean pass, use a fresh isolated generation context. When a character reference
is wanted, supply only the approved master—never a derivative that already
carries the defect being removed.

Transparency is a file property, not a prompt claim. Validate the PNG color type
and inspect the pixels: an RGBA file can still contain an opaque vignette, and
an image that depicts a checkerboard can be an opaque RGB file.
