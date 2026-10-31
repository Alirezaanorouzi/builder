const user = process.env.OPENCODE_SERVER_USERNAME || "opencode";
const pass = process.env.OPENCODE_SERVER_PASSWORD || "builder-dev-secret";
const base = (process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096").replace(/\/$/, "");
const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
function parseModel(slug) {
  const s = slug || "openrouter/openrouter/free";
  const i = s.indexOf("/");
  if (i === -1) return { providerID: s, modelID: s };
  return { providerID: s.slice(0, i), modelID: s.slice(i + 1) };
}
const model = parseModel(process.env.OPENCODE_MODEL);

const h = { Authorization: auth, "Content-Type": "application/json" };

function parseSseBlock(block) {
  let eventName = "message";
  let dataLine = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
  }
  return { eventName, dataLine };
}

const session = await (
  await fetch(`${base}/session`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ title: "evt-test" }),
  })
).json();
const sid = session.id;
console.log("session", sid, "model", JSON.stringify(model));

const msgId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
const ac = new AbortController();
setTimeout(() => ac.abort(), 12000);

const ssePromise = (async () => {
  for (const path of ["/event", "/global/event"]) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: auth, Accept: "text/event-stream" },
        signal: ac.signal,
      });
      if (!res.ok) {
        console.log(path, "status", res.status);
        continue;
      }
      console.log("listening on", path);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let n = 0;
      while (n < 20) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const block of parts) {
          if (!block.trim()) continue;
          n++;
          const { eventName, dataLine } = parseSseBlock(block);
          console.log(`--- [${path}] #${n} event=${eventName}`);
          console.log(dataLine.slice(0, 400));
        }
      }
      return;
    } catch (e) {
      if (e.name !== "AbortError") console.log(path, e.message);
    }
  }
})();

const promptRes = await fetch(`${base}/session/${sid}/prompt_async`, {
  method: "POST",
  headers: h,
  body: JSON.stringify({
    messageID: msgId,
    agent: "build",
    model,
    parts: [{ type: "text", text: "Reply with exactly: OK" }],
  }),
});
console.log("prompt_async", promptRes.status, promptRes.statusText);

for (let i = 0; i < 6; i++) {
  const st = await (await fetch(`${base}/session/status`, { headers: { Authorization: auth } })).json();
  console.log("status entry", JSON.stringify(st[sid]));
  await new Promise((r) => setTimeout(r, 1500));
}

await ssePromise.catch(() => {});
