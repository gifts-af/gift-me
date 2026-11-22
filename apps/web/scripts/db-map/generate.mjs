// `pnpm db:map`: draws the database map from the local database and writes it to
// design/database-map.html, which is committed. `pnpm db:map:check` (CI) fails when
// that file doesn't match the database, so a schema change must regenerate it.
// After merge, publish it to the map's claude.ai page (CLAUDE.md > The database map
// page). Needs `pnpm supabase start` with every migration applied. The lanes, arrows and one-line notes come from
// layout.json; everything else (tables, columns, keys, rules) is read from Postgres.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const OUT = path.join(ROOT, "design", "database-map.html");
const CHECK = process.argv.includes("--check");
const DB_URL = process.env.DB_MAP_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SCHEMAS = ["public", "concierge", "lists", "admin"];
const layout = JSON.parse(readFileSync(path.join(HERE, "layout.json"), "utf8"));

// ---- read the database
async function readSchema() {
  const c = new pg.Client({ connectionString: DB_URL });
  try {
    await c.connect();
  } catch {
    console.error("Can't reach the local database. Start it with `pnpm supabase start`.");
    process.exit(1);
  }
  const tabs = await c.query(
    `select n.nspname s, cl.relname t, cl.oid, cl.relrowsecurity rls,
       (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = cl.relname)::int policies
     from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
     where cl.relkind = 'r' and n.nspname = any($1) order by 1, 2`,
    [SCHEMAS],
  );
  const db = {};
  for (const t of tabs.rows) {
    const cols = await c.query(
      `select a.attname c, format_type(a.atttypid, a.atttypmod) ty, a.attnotnull nn,
         pg_get_expr(d.adbin, d.adrelid) def, col_description(a.attrelid, a.attnum) cmt
       from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = $1 and a.attnum > 0 and not a.attisdropped order by a.attnum`,
      [t.oid],
    );
    const cons = await c.query(
      `select k.contype ty, pg_get_constraintdef(k.oid) def, k.conname name,
         (select array_agg(a.attname::text order by a.attnum) from pg_attribute a where a.attrelid = k.conrelid and a.attnum = any(k.conkey)) cols,
         rn.nspname || '.' || rc.relname ref, k.confdeltype del
       from pg_constraint k left join pg_class rc on rc.oid = k.confrelid left join pg_namespace rn on rn.oid = rc.relnamespace
       where k.conrelid = $1 order by k.contype, k.conname`,
      [t.oid],
    );
    db[`${t.s}.${t.t}`] = { rls: t.rls, policies: t.policies, cols: cols.rows, cons: cons.rows.map((k) => ({ ...k, cols: k.cols ?? [] })) };
  }
  await c.end();
  return db;
}

// ---- helpers
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const DEL = { c: "deleted with it", n: "cleared when it goes", a: "kept", r: "blocks deleting it", d: "set to default" };
const LANE_TITLE = { lists: "Gift lists", public: "Shared", person: "Concierge: about a person", round: "Concierge: a gift round", strip: "Accounts and the system" };

function tidy(e) {
  e = e.replace(/::(text|integer|numeric|bigint|smallint|boolean|date|timestamp with time zone|character varying|jsonb|\w+\[\])/g, "");
  for (;;) {
    if (!(e.startsWith("(") && e.endsWith(")"))) return e;
    let depth = 0, wraps = true;
    for (let i = 0; i < e.length; i++) {
      depth += e[i] === "(" ? 1 : e[i] === ")" ? -1 : 0;
      if (depth === 0 && i < e.length - 1) { wraps = false; break; }
    }
    if (!wraps) return e;
    e = e.slice(1, -1);
  }
}
function checkRule(d) {
  const m = d.match(/^CHECK \(\(?\(?(\w+) = ANY \(ARRAY\[(.*)\]\)\)?\)?\)$/);
  if (m) return `${m[1]} is one of: ${[...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]).join(", ")}`;
  return tidy(d.replace(/^CHECK /, "").trim());
}

function build(DB) {
  const fks = (t) => DB[t].cons.filter((k) => k.ty === "f");
  const owned = (t) => fks(t).some((k) => k.ref === "auth.users" && k.del === "c");
  const personal = (t) => fks(t).some((k) => k.ref === "public.people" && k.cols.includes("user_id"));

  // place every table; unknown ones go to the strip
  const known = new Set(Object.values(layout.lanes).flat());
  const unknown = Object.keys(DB).filter((t) => !known.has(t));
  const gone = [...known].filter((t) => !DB[t]);
  const lanes = Object.fromEntries(Object.entries(layout.lanes).map(([k, v]) => [k, v.filter((t) => DB[t])]));
  lanes.strip = [...lanes.strip, ...unknown];

  const W = 240, H = 48, GAP = 16, TOP = 150;
  const LX = { lists: 40, public: 440, person: 720, round: 1000 };
  const pos = {}, laneOf = {};
  const tallest = Math.max(...["lists", "public", "person", "round"].map((l) => lanes[l].length), 6);
  for (const lane of ["lists", "public", "person", "round"]) {
    let y = TOP;
    for (const t of lanes[lane]) {
      // people sits level with person_links, so the bridge between products is a straight line
      if (t === "public.people" && pos["lists.person_links"]) y = Math.max(y, pos["lists.person_links"][1]);
      pos[t] = [LX[lane], y]; laneOf[t] = lane; y += H + GAP;
    }
  }
  const SY = TOP + tallest * (H + GAP) + 76;
  lanes.strip.forEach((t, i) => { pos[t] = [40 + (i % 4) * 320, SY + Math.floor(i / 4) * (H + GAP)]; laneOf[t] = "strip"; });
  const VW = LX.round + W + 52;
  const VH = SY + Math.ceil(lanes.strip.length / 4) * (H + GAP) + 10;

  // per-table data for the panel
  const refby = Object.fromEntries(Object.keys(DB).map((t) => [t, []]));
  for (const t of Object.keys(DB)) for (const k of fks(t)) if (refby[k.ref]) refby[k.ref].push({ t, cols: k.cols });
  const sql = (t) => {
    const lines = DB[t].cols.map((c) => `  ${c.c} ${c.ty}${c.nn ? " not null" : ""}${c.def != null ? ` default ${c.def}` : ""}`);
    for (const k of DB[t].cons) if ("pfuc".includes(k.ty)) lines.push(`  constraint ${k.name} ${k.def}`);
    let out = `create table ${t} (\n${lines.join(",\n")}\n);`;
    if (DB[t].rls) out += `\nalter table ${t} enable row level security;  -- ${DB[t].policies} ${DB[t].policies === 1 ? "policy" : "policies"}`;
    return out;
  };
  const data = {};
  for (const t of Object.keys(DB)) {
    const pk = DB[t].cons.find((k) => k.ty === "p")?.cols ?? [];
    const colfk = {};
    for (const k of fks(t)) {
      // in a composite key, user_id only scopes the row to its owner; the other columns pick it
      for (const c of k.cols.filter((c) => !(c === "user_id" && k.cols.length > 1))) (colfk[c] ??= new Set()).add(k.ref);
    }
    data[t] = {
      note: layout.notes[t] ?? "", lane: LANE_TITLE[laneOf[t]], owned: owned(t), personal: personal(t),
      rls: DB[t].rls, policies: DB[t].policies,
      cols: DB[t].cols.map((c) => ({ c: c.c, ty: c.ty, req: c.nn, def: c.def, pk: pk.includes(c.c), fk: [...(colfk[c.c] ?? [])].sort(), cmt: c.cmt })),
      out: fks(t).map((k) => ({ t: k.ref, cols: k.cols, del: DEL[k.del] ?? k.del })),
      in: refby[t],
      unique: DB[t].cons.filter((k) => k.ty === "u").map((k) => k.cols),
      checks: DB[t].cons.filter((k) => k.ty === "c").map((k) => checkRule(k.def)),
      sql: sql(t),
    };
  }

  // svg
  const P = [];
  for (const lane of ["lists", "public", "person", "round"]) {
    P.push(`<text class="lane" x="${LX[lane]}" y="${TOP - 40}">${esc(LANE_TITLE[lane])}</text>`);
    P.push(`<text class="lane-sub" x="${LX[lane]}" y="${TOP - 22}">schema ${lane === "person" || lane === "round" ? "concierge" : lane}</text>`);
  }
  P.push(`<text class="lane" x="40" y="${SY - 34}">${LANE_TITLE.strip}</text>`);
  P.push(`<text class="lane-sub" x="40" y="${SY - 16}">settings, dedupe and logs; nothing above points to them</text>`);
  for (const lane of ["person", "round"]) P.push(`<line class="rule" x1="${LX[lane] - 20}" y1="${TOP - 52}" x2="${LX[lane] - 20}" y2="${SY - 62}"/>`);
  P.push(`<line class="rule" x1="40" y1="${SY - 62}" x2="${VW - 40}" y2="${SY - 62}"/>`);

  const right = (t) => [pos[t][0] + W, pos[t][1] + H / 2];
  const left = (t) => [pos[t][0], pos[t][1] + H / 2];
  const sideN = {};
  const missingEdges = [];
  for (const e of layout.edges) {
    if (!pos[e.from] || !pos[e.to]) { missingEdges.push(e); continue; }
    const [cx, cy] = pos[e.from], [, py] = pos[e.to];
    let d, lx = 0, ly = 0, anchor = "middle";
    if (e.kind === "down") { const x = cx + 30; d = `M${x} ${cy} V${py + H}`; lx = x + 8; ly = (cy + py + H) / 2 + 4; anchor = "start"; }
    else if (e.kind === "side") {
      const k = (sideN[cx] = (sideN[cx] ?? -1) + 1);
      const x = cx + W + 9 + 7 * k, ty = py + 12 + 6 * k;
      d = `M${cx + W} ${cy + H / 2 - 6} H${x} V${ty} H${cx + W}`;
    } else if (e.kind === "bridge") { const [sx, sy] = right(e.from), [tx] = left(e.to); d = `M${sx} ${sy + 6} H${tx}`; lx = (sx + tx) / 2; ly = sy - 6; }
    else { const [sx, sy] = left(e.from), [tx] = right(e.to); d = `M${sx} ${sy} H${tx}`; lx = (sx + tx) / 2; ly = sy - 8; }
    const bridge = e.kind === "bridge";
    P.push(`<path class="edge${bridge ? " bridge" : ""}" data-a="${e.from}" data-b="${e.to}" d="${d}" marker-end="url(#${bridge ? "ah-b" : "ah"})"/>`);
    if (e.label) P.push(`<text class="elabel${bridge ? " b" : ""}" data-a="${e.from}" data-b="${e.to}" x="${lx}" y="${ly}" text-anchor="${anchor}">${esc(e.label)}</text>`);
  }
  for (const [t, [x, y]] of Object.entries(pos)) {
    const name = t.split(".")[1];
    const note = layout.notes[t] ?? "";
    P.push(`<g class="tbl${layout.hubs.includes(t) ? " hub" : ""}" data-t="${t}" tabindex="0" role="button" aria-label="${esc(t)}${note ? `: ${esc(note)}` : ""}. Open its columns and definition.">`);
    P.push(`<rect x="${x}" y="${y}" width="${W}" height="${H}" rx="9"/>`);
    P.push(`<text class="tname" x="${x + 12}" y="${y + 20}">${esc(name)}</text>`);
    P.push(`<text class="tnote" x="${x + 12}" y="${y + 37}">${esc(note)}</text>`);
    let bx = x + W - 12;
    if (personal(t)) { P.push(`<circle class="b-person" cx="${bx}" cy="${y + 14}" r="5"/>`); bx -= 15; }
    if (owned(t)) P.push(`<circle class="b-user" cx="${bx}" cy="${y + 14}" r="5"/>`);
    P.push(`<text class="tcount" x="${x + W - 12}" y="${y + 37}" text-anchor="end">${DB[t].cols.length} cols</text>`);
    P.push("</g>");
  }
  const svg =
    `<svg id="map-svg" viewBox="0 0 ${VW} ${VH}" role="group" aria-label="GiftsAF database: ${Object.keys(DB).length} tables. ` +
    `Lists and the concierge share only the people table, linked through lists.person_links. Select a table to open its definition." xmlns="http://www.w3.org/2000/svg">` +
    `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 Z"/></marker>` +
    `<marker id="ah-b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="ah-b" d="M0 0 L10 5 L0 10 Z"/></marker></defs>` +
    P.join("") + "</svg>";

  // index
  const idx = [];
  for (const [s, title] of [["public", "Shared"], ["lists", "Gift lists"], ["concierge", "Gift Concierge"], ["admin", "Admin"]]) {
    const ts = Object.keys(DB).filter((t) => t.startsWith(`${s}.`)).sort();
    if (!ts.length) continue;
    idx.push(`<div class="ix"><h3><span>${title}</span> <code>${s}</code><span class="ixn">${ts.length}</span></h3><ul>`);
    for (const t of ts) idx.push(`<li><button type="button" class="ixb" data-open="${t}"><code>${esc(t.split(".")[1])}</code><span>${esc(layout.notes[t] ?? "")}</span><em>${DB[t].cols.length}</em></button></li>`);
    idx.push("</ul></div>");
  }

  const all = Object.values(DB).flatMap((t) => t.cons);
  return { svg, idx: idx.join(""), data, unknown, gone, missingEdges,
    counts: { tables: Object.keys(DB).length, schemas: new Set(Object.keys(DB).map((t) => t.split(".")[0])).size,
      fks: all.filter((k) => k.ty === "f").length, checks: all.filter((k) => k.ty === "c").length } };
}

// ---- write the page
const DB = await readSchema();
const m = build(DB);
// The page depends only on the schema (no dates, no migration names), so a migration
// that only changes data leaves it untouched and CI can diff it.
const stats =
  `<div class="stats"><span><b>${m.counts.tables}</b>tables</span><span><b>${m.counts.schemas}</b>schemas</span>` +
  `<span><b>${m.counts.fks}</b>foreign keys</span><span><b>${m.counts.checks}</b>check rules</span></div>`;
const page = readFileSync(path.join(HERE, "template.html"), "utf8")
  .replace("<!--STATS-->", stats)
  .replace("<!--SVG-->", m.svg)
  .replace("<!--INDEX-->", m.idx)
  .replace("/*DATA*/null", JSON.stringify(m.data).replace(/<\//g, "<\\/"));
if (CHECK) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch {}
  if (current !== page) {
    console.error(`design/database-map.html doesn't match the database. Run 'pnpm db:map' and commit it.`);
    process.exit(1);
  }
  console.log("design/database-map.html matches the database.");
  process.exit(0);
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, page);

console.log(`Wrote ${path.relative(ROOT, OUT)}: ${m.counts.tables} tables, ${m.counts.fks} foreign keys, ${m.counts.checks} check rules.`);
for (const t of m.unknown) console.log(`  New table ${t} is in the bottom strip with no note: add it to a lane in apps/web/scripts/db-map/layout.json and give it a note.`);
for (const t of m.gone) console.log(`  ${t} is in layout.json but not in the database: remove it from layout.json.`);
for (const e of m.missingEdges) console.log(`  Arrow ${e.from} -> ${e.to} in layout.json names a table that's gone: remove it.`);
console.log("Commit it with the migration. After the merge and a green migrate job, publish it to https://claude.ai/artifact/9uCRGGJL5Tu4X53VCYV3Rk (CLAUDE.md > The database map page).");
