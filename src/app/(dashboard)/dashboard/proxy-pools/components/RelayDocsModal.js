"use client";

import { useState } from "react";
import { Button, Modal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const CODE_EXAMPLES = {
  nodejs: `import http from "node:http";

const PORT = process.env.PORT || 8080;
const RELAY_KEY = process.env.RELAY_KEY || "your-secret-relay-key";

const server = http.createServer(async (req, res) => {
  // 1. Authenticate with x-relay-key
  const incomingKey = req.headers["x-relay-key"];
  if (RELAY_KEY && incomingKey !== RELAY_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing x-relay-key header" }));
  }

  // 2. Extract upstream target and path
  const target = req.headers["x-relay-target"];
  const relayPath = req.headers["x-relay-path"] || "/";
  if (!target) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Missing x-relay-target header" }));
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;

  // 3. Strip internal relay headers before forwarding
  const forwardHeaders = { ...req.headers };
  delete forwardHeaders["x-relay-target"];
  delete forwardHeaders["x-relay-path"];
  delete forwardHeaders["x-relay-key"];
  delete forwardHeaders["host"];

  // 4. Forward request with streaming support
  try {
    const upstreamRes = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
      duplex: "half",
    });

    // 5. Stream response directly back to 9router
    const resHeaders = {};
    for (const [k, v] of upstreamRes.headers.entries()) resHeaders[k] = v;
    res.writeHead(upstreamRes.status, resHeaders);

    if (upstreamRes.body) {
      const reader = upstreamRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message || "Upstream fetch failed" }));
  }
});

server.listen(PORT, () => console.log(\`Relay listening on port \${PORT}\`));`,

  python: `import os
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
RELAY_KEY = os.getenv("RELAY_KEY", "your-secret-relay-key")

@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"])
async def relay_handler(request: Request, path: str = ""):
    # 1. Authenticate with x-relay-key
    incoming_key = request.headers.get("x-relay-key")
    if RELAY_KEY and incoming_key != RELAY_KEY:
        return JSONResponse(
            status_code=401,
            content={"error": "Unauthorized: Invalid or missing x-relay-key header"}
        )

    # 2. Extract upstream target and path
    target = request.headers.get("x-relay-target")
    relay_path = request.headers.get("x-relay-path", "/")
    if not target:
        return JSONResponse(status_code=400, content={"error": "Missing x-relay-target header"})

    target_url = target.rstrip("/") + relay_path

    # 3. Strip internal relay headers
    forward_headers = dict(request.headers)
    for h in ["x-relay-target", "x-relay-path", "x-relay-key", "host"]:
        forward_headers.pop(h, None)

    # 4. Stream request and response
    client = httpx.AsyncClient(timeout=120.0)
    try:
        body = await request.body() if request.method not in ["GET", "HEAD"] else None
        upstream_req = client.build_request(
            method=request.method,
            url=target_url,
            headers=forward_headers,
            content=body
        )
        upstream_res = await client.send(upstream_req, stream=True)

        async def stream_generator():
            try:
                async for chunk in upstream_res.aiter_bytes():
                    yield chunk
            finally:
                await upstream_res.aclose()
                await client.aclose()

        return StreamingResponse(
            stream_generator(),
            status_code=upstream_res.status_code,
            headers=dict(upstream_res.headers)
        )
    except Exception as e:
        await client.aclose()
        return JSONResponse(status_code=502, content={"error": str(e)})`,

  cloudflare: `export default {
  async fetch(request, env, ctx) {
    const RELAY_KEY = env.RELAY_KEY || "your-secret-relay-key";

    // 1. Authenticate with x-relay-key
    if (RELAY_KEY && request.headers.get("x-relay-key") !== RELAY_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing x-relay-key header" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    // 2. Extract target and path
    const target = request.headers.get("x-relay-target");
    const relayPath = request.headers.get("x-relay-path") || "/";
    if (!target) {
      return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const targetUrl = target.replace(/\\/$/, "") + relayPath;
    const newHeaders = new Headers(request.headers);
    newHeaders.delete("x-relay-target");
    newHeaders.delete("x-relay-path");
    newHeaders.delete("x-relay-key");
    newHeaders.delete("host");

    const init = {
      method: request.method,
      headers: newHeaders,
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }

    try {
      const response = await fetch(targetUrl, init);
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  },
};`,

  deno: `const RELAY_KEY = Deno.env.get("RELAY_KEY") || "your-secret-relay-key";

Deno.serve(async (request) => {
  // 1. Authenticate with x-relay-key
  if (RELAY_KEY && request.headers.get("x-relay-key") !== RELAY_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing x-relay-key header" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // 2. Extract target and path
  const target = request.headers.get("x-relay-target");
  const relayPath = request.headers.get("x-relay-path") || "/";
  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;
  const newHeaders = new Headers(request.headers);
  newHeaders.delete("x-relay-target");
  newHeaders.delete("x-relay-path");
  newHeaders.delete("x-relay-key");
  newHeaders.delete("host");

  const init = {
    method: request.method,
    headers: newHeaders,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    const response = await fetch(targetUrl, init);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
});`,

  docker: `# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY server.js .
ENV PORT=8080
ENV RELAY_KEY=your-secret-relay-key
EXPOSE 8080
CMD ["node", "server.js"]

# Run with:
# docker build -t my-relay .
# docker run -d -p 8080:8080 -e RELAY_KEY="my-secret-key-123" --name relay my-relay`,
};

export default function RelayDocsModal({ isOpen, onClose, onOpenAddCustom }) {
  const [activeTab, setActiveTab] = useState("overview");
  const { copied, copy } = useCopyToClipboard();

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Relay Protocol Specification & Guide"
      size="full"
    >
      <div className="flex flex-col gap-4 max-h-[75vh] overflow-y-auto pr-1">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-black/10 dark:border-white/10 pb-2">
          {[
            { id: "overview", label: "Overview & Protocol", icon: "menu_book" },
            { id: "nodejs", label: "Node.js", icon: "javascript" },
            { id: "python", label: "Python FastAPI", icon: "code" },
            { id: "cloudflare", label: "Cloudflare Worker", icon: "cloud" },
            { id: "deno", label: "Deno", icon: "terminal" },
            { id: "docker", label: "Docker", icon: "inventory_2" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? "bg-primary text-white shadow-sm"
                  : "bg-surface-2 text-text-muted hover:text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab Content */}
        {activeTab === "overview" && (
          <div className="flex flex-col gap-4 text-sm text-text-main">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">hub</span>
                <p className="font-semibold text-text-main">How a 9Router Relay Works</p>
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                A Relay is an HTTP reverse-proxy endpoint that receives outgoing AI provider requests from 9Router,
                masks your primary server IP, and forwards the payload directly to the AI service provider (OpenAI, Anthropic, Gemini, etc.).
              </p>
            </div>

            {/* Architecture diagram */}
            <div className="rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3">
              <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Request Lifecycle</p>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-mono py-2">
                <div className="rounded-md border border-black/10 dark:border-white/10 bg-surface px-3 py-2 text-center w-full sm:w-auto">
                  <p className="font-semibold">Client / IDE</p>
                  <p className="text-[10px] text-text-muted">Claude Code / Cursor</p>
                </div>
                <span className="material-symbols-outlined text-text-muted rotate-90 sm:rotate-0">arrow_forward</span>
                <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-center w-full sm:w-auto">
                  <p className="font-semibold text-primary">9Router</p>
                  <p className="text-[10px] text-text-muted">Injects relay headers</p>
                </div>
                <span className="material-symbols-outlined text-text-muted rotate-90 sm:rotate-0">arrow_forward</span>
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-center w-full sm:w-auto">
                  <p className="font-semibold text-emerald-600 dark:text-emerald-400">Your Relay</p>
                  <p className="text-[10px] text-text-muted">Strips headers & proxies</p>
                </div>
                <span className="material-symbols-outlined text-text-muted rotate-90 sm:rotate-0">arrow_forward</span>
                <div className="rounded-md border border-black/10 dark:border-white/10 bg-surface px-3 py-2 text-center w-full sm:w-auto">
                  <p className="font-semibold">AI Provider</p>
                  <p className="text-[10px] text-text-muted">Sees Relay IP only</p>
                </div>
              </div>
            </div>

            {/* Protocol headers table */}
            <div className="flex flex-col gap-2">
              <p className="font-semibold text-sm">1. Headers Sent by 9Router to the Relay</p>
              <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
                <table className="w-full text-xs text-left">
                  <thead className="bg-black/[0.03] dark:bg-white/[0.03] border-b border-black/10 dark:border-white/10 font-medium">
                    <tr>
                      <th className="py-2 px-3 font-semibold">Header</th>
                      <th className="py-2 px-3 font-semibold">Required</th>
                      <th className="py-2 px-3 font-semibold">Description</th>
                      <th className="py-2 px-3 font-semibold">Example</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                    <tr>
                      <td className="py-2 px-3 font-mono font-medium text-primary">x-relay-target</td>
                      <td className="py-2 px-3 text-red-500 font-semibold">Yes</td>
                      <td className="py-2 px-3 text-text-muted">Destination provider base protocol + domain</td>
                      <td className="py-2 px-3 font-mono text-[11px]">https://api.openai.com</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-mono font-medium text-primary">x-relay-path</td>
                      <td className="py-2 px-3 text-amber-500">Optional</td>
                      <td className="py-2 px-3 text-text-muted">Target request path and query parameters</td>
                      <td className="py-2 px-3 font-mono text-[11px]">/v1/chat/completions</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-mono font-medium text-primary">x-relay-key</td>
                      <td className="py-2 px-3 text-red-500 font-semibold">Yes</td>
                      <td className="py-2 px-3 text-text-muted">Secret authentication key configured in 9Router</td>
                      <td className="py-2 px-3 font-mono text-[11px]">my-secret-key-123</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-mono font-medium text-text-muted">* (Other headers)</td>
                      <td className="py-2 px-3 text-text-muted">Passthrough</td>
                      <td className="py-2 px-3 text-text-muted">Client Authorization, Content-Type, anthropic-version, etc.</td>
                      <td className="py-2 px-3 font-mono text-[11px]">Bearer sk-...</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Checklist */}
            <div className="flex flex-col gap-2">
              <p className="font-semibold text-sm">2. What Your Relay Must Do</p>
              <ul className="text-xs text-text-muted space-y-1.5 list-disc pl-4">
                <li><strong className="text-text-main">Authenticate:</strong> Compare incoming <code className="px-1 py-0.5 rounded bg-surface-2 font-mono text-primary">x-relay-key</code> against your secret token. Return <strong className="text-text-main">401 Unauthorized</strong> if mismatched.</li>
                <li><strong className="text-text-main">Reconstruct Target URL:</strong> Concatenate <code className="px-1 py-0.5 rounded bg-surface-2 font-mono">target.replace(/\/$/, "") + relayPath</code>.</li>
                <li><strong className="text-text-main">Strip Relay Headers:</strong> Always delete <code className="px-1 py-0.5 rounded bg-surface-2 font-mono">x-relay-target</code>, <code className="px-1 py-0.5 rounded bg-surface-2 font-mono">x-relay-path</code>, <code className="px-1 py-0.5 rounded bg-surface-2 font-mono">x-relay-key</code>, and <code className="px-1 py-0.5 rounded bg-surface-2 font-mono">host</code> before forwarding to upstream.</li>
                <li><strong className="text-text-main">Support Streaming:</strong> Ensure request and response bodies are streamed without buffering (SSE chunks must pass immediately to prevent client timeouts). In Fetch APIs, set <code className="px-1 py-0.5 rounded bg-surface-2 font-mono">duplex: "half"</code>.</li>
                <li><strong className="text-text-main">Error Handling:</strong> If the connection to the provider fails, return <strong className="text-text-main">502 Bad Gateway</strong> with JSON error details.</li>
              </ul>
            </div>

            {/* Manual test command */}
            <div className="flex flex-col gap-1.5">
              <p className="font-semibold text-sm">3. Testing via Terminal (cURL)</p>
              <div className="relative rounded-lg bg-zinc-950 p-3 text-zinc-100 font-mono text-xs overflow-x-auto">
                <button
                  onClick={() => copy(`curl -i -X GET "https://your-relay-domain.com/" -H "x-relay-target: https://httpbin.org" -H "x-relay-path: /get" -H "x-relay-key: your-secret-key"`, "curl")}
                  className="absolute right-2 top-2 p-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-[11px] flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {copied === "curl" ? "check" : "content_copy"}
                  </span>
                  {copied === "curl" ? "Copied" : "Copy"}
                </button>
                <pre>{`curl -i -X GET "https://your-relay-domain.com/" \\
  -H "x-relay-target: https://httpbin.org" \\
  -H "x-relay-path: /get" \\
  -H "x-relay-key: your-secret-key"`}</pre>
              </div>
            </div>
          </div>
        )}

        {/* Code Tabs */}
        {activeTab !== "overview" && CODE_EXAMPLES[activeTab] && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-muted">
                Copy and run this server on your VPS, serverless edge, or Docker host:
              </p>
              <Button
                size="sm"
                variant="secondary"
                icon={copied === activeTab ? "check" : "content_copy"}
                onClick={() => copy(CODE_EXAMPLES[activeTab], activeTab)}
              >
                {copied === activeTab ? "Copied!" : "Copy Code"}
              </Button>
            </div>
            <div className="rounded-xl bg-zinc-950 p-4 text-zinc-100 font-mono text-xs overflow-x-auto max-h-[480px]">
              <pre>{CODE_EXAMPLES[activeTab]}</pre>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="mt-2 pt-3 border-t border-black/10 dark:border-white/10 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-text-muted">
            Ready to connect your relay?
          </p>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {onOpenAddCustom && (
              <Button
                size="sm"
                icon="add"
                onClick={() => {
                  onClose();
                  onOpenAddCustom();
                }}
              >
                Add Custom Relay Now
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
