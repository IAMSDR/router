import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GITHUB_CHANGELOG_URL = "https://raw.githubusercontent.com/IAMSDR/router/refs/heads/master/CHANGELOG.md";

async function getLocalChangelog() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.join(process.cwd(), "CHANGELOG.md"),
    path.join(process.cwd(), "..", "CHANGELOG.md"),
    path.resolve(currentDir, "../../../../../CHANGELOG.md"),
    path.resolve("CHANGELOG.md"),
  ];

  for (const filePath of candidatePaths) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      if (content && content.trim()) {
        return content;
      }
    } catch {
      // Try next candidate path
    }
  }
  return null;
}

async function getRemoteChangelog() {
  try {
    const res = await fetch(GITHUB_CHANGELOG_URL, {
      headers: { "User-Agent": "router-app" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.trim()) {
        return text;
      }
    }
  } catch (err) {
    console.log("Failed to fetch remote changelog fallback:", err.message);
  }
  return null;
}

export async function GET() {
  try {
    let markdown = await getLocalChangelog();
    if (!markdown) {
      markdown = await getRemoteChangelog();
    }

    if (!markdown) {
      return new NextResponse("Failed to load changelog", { status: 404 });
    }

    return new NextResponse(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.log("Error serving changelog:", error);
    return new NextResponse("Error loading changelog", { status: 500 });
  }
}
