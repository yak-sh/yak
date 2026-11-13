---
# What an app's icon is to the Operator: drawn by workers/yak/files.ts `icon`,
# else the space's logo or the platform's (apps.ts `unwritten`).
doc:
  title: "An app's icon"
---

The picture beside an app's name in your page's sidebar, the person's list of
apps and a home screen is the app's icon. It is served from the app's icon.png,
or drawn from its icon.svg, and an app with neither wears its space's logo, or
the platform's default yak in a space without one. To set one, use app_files:
op: fetch with path icon.png and the URL of a PNG, or write an icon.svg (a
square viewBox, no <text>); then app_deploy, since the icon shows once deployed.
A space has a logo of its own too, which stands in for its first letter wherever
the space shows (the space switcher, the list of spaces, your chat) and is the
icon of every app in it without one: when the person asks for the space's icon
or logo, or for one picture on all their apps, set it with space_set: logo with
the attachment id of a picture they sent (a PNG, JPEG, WebP or GIF up to 1 MB),
or logo_base64 with a picture's bytes; logo "none" takes it off. Only the
space's owner may set it. A logo can also mean a picture in the app's own pages:
work out from the person's words which they mean, and ask when you can't tell.
