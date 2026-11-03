/**
 * Loopback-only dashboard for the local VideoExpress runner.
 *
 * The browser is the only long-lived resource, so there is one Agent and one
 * browser window. Every route below changes that one run; the operator watches
 * the same state over SSE.
 */
import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Agent, planSummary, unitsFromPlan } from "./lib/agent.js";
import { parseBrief } from "./lib/brief-parser.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4318;
const agent = new Agent();
const clients = new Set();
let frameBusy = false;

function preview(text) {
  const parsed = parseBrief(text);
  return {
    ok: (parsed.problems || []).length === 0 && Boolean(parsed.plan?.scenes?.length),
    summary: planSummary(parsed),
    units: unitsFromPlan(parsed.plan).map(({ id, label, kind }) => ({ id, label, kind })),
  };
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
}

async function body(req, limit = 2_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("request is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function localHost(req) {
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(req.headers.host || ""));
}

function localOrigin(req) {
  const origin = req.headers.origin;
  return !origin || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(origin));
}

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

async function handle(req, res) {
  if (!localHost(req)) return sendJson(res, 403, { error: "loopback only" });
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");
    clients.add(res);
    res.write(`data: ${JSON.stringify({ type: "state", state: agent.snapshot() })}\n\n`);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    return sendJson(res, 200, agent.snapshot());
  }

  if (req.method === "GET" && url.pathname === "/api/example") {
    const text = await readFile(path.join(ROOT, "briefs", "example.md"), "utf8");
    return sendJson(res, 200, { text });
  }

  if (req.method === "GET" && url.pathname === "/api/models") {
    await agent.refreshModels(true);
    return sendJson(res, 200, agent.snapshot());
  }

  if (STATIC[url.pathname] && req.method === "GET") {
    const [file, mime] = STATIC[url.pathname];
    const content = await readFile(path.join(ROOT, "public", file));
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
    return res.end(content);
  }

  if (req.method !== "POST") return sendJson(res, 404, { error: "not found" });
  if (!localOrigin(req)) return sendJson(res, 403, { error: "local origin required" });

  let data;
  try {
    data = await body(req);
  } catch (error) {
    return sendJson(res, 400, { error: String(error?.message || error) });
  }

  try {
    if (url.pathname === "/api/brief") {
      if (typeof data.text !== "string") throw new Error("send the brief as text");
      return sendJson(res, 200, preview(data.text));
    }

    if (url.pathname === "/api/model") {
      const primary = String(data.primary || "julia");
      const fallback = String(data.fallback || "");
      for (const id of [primary, fallback].filter(Boolean)) {
        if (!["julia", "d1"].includes(id)) throw new Error(`unknown decision model "${id}"`);
      }
      agent.settings.primary = primary;
      agent.settings.fallback = fallback || null;
      agent.settings.autoFallback = data.autoFallback !== false;
      if (typeof data.reviewImages === "boolean") agent.settings.reviewImages = data.reviewImages;
      await agent.refreshModels(true);
      broadcast({ type: "state", state: agent.snapshot() });
      return sendJson(res, 200, agent.snapshot());
    }

    if (url.pathname === "/api/start") {
      if (typeof data.text !== "string") throw new Error("send the brief as text");
      await agent.prepare(data.text);
      await agent.open();
      broadcast({ type: "state", state: agent.snapshot() });
      return sendJson(res, 200, agent.snapshot());
    }

    if (url.pathname === "/api/open") {
      await agent.open();
      broadcast({ type: "state", state: agent.snapshot() });
      return sendJson(res, 200, agent.snapshot());
    }

    if (url.pathname === "/api/step") {
      await agent.stepOnce();
      broadcast({ type: "state", state: agent.snapshot() });
      return sendJson(res, 200, agent.snapshot());
    }

    if (url.pathname === "/api/run") {
      if (!agent.plan) throw new Error("load a brief first");
      agent.startRun().catch(() => {});
      return sendJson(res, 202, agent.snapshot());
    }

    if (url.pathname === "/api/pause") {
      agent.pause();
      broadcast({ type: "state", state: agent.snapshot() });
      return sendJson(res, 200, agent.snapshot());
    }

    if (url.pathname === "/api/stop") {
      agent.stop();
      broadcast({ type: "state", state: agent.snapshot() });
      return sendJson(res, 200, agent.snapshot());
    }

    if (url.pathname === "/api/reset") {
      agent.reset();
      broadcast({ type: "state", state: agent.snapshot() });
      return sendJson(res, 200, agent.snapshot());
    }

    if (url.pathname === "/api/close") {
      await agent.closeBrowser();
      broadcast({ type: "state", state: agent.snapshot() });
      return sendJson(res, 200, agent.snapshot());
    }

    return sendJson(res, 404, { error: "not found" });
  } catch (error) {
    const message = String(error?.message || error);
    broadcast({ type: "state", state: agent.snapshot() });
    return sendJson(res, 400, { error: message, state: agent.snapshot() });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    if (!res.headersSent) sendJson(res, 500, { error: String(error?.message || error) });
    else res.end();
  });
});

let lastObservation = 0;
async function tick() {
  if (agent.driver.open) {
    if (!frameBusy) {
      frameBusy = true;
      agent.driver
        .screenshot()
        .then((data) => {
          if (data) broadcast({ type: "frame", data });
        })
        .catch(() => {})
        .finally(() => {
          frameBusy = false;
        });
    }
    if (Date.now() - lastObservation > 3000) {
      lastObservation = Date.now();
      await agent.refreshObservation().catch(() => {});
    }
  }
  broadcast({ type: "state", state: agent.snapshot() });
}

setInterval(() => tick().catch(() => {}), 1200).unref?.();
setInterval(() => agent.refreshModels().catch(() => {}), 15000).unref?.();

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Jev local: http://127.0.0.1:${PORT}`);
  agent.refreshModels(true).catch(() => {});
});
