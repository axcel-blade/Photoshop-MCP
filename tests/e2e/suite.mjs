// End-to-end over stdio against the built server. Default: mock adapter (CI). E2E_ADAPTER=auto: real Photoshop.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { check, connect, finish, OUT } from "./lib.mjs";

const stamp = Date.now();
const { client, call } = await connect();
const { tools } = await client.listTools();
check("lists tools", tools.length >= 250, `${tools.length}`);

const st = await call("photoshop_status");
check("status ok", st.body.ok && typeof st.body.data.adapter === "string", JSON.stringify(st.body).slice(0, 200));

const doc = await call("create_document", { name: "e2e", width: 1200, height: 800 });
check("create_document", doc.body.ok && doc.body.data.document.width === 1200);
check("source labelled", ["mock", "photoshop"].includes(doc.body.source));

const poster = await call("create_poster", { brief: 'Bold event poster, headline "E2E Poster", CTA "Go"' });
check("create_poster", poster.body.ok, poster.body.error?.message);

const text = await call("add_text", { text: "Hello", x: 600, y: 400, size: 64 });
check("add_text", text.body.data?.layer?.kind === "text");

const adj = await call("adjust_curves", { points: [{ input: 0, output: 0 }, { input: 128, output: 150 }, { input: 255, output: 255 }] });
check("adjust_curves", adj.body.ok);

const prev = await call("capture_preview", { maxSize: 256 });
check("capture_preview returns an image", prev.images === 1);

const png = join(OUT, `e2e-${stamp}.png`);
const ex = await call("export_png", { path: png });
check("export_png writes a file", ex.body.ok && existsSync(png));
const again = await call("export_png", { path: png });
check("no silent overwrite", again.isError && again.body.error.code === "FILE_EXISTS");

const out = await call("open_document", { path: "C:\\Windows\\win.ini" });
check("path sandbox", out.isError && ["PATH_NOT_ALLOWED", "VALIDATION_ERROR"].includes(out.body.error.code));

const del = await call("flatten_document", {});
check("destructive needs confirm", del.body.error?.code === "CONFIRMATION_REQUIRED");

const liq = await call("apply_liquify", {});
check("unsupported is honest", liq.body.error?.code === "UNSUPPORTED_OPERATION");

const plan = await call("plan_workflow", { brief: 'bold youtube thumbnail "Top 10 Tips" export png' });
check("plan_workflow", plan.body.data?.size?.width === 1280 && plan.body.data.steps.length > 5);

await client.close();
finish();
