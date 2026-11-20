# @yaks/canva

Canva for an Operator, through
[Canva's REST API](https://www.canva.dev/docs/apps/rest-apis/) (once called the
Connect API). A person signs in through @yaks/connections' built `canva`
integration, which signs in as yaks.app's own Canva client (the `canva` OAuth
client in its vault). `tools(send)` gives the tools that connection offers, each
sending its request through `send`, which adds the person's credential on the
way (@yaks/connections `call`), so this package never holds a token.

| tool              | what it does                                                      |
| ----------------- | ----------------------------------------------------------------- |
| `canva_designs`   | finds designs by words, or the most recently changed              |
| `canva_design`    | reads one design: title, pages, links and its autofill fields     |
| `canva_create`    | makes a blank design of a preset type or a size, with an image    |
| `canva_copy`      | copies a design, whole or some of its pages                       |
| `canva_resize`    | makes a resized copy                                              |
| `canva_templates` | finds brand templates, each with its autofill fields              |
| `canva_fill`      | fills a template's or design's autofill fields, new or in place   |
| `canva_export`    | exports PDF, PNG, JPG, PPTX, GIF or MP4, answering download links |

Resizing, copying, filling and exporting are jobs Canva runs on its own time. A
tool waits on one up to 40 seconds; one still running answers its `job`, and
calling the tool again with that `job` asks after it rather than starting
another.

## What Canva's API cannot do

The REST API cannot change the text, images or layout inside an existing design,
so an Operator cannot edit a slide's words or move an element. Only the fields a
design or brand template marks for autofill take new values (`canva_fill`), and
resizing always makes a copy. Canva's Design Editing API, which does edit a
design's contents, runs only inside Canva's editor as a Canva app. Anything else
is done in Canva, at the design's edit link. Brand templates need a Canva plan
that has them, and resizing a plan with premium features.

## Canva's MCP server

Canva's MCP server (mcp.canva.com) takes only the OAuth clients Canva lists for
it. A client made in Canva's Developer Portal is refused there: its authorize
page answers 500. That client works with the REST API, which is why this package
exists.
