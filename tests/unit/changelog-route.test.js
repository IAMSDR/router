import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/version/changelog/route.js";

describe("GET /api/version/changelog", () => {
  it("returns markdown content containing fork release versions", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");

    const text = await res.text();
    expect(text).toContain("# v0.1.5");
    expect(text).toContain("# v0.1.4");
    expect(text).toContain("# v0.1.3");
    expect(text).toContain("# v0.1.2");
    expect(text).toContain("# v0.1.1");
    expect(text).toContain("# v0.1.0");
    // Also contains upstream sync history below
    expect(text).toContain("# v0.5.91");
  });
});
