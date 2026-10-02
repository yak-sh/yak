// Retained takes are shown together, with the same chosen output the game uses.
import { test } from "@yaks/testing";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { h } from "preact";
import { render } from "npm:preact-render-to-string@6.7.0";
import { type Row, songs } from "./music_takes.ts";
import { catalog } from "./music_catalog.ts";
import { Takes } from "./music-takes-view.ts";

let rows: Row[] = [
  { entity: { eid: "run" }, build: { for: "song", variant: "main" } },
  { entity: { eid: "song" }, song: { theme: "choir", land: "land" } },
  { entity: { eid: "land" }, theme_design: { land: "Moss" } },
  {
    entity: { eid: "old-audio" },
    artifact: { address: "old", media_type: "audio/mpeg" },
  },
  {
    entity: { eid: "new-audio" },
    artifact: { address: "new", media_type: "audio/mpeg" },
  },
  {
    entity: { eid: "old" },
    created: { at: "2026-10-01T00:00:00Z" },
    chosen: {},
    built: { build: "run", slot: "song", artifact: "old-audio", current: true },
  },
  {
    entity: { eid: "new" },
    created: { at: "2026-10-02T00:00:00Z" },
    built: {
      build: "run",
      slot: "song",
      artifact: "new-audio",
      current: false,
    },
  },
];

test("recordings list every take while the game plays the chosen earlier take", () => {
  let all = songs(rows);
  assertEquals(all[0].takes.map((t) => [t.id, t.chosen]), [["new", false], [
    "old",
    true,
  ]]);
  assertEquals(catalog(rows).Moss[0].sha, "old");
  let html = render(
    h(Takes, {
      songs: all,
      editor: true,
      busy: null,
      message: "",
      choose: () => {},
    }),
  );
  assertStringIncludes(html, "api/blob/old");
  assertStringIncludes(html, "api/blob/new");
  assertStringIncludes(html, "In use");
  assertStringIncludes(html, "Use this take");
});
