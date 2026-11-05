// The site as entities: the page is a layout whose panes show its sections,
// each section is a doc, and each file the app serves is a file read in the
// site. The page draws itself from these, so changing one redraws it.
import type { Bundle } from "@yaks/graph";
import { fileOf } from "@yaks/file";

/** The site: its title, and the layout its page is. */
export let SITE = "2caade2e-aa23-4fc5-bba3-af9eff4f64a1";
let ROOT = "90e19de2-e19c-4490-81cf-561edd349718";

/** Every file the app serves, as `file{path, root}` read in the site. */
export let FILES = [
  "index.html",
  "style.css",
  "main.ts",
  "views.ts",
  "figure.ts",
  "yak.ts",
  "site.ts",
  "package.json",
  "icon.png",
  "paper.webp",
  "term.ts",
];

/** A section: the view that draws it and what it says. A step's `sh` block
 * is what it types into the prompt, its `mcp` block what an agent calls, and
 * its `query` block what the drawing beside it shows. */
type Section = {
  eid: string;
  pane: string;
  view: string;
  title: string;
  body: string;
};

let sh = (...lines: string[]) => "```sh\n" + lines.join("\n") + "\n```";
let mcp = (...lines: string[]) => "```mcp\n" + lines.join("\n") + "\n```";
let query = (q: string) => "```query\n" + q + "\n```";

export let INSTALL =
  "deno run -A --minimum-dependency-age=0 jsr:@yaks/cli/install";

export let HERO = "6f166202-b881-400d-84c7-dd8620dc7826";
export let SELF = "525ab3f6-bdc3-48a6-b2f3-e88fa2d06a1b";

export let SECTIONS: Section[] = [
  {
    eid: HERO,
    pane: "68496d50-1f05-4653-a937-2bd2f96455c9",
    view: "Hero",
    title: "A shared graph for your data, tools, and agents.",
    body:
      "`yak` is a command line, and `@yaks` a set of open-source TypeScript packages, for one graph that you and your agents both read and write.",
  },
  {
    eid: "35cd004b-ca47-4090-9d3c-285a1f8de275",
    pane: "eea2335c-b3d2-40ae-8ab4-a166ec45f33b",
    view: "Step",
    title: "A task is an entity",
    body: [
      "An entity is an id and the components it carries. `task new` writes one with `doc{title}` and `task{}`, and the graph gives it a number.",
      sh("yak task new 'Throw the party'"),
    ].join("\n\n"),
  },
  {
    eid: "599e735a-c838-49d8-9299-bbc8d005d047",
    pane: "329d0f98-94c8-455e-bb62-08fe643e1e27",
    view: "Step",
    title: "A link is an entity too",
    body: [
      "An edge ties one entity to another. This one says the party requires the cake.",
      sh(
        "yak task new 'Buy the cake'",
        `yak graph apply --bundles '[{"edge": {"from": "T-1", "to": "T-2"}, "requires": {}}]'`,
      ),
    ].join("\n\n"),
  },
  {
    eid: "b0bc4ecf-d1a1-4beb-87a4-b13205a7a679",
    pane: "d82ec80a-577a-401c-8787-934b8edf4196",
    view: "Step",
    title: "Your agent calls the same tools",
    body: [
      "Every `yak` command is also an MCP tool, served at `/mcp` by `yak serve`. An agent comments and finishes the cake, and its writes carry its own id.",
      mcp(
        'comment_new {"target": "T-2", "body": "Ordered a chocolate one for Saturday."}',
        'task_update {"task": "T-2", "status": "done"}',
      ),
    ].join("\n\n"),
  },
  {
    eid: "52fba5d7-8abb-41cd-a743-ca88cca351ee",
    pane: "7001b339-96f5-4ad8-9e73-928e3163ab06",
    view: "Step",
    title: "One query finds them",
    body: [
      "The same query grammar reads the graph in the terminal, over MCP and in the browser.",
      sh("yak graph query '.task.status=open ?doc'"),
    ].join("\n\n"),
  },
  {
    eid: SELF,
    pane: "f8eb267e-b1df-4754-b6b8-7d7f25ddcd25",
    view: "Step",
    title: "This page is a graph",
    body: [
      "Its sections, its files and each command you type are entities in the graph running in this tab, and the page draws itself from them. Change this section and it redraws. Reloading starts over.",
      sh(
        "yak graph query '.file ?file'",
        `yak graph apply ${SELF} '.doc.title="This page is a graph you can change"'`,
      ),
      query(".file|.pane|.layout *"),
    ].join("\n\n"),
  },
  {
    eid: "69f51fa0-442e-4bcc-b440-9665c93fec06",
    pane: "d57ac900-730b-417c-8798-5cafc5c891d5",
    view: "Stack",
    title: "A write is a list of bundles, applied in one transaction",
    body:
      "A bundle is one entity's components. `apply()` takes a list of them through the phases below, and the rules and checks of every package the graph loads run inside them. The lit phases are the ones your last command ran.",
  },
  {
    eid: "daf368d7-bfd4-4fe4-ae77-3545d58f4cd7",
    pane: "e3705147-f576-424a-8ef2-6e0718ee0875",
    view: "Doors",
    title: "Every interface reaches the same graph",
    body:
      "The terminal, your agents over MCP, a page in the browser and yaks.app call the same tools on one graph. `--host` points the same commands at another machine, or at yaks.app once you run `yak auth yaks.app`.",
  },
  {
    eid: "d15f7ff7-ada4-4202-9874-f523e797d35a",
    pane: "156e61d0-9281-41ac-a1b3-19aa77f1c2be",
    view: "Install",
    title: "Install yak",
    body: [
      "It needs [Deno](https://deno.com). `yak init` starts a graph in one SQLite file on your machine.",
      sh(INSTALL, "yak init Ada", "yak task new 'Buy the cake'"),
    ].join("\n\n"),
  },
];

/** The page's own rows: the site, its layout, a pane per section in order,
 * and the sections. None takes a number, so the visitor's first task is T-1. */
export let seed = (): Bundle[] =>
  rows().map((b) => ({ ...b, entity: { ...b.entity, num: null } }));

let rows = (): Bundle[] => [
  {
    entity: { eid: SITE },
    doc: { title: "yak.sh", body: SECTIONS[0].title },
    layout: { root: ROOT },
  },
  { entity: { eid: ROOT }, pane: { layout: SITE, dir: "v" } },
  ...SECTIONS.flatMap((s, order) => [
    { entity: { eid: s.eid }, doc: { title: s.title, body: s.body } },
    {
      entity: { eid: s.pane },
      pane: { layout: SITE, parent: ROOT, order, content: s.eid, view: s.view },
    },
  ]),
];

/** The files, read with `fetch` from where the page is served: text keeps
 * its contents as `content{body}`. */
export let files = async (
  fetch: (path: string) => Promise<Response>,
): Promise<Bundle[]> =>
  await Promise.all(FILES.map(async (path) => {
    let file = {
      entity: { eid: fileOf(SITE, path) },
      file: { path, root: SITE },
    };
    let res = await fetch(path).catch(() => null);
    if (!res?.ok) return file;
    return { ...file, content: { body: await res.text() } };
  }));

/** The commands a section's body types, and the calls it makes as the agent. */
export let scriptOf = (body: string) => {
  let block = (kind: string) =>
    [...body.matchAll(new RegExp("```" + kind + "\\n([\\s\\S]*?)\\n```", "g"))]
      .flatMap((m) => m[1].split("\n")).filter(Boolean);
  return {
    query: block("query")[0],
    sh: block("sh"),
    mcp: block("mcp").map((line) => {
      let at = line.indexOf(" ");
      return { tool: line.slice(0, at), args: JSON.parse(line.slice(at + 1)) };
    }),
  };
};

/** A section's prose: its body without the blocks it runs. */
export let proseOf = (body: string) =>
  body.replace(/```(sh|mcp|query)\n[\s\S]*?\n```/g, "").trim();
