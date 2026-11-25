// Reads every resource and prompt from the built server.
import { check, connect, finish } from "./lib.mjs";

const { client, call } = await connect();
await call("create_document", { width: 400, height: 300 });
const { resources } = await client.listResources();
check("resources listed", resources.length >= 10, `${resources.length}`);
for (const r of resources) {
  const res = await client.readResource({ uri: r.uri });
  let ok = false;
  try { ok = Boolean(JSON.parse(res.contents[0].text)); } catch { ok = false; }
  check(`read ${r.uri}`, ok);
}
const { prompts } = await client.listPrompts();
check("prompts listed", prompts.length >= 8);
for (const p of prompts) {
  const got = await client.getPrompt({ name: p.name, arguments: {} });
  check(`prompt ${p.name}`, got.messages[0]?.content?.text?.length > 50);
}
await client.close();
finish();
