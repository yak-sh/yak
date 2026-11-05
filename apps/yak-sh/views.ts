// How the page draws itself from its graph: the site's layout is a column of
// panes, and each pane shows a section doc in the view it names. Every view
// reads the rows the graph last committed, so a write from the prompt redraws
// what it changed.
import { type ComponentChild, type FunctionComponent, h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { parse } from "@yaks/query/core";
import { define } from "@yaks/render";
import { Markdown } from "@yaks/markdown";
import { mount } from "@yaks/diagram";
import { INSIDE, PHASES } from "@yaks/graph/plugin";
import type { Bundle } from "@yaks/graph";
import type { EntityProps } from "@yaks/preact";
import type { Yak } from "./yak.ts";
import type { Line, Term } from "./term.ts";
import type { Figure } from "./figure.ts";
import { INSTALL, proseOf, scriptOf } from "./site.ts";

/** What every view is given beside its bundle. */
export type Ctx = {
  yak: Yak;
  term: Term;
  Entity: FunctionComponent<EntityProps>;
  /** The drawing's query, and what the last write did. */
  figure: Figure;
};

/** Draw again whenever `listen` tells. */
let useTold = (listen: (l: () => void) => () => void) => {
  let [, tick] = useState(0);
  useEffect(() => listen(() => tick((n) => n + 1)), [listen]);
};

let text = (b: Bundle, comp: string, prop: string) =>
  String((b[comp] as Record<string, unknown> | undefined)?.[prop] ?? "");

// ------------------------------------------------------------------ the page

let Page: FunctionComponent<Ctx & { e: Bundle }> = (ctx) => {
  let { yak, Entity } = ctx;
  useTold((l) => yak.watch("*", l));
  let root = text(ctx.e, "layout", "root");
  let panes = yak.rows()
    .filter((b) => text(b, "pane", "parent") == root)
    .sort((a, b) =>
      Number(text(a, "pane", "order")) - Number(text(b, "pane", "order"))
    );
  // Consecutive steps share one story: a prompt and a drawing beside them.
  let parts: ComponentChild[] = [];
  let steps: string[] = [];
  let flush = () => {
    if (steps.length) parts.push(h(Story, { ...ctx, steps, key: steps[0] }));
    steps = [];
  };
  for (let p of panes) {
    let content = text(p, "pane", "content");
    if (text(p, "pane", "view") == "Step") {
      steps.push(content);
      continue;
    }
    flush();
    parts.push(
      h(Entity, {
        ...ctx,
        eid: content,
        view: text(p, "pane", "view"),
        key: content,
      }),
    );
  }
  flush();
  return h("div", { class: "Site" }, parts);
};

let Nav = () =>
  h("nav", { class: "Nav" }, [
    h("a", { class: "Nav_Mark", href: "./" }, [
      h("span", { class: "Nav_Dot" }),
      "yak.sh",
    ]),
    h("span", { class: "Nav_Links" }, [
      h("a", { href: "#install" }, "Install"),
      h("a", { href: "https://jsr.io/@yaks" }, "Packages"),
      h("a", { href: "https://github.com/yak-sh/yak" }, "GitHub"),
    ]),
  ]);

let Copy = ({ line }: { line: string }) => {
  let [done, set] = useState(false);
  return h("div", { class: "Copy" }, [
    h("code", null, [h("span", { class: "Copy_Sign" }, "$ "), line]),
    h("button", {
      type: "button",
      onClick: () =>
        navigator.clipboard?.writeText(line).then(() => {
          set(true);
          setTimeout(() => set(false), 1500);
        }),
    }, done ? "Copied" : "Copy"),
  ]);
};

let Hero: FunctionComponent<Ctx & { e: Bundle }> = ({ e }) =>
  h("header", { class: "Hero", "data-eid": e.entity.eid }, [
    h(Nav, null),
    h("div", { class: "Hero_Body" }, [
      h("p", { class: "Kicker" }, [
        h("span", { class: "Kicker_Dot" }),
        "yak and the @yaks packages · open source",
      ]),
      h("h1", null, text(e, "doc", "title")),
      h(
        "div",
        { class: "Lead" },
        h(Markdown, { source: proseOf(text(e, "doc", "body")) }),
      ),
      h(Copy, { line: INSTALL }),
      h(
        "p",
        { class: "Hint" },
        "Scroll, and the graph below runs each command in this tab.",
      ),
    ]),
  ]);

// ------------------------------------------------------------------ the story

let Story: FunctionComponent<Ctx & { steps: string[] }> = (ctx) => {
  let { yak, term, Entity, steps } = ctx;
  let bodies = () =>
    steps.map((eid) =>
      text(yak.row(eid) ?? { entity: { eid } }, "doc", "body")
    );
  let reach = (n: number) => term.reach(bodies(), n);
  return h("section", { class: "Story" }, [
    h("div", { class: "Story_Steps" }, [
      ...steps.map((eid, i) =>
        h(Entity, { ...ctx, eid, view: "Step", key: eid, n: i + 1, reach })
      ),
      h(Prompt, ctx),
    ]),
    h("div", { class: "Story_Figure" }, h(Figure, ctx)),
  ]);
};

let Step: FunctionComponent<
  Ctx & { e: Bundle; n: number; reach: (n: number) => void }
> = (
  { e, n, reach },
) => {
  let ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let el = ref.current;
    if (!el || typeof IntersectionObserver == "undefined") return;
    let seen = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) reach(n);
    }, { rootMargin: "0px 0px -45% 0px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [n]);
  let body = text(e, "doc", "body");
  let { sh, mcp } = scriptOf(body);
  return h("article", { class: "Step", ref, "data-eid": e.entity.eid }, [
    h("p", { class: "Step_N" }, String(n).padStart(2, "0")),
    h("h2", null, text(e, "doc", "title")),
    h(Markdown, { source: proseOf(body) }),
    h("ul", { class: "Step_Lines" }, [
      ...sh.map((line) => h("li", null, h("code", null, line))),
      ...mcp.map(({ tool, args }) =>
        h(
          "li",
          { class: "is-agent" },
          h("code", null, `${tool} ${JSON.stringify(args)}`),
        )
      ),
    ]),
  ]);
};

let sign: Record<Line["kind"], string> = {
  in: "$ ",
  agent: "agent ▸ ",
  out: "",
  fault: "",
};

let Prompt: FunctionComponent<Ctx> = ({ term }) => {
  useTold(term.listen);
  let [line, set] = useState("");
  let screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let el = screen.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  return h("div", { class: "Prompt" }, [
    h("div", { class: "Prompt_Bar" }, [
      h("i", null),
      h("i", null),
      h("i", null),
      h("span", null, "yak, in this tab"),
    ]),
    h("div", { class: "Prompt_Screen", ref: screen }, [
      ...term.lines().map((l) =>
        h("div", { class: `Prompt_Line is-${l.kind}` }, [
          h("span", { class: "Prompt_Sign" }, sign[l.kind]),
          l.text,
        ])
      ),
      term.typing()
        ? h("div", { class: "Prompt_Line is-in" }, [
          h("span", { class: "Prompt_Sign" }, "$ "),
          term.typing(),
          h("b", { class: "Caret" }),
        ])
        : null,
    ]),
    h("form", {
      class: "Prompt_Form",
      onSubmit: (ev: Event) => {
        ev.preventDefault();
        if (!line.trim()) return;
        term.enter(line);
        set("");
      },
    }, [
      h("span", { class: "Prompt_Sign" }, "$ yak "),
      h("input", {
        value: line,
        "aria-label": "Type a yak command",
        placeholder: "help",
        autocomplete: "off",
        spellcheck: false,
        onInput: (ev: Event) =>
          set((ev.currentTarget as HTMLInputElement).value),
      }),
    ]),
  ]);
};

let Figure: FunctionComponent<Ctx> = ({ yak, figure }) => {
  useTold(figure.listen);
  let sheet = useRef<HTMLDivElement>(null);
  let drawing = useRef<ReturnType<typeof mount>>();
  let [asked, setAsked] = useState(figure.query());
  let [fault, setFault] = useState("");
  useEffect(() => {
    if (!sheet.current) return;
    let m = mount(sheet.current, {
      graph: yak.graph,
      query: figure.query(),
      width: 560,
      height: 520,
    });
    drawing.current = m;
    return () => m.stop();
  }, []);
  useEffect(() => {
    setAsked(figure.query());
    drawing.current?.query(figure.query()).then(() => setFault("")).catch((e) =>
      setFault(e.message)
    );
  }, [figure.query()]);
  return h("figure", { class: "Figure" }, [
    h("form", {
      class: "Figure_Query",
      onSubmit: (ev: Event) => {
        ev.preventDefault();
        figure.ask(asked);
      },
    }, [
      h("label", null, "Drawing"),
      h("input", {
        value: asked,
        "aria-label": "The query the drawing shows",
        spellcheck: false,
        onInput: (ev: Event) =>
          setAsked((ev.currentTarget as HTMLInputElement).value),
      }),
    ]),
    h("div", { class: "Figure_Sheet", ref: sheet }),
    h(
      "figcaption",
      null,
      fault || "What this query selects in the graph in this tab.",
    ),
  ]);
};

// ------------------------------------------------------------------ the loop

let Stack: FunctionComponent<Ctx & { e: Bundle }> = ({ e, yak, figure }) => {
  useTold(figure.listen);
  useTold((l) => yak.watch("*", l));
  let { eid, phases } = figure.last();
  let subject = eid ? yak.row(eid) : undefined;
  let comps = subject
    ? Object.entries(subject).filter(([k, v]) =>
      !k.startsWith("$") && v && typeof v == "object"
    )
    : [];
  let lit = new Set(phases);
  return h("section", { class: "Band Stack", "data-eid": e.entity.eid }, [
    h("div", { class: "Band_Text" }, [
      h("h2", null, text(e, "doc", "title")),
      h(Markdown, { source: proseOf(text(e, "doc", "body")) }),
    ]),
    h("div", { class: "Stack_Figure" }, [
      h("ol", {
        class: "Plates",
        "aria-label": "The components of the last entity written",
      }, [
        ...comps.reverse().map(([name, v], i) =>
          h("li", { class: "Plate", style: `--i:${i}` }, [
            h("b", null, name),
            `{${Object.keys(v as object).join(", ")}}`,
          ])
        ),
        comps.length
          ? null
          : h("li", { class: "Plate is-empty" }, "type a command above"),
      ]),
      h(
        "ol",
        { class: "Phases", "aria-label": "The phases of apply()" },
        PHASES.map((p) =>
          h("li", {
            class: [
              "Phase",
              lit.has(p) ? "is-lit" : "",
              INSIDE.includes(p) ? "is-inside" : "",
            ].join(" "),
          }, p)
        ),
      ),
    ]),
  ]);
};

let DOORS = [
  { at: "terminal", name: "Terminal", line: "yak task list" },
  { at: "agent", name: "Your agents", line: "POST /mcp" },
  { at: "browser", name: "A browser", line: "@yaks/client" },
  { at: "remote", name: "yaks.app", line: "yak --host yaks.app" },
];

let Doors: FunctionComponent<Ctx & { e: Bundle }> = ({ e, yak, figure }) => {
  useTold(figure.listen);
  useTold((l) => yak.watch("*", l));
  let { eid } = figure.last();
  let row = eid ? yak.row(eid) : undefined;
  let by = row && (text(row, "updated", "by") || text(row, "created", "by"));
  let open = by == yak.agent ? "agent" : by ? "terminal" : "";
  return h("section", { class: "Band Doors", "data-eid": e.entity.eid }, [
    h("div", { class: "Band_Text" }, [
      h("h2", null, text(e, "doc", "title")),
      h(Markdown, { source: proseOf(text(e, "doc", "body")) }),
    ]),
    h("div", { class: "Doors_Figure" }, [
      h("div", { class: "Doors_Graph" }, [
        h("b", null, "one graph"),
        h("span", null, `${yak.rows().length} entities`),
      ]),
      ...DOORS.map((d) =>
        h(
          "div",
          { class: `Door is-${d.at}${open == d.at ? " is-open" : ""}` },
          [
            h("b", null, d.name),
            h("code", null, d.line),
          ],
        )
      ),
    ]),
  ]);
};

let Install: FunctionComponent<Ctx & { e: Bundle }> = ({ e }) => {
  let body = text(e, "doc", "body");
  return h("section", {
    class: "Band Install",
    id: "install",
    "data-eid": e.entity.eid,
  }, [
    h("h2", null, text(e, "doc", "title")),
    h(Markdown, { source: proseOf(body) }),
    h(
      "div",
      { class: "Install_Lines" },
      scriptOf(body).sh.map((line) => h(Copy, { line })),
    ),
    h("footer", { class: "Foot" }, [
      h("span", null, "Apache-2.0"),
      h(
        "a",
        { href: "https://github.com/yak-sh/yak" },
        "github.com/yak-sh/yak",
      ),
      h("a", { href: "https://yaks.app" }, "yaks.app"),
    ]),
  ]);
};

let doc = parse(".doc");
export let views = define([
  { view: "Page", match: parse(".layout"), Render: Page },
  { view: "Hero", match: doc, Render: Hero },
  { view: "Step", match: doc, Render: Step },
  { view: "Stack", match: doc, Render: Stack },
  { view: "Doors", match: doc, Render: Doors },
  { view: "Install", match: doc, Render: Install },
] as never);
