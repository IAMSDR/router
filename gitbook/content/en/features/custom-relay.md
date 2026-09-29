# Custom & Self-Hosted Relays

A 9Router Relay is a lightweight reverse-proxy endpoint that forwards AI provider requests through intermediate servers or edge platforms. Relays mask your primary server's IP address, distribute requests across multiple geographical regions, and bypass geographic restrictions.

---

## What is a Relay?

Unlike traditional HTTP/SOCKS5 forward proxies that require raw TCP socket tunneling (`CONNECT` method), a **9Router Relay** operates as an HTTP reverse-proxy layer:

```
[Client / CLI]
       │
       ▼
  [9Router]
       │  (HTTP POST with x-relay-target & x-relay-key headers)
       ▼
 [Custom Relay] ── (Self-hosted VPS, Docker, Serverless Edge)
       │  (Forwards request directly to provider)
       ▼
[AI Provider] (OpenAI, Anthropic, Gemini, DeepSeek...)
```

### Benefits

1. **IP Diversity & Anonymity**: Upstream AI providers only see the Relay server's IP address.
2. **Multi-Platform Support**: Deploy anywhere — a $2.50/month VPS, Docker container, Cloudflare Worker, Vercel Edge, Deno Deploy, Fly.io, or AWS Lambda.
3. **No Complex Proxy Software**: No need to configure Squid, Dante, or shadowsocks. A relay can be built in ~35 lines of Node.js or Python code.
4. **Secure Authentication**: Protected with a shared secret key passed via `x-relay-key` header.

---

## Relay Protocol Specification

When 9Router routes a request through a relay, it invokes your relay's base URL and passes the destination details in HTTP headers.

### 1. Route Requirements

- Your relay must accept requests on a catch-all route (`/*` or root `/`).
- All HTTP methods must be supported (`POST`, `GET`, `OPTIONS`, `HEAD`, `PUT`, `DELETE`). Most AI requests use `POST` (chat completions, embeddings) and `GET` (model lists, quota checks).

### 2. Request Headers Sent by 9Router

| Header | Description | Example |
| :--- | :--- | :--- |
| `x-relay-target` | Base protocol and domain of target AI provider | `https://api.openai.com` |
| `x-relay-path` | Path and query string of the target API call | `/v1/chat/completions` |
| `x-relay-key` | Secret authentication key configured in 9Router | `your-secret-relay-token` |
| *Original Headers* | Client headers forwarded as-is (`Authorization`, `Content-Type`, `anthropic-version`, etc.) | `Bearer sk-proj-...` |

### 3. Relay Implementation Checklist

Every compliant relay implementation must follow these steps:

1. **Authenticate**: Read `x-relay-key`. If the key is missing or does not match your configured secret, return `HTTP 401 Unauthorized`:
   ```json
   { "error": "Unauthorized: Invalid or missing x-relay-key header" }
   ```
2. **Extract Target**: Read `x-relay-target`. If missing, return `HTTP 400 Bad Request`:
   ```json
   { "error": "Missing x-relay-target header" }
   ```
   Read `x-relay-path` (fallback to `/` if missing).
3. **Construct Target URL**:
   ```javascript
   const targetUrl = target.replace(/\/$/, "") + relayPath;
   ```
4. **Sanitize Headers**: Strip internal relay headers before forwarding upstream:
   - Delete `x-relay-target`
   - Delete `x-relay-path`
   - Delete `x-relay-key`
   - Delete `host` (allow HTTP client to set the upstream host header)
5. **Forward Request & Stream Response**:
   - Forward HTTP method, headers, and request body.
   - Support streaming (`duplex: "half"` in Node / Fetch).
   - Return upstream response status, headers, and body unbuffered back to 9Router.
6. **Error Handling**: If upstream is unreachable (DNS error, connection timeout), return `HTTP 502 Bad Gateway`:
   ```json
   { "error": "Upstream connection failed" }
   ```

---

## Testing Your Relay

### In-App Test Before Adding

In the 9Router Dashboard:
1. Go to **Proxy Pools**.
2. Click **Deploy Relay** → **Custom / Self-Hosted Relay**.
3. Enter your **Relay URL** and **Relay Key**.
4. Click **Test Relay**.
5. 9Router will send a probe request targeting `https://httpbin.org/get` through your relay. If successful, latency (e.g. `120ms`) will be displayed before you save.

### Command-Line Test (cURL)

You can also test your relay directly from your terminal:

```bash
curl -X GET "https://your-relay-domain.com/" \
  -H "x-relay-target: https://httpbin.org" \
  -H "x-relay-path: /get" \
  -H "x-relay-key: your-secret-relay-key"
```

If configured correctly, you should receive httpbin's JSON response containing origin IP details.

---

## Ready-to-Use Code Templates

### 1. Node.js (Express / Native Fetch)

Requires Node.js 18+ (no external dependencies needed):

```javascript
import http from "node:http";

const PORT = process.env.PORT || 8080;
const RELAY_KEY = process.env.RELAY_KEY || "change-this-secret-key";

const server = http.createServer(async (req, res) => {
  // 1. Authenticate
  const incomingKey = req.headers["x-relay-key"];
  if (RELAY_KEY && incomingKey !== RELAY_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Unauthorized: Invalid x-relay-key" }));
  }

  // 2. Extract target
  const target = req.headers["x-relay-target"];
  const relayPath = req.headers["x-relay-path"] || "/";
  if (!target) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Missing x-relay-target header" }));
  }

  const targetUrl = target.replace(/\/$/, "") + relayPath;

  // 3. Clean headers
  const forwardHeaders = { ...req.headers };
  delete forwardHeaders["x-relay-target"];
  delete forwardHeaders["x-relay-path"];
  delete forwardHeaders["x-relay-key"];
  delete forwardHeaders["host"];

  // 4. Forward request
  try {
    const upstreamRes = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
      duplex: "half",
    });

    // 5. Pipe response
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

server.listen(PORT, () => console.log(`Relay listening on port ${PORT}`));
```

---

### 2. Python (FastAPI + httpx)

```python
import os
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
RELAY_KEY = os.getenv("RELAY_KEY", "change-this-secret-key")

@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"])
async def relay_handler(request: Request, path: str = ""):
    # 1. Authenticate
    incoming_key = request.headers.get("x-relay-key")
    if RELAY_KEY and incoming_key != RELAY_KEY:
        return JSONResponse(status_code=401, content={"error": "Unauthorized: Invalid x-relay-key"})

    # 2. Extract target
    target = request.headers.get("x-relay-target")
    relay_path = request.headers.get("x-relay-path", "/")
    if not target:
        return JSONResponse(status_code=400, content={"error": "Missing x-relay-target header"})

    target_url = target.rstrip("/") + relay_path

    # 3. Clean headers
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
        return JSONResponse(status_code=502, content={"error": str(e)})
```

---

### 3. Cloudflare Worker

```javascript
export default {
  async fetch(request, env, ctx) {
    const RELAY_KEY = env.RELAY_KEY || "change-this-secret-key";

    // 1. Authenticate
    if (RELAY_KEY && request.headers.get("x-relay-key") !== RELAY_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid x-relay-key" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    // 2. Validate target
    const target = request.headers.get("x-relay-target");
    const relayPath = request.headers.get("x-relay-path") || "/";
    if (!target) {
      return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const targetUrl = target.replace(/\/$/, "") + relayPath;
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
};
```

---

### 4. Deno Deploy

```typescript
const RELAY_KEY = Deno.env.get("RELAY_KEY") || "change-this-secret-key";

Deno.serve(async (request) => {
  // 1. Authenticate
  if (RELAY_KEY && request.headers.get("x-relay-key") !== RELAY_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized: Invalid x-relay-key" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // 2. Validate target
  const target = request.headers.get("x-relay-target");
  const relayPath = request.headers.get("x-relay-path") || "/";
  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const targetUrl = target.replace(/\/$/, "") + relayPath;
  const newHeaders = new Headers(request.headers);
  newHeaders.delete("x-relay-target");
  newHeaders.delete("x-relay-path");
  newHeaders.delete("x-relay-key");
  newHeaders.delete("host");

  const init: RequestInit = {
    method: request.method,
    headers: newHeaders,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // @ts-ignore duplex is required for Deno streaming
    init.duplex = "half";
  }

  try {
    const response = await fetch(targetUrl, init);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
});
```

---

### 5. Docker Deployment

Deploy on any VPS using Docker:

**`Dockerfile`**:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY server.js .
ENV PORT=8080
ENV RELAY_KEY=your-secret-relay-key
EXPOSE 8080
CMD ["node", "server.js"]
```

**Run command**:
```bash
docker build -t custom-relay .
docker run -d -p 8080:8080 -e RELAY_KEY="my-secret-key-123" --name my-relay custom-relay
```
