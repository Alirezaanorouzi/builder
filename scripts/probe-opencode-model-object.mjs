const auth =
  "Basic " + Buffer.from("opencode:builder-dev-secret").toString("base64");
const base = "http://127.0.0.1:4096";
const h = { Authorization: auth, "Content-Type": "application/json" };
const { id: sid } = await (
  await fetch(`${base}/session`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ title: "model-object-test" }),
  })
).json();

const models = [
  { providerID: "openrouter", modelID: "meta-llama/llama-3.3-70b-instruct:free" },
  { providerID: "openrouter", modelID: "openrouter/free" },
  { providerID: "openrouter", modelID: "google/gemini-2.0-flash-exp:free" },
  null,
];

for (const model of models) {
  const msgId = "msg_test" + Math.random().toString(36).slice(2);
  const body = {
    messageID: msgId,
    agent: "build",
    parts: [{ type: "text", text: "Reply OK only" }],
  };
  if (model) body.model = model;
  const r = await fetch(`${base}/session/${sid}/prompt_async`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
  const t = await r.text();
  console.log(JSON.stringify(model), "->", r.status, t.slice(0, 200));
}
