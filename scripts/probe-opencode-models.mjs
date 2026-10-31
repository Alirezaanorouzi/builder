const auth =
  "Basic " + Buffer.from("opencode:builder-dev-secret").toString("base64");
const base = "http://127.0.0.1:4096";
const h = { Authorization: auth, "Content-Type": "application/json" };
const { id: sid } = await (
  await fetch(`${base}/session`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ title: "model-test" }),
  })
).json();

const models = [
  "openrouter/openrouter/free",
  "openrouter/meta-llama/llama-3.3-70b-instruct:free",
  "openrouter/free",
  "openrouter/google/gemini-2.0-flash-exp:free",
  "openrouter/qwen/qwen-2.5-72b-instruct:free",
];

for (const model of models) {
  const msgId = "msg_test" + Math.random().toString(36).slice(2);
  const r = await fetch(`${base}/session/${sid}/prompt_async`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      messageID: msgId,
      agent: "build",
      model,
      parts: [{ type: "text", text: "hi" }],
    }),
  });
  const t = await r.text();
  console.log(model, "->", r.status, t.slice(0, 300));
}
