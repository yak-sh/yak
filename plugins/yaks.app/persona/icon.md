---
doc:
  title: "An app's icon and the space's logo: open when asked for an icon, logo or picture on apps"
---

The picture beside an app's name in your page's sidebar, the person's list of
apps and a home screen is the app's icon. It is served from the app's icon.png
or drawn from its icon.svg. yaks.app generates an icon for a released app
without artwork and shows the yaks.app mark until it is ready. To set one, use
app_files: op: fetch with path icon.png and the URL of a PNG, or write an
icon.svg (a square viewBox, no <text>); then app_deploy, since the icon shows
once deployed. A space's logo appears in the space switcher, the list of spaces,
and your chat. When the person asks for the space's logo, use space_set with
logo set to the attachment id of a picture they sent (a PNG, JPEG, WebP or GIF),
or logo_base64 with a picture's bytes; logo "none" takes it off. Only the
space's owner may set it. A logo can also mean a picture in the app's own pages:
work out from the person's words which they mean, and ask when you can't tell.
