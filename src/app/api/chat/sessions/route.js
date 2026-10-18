// Dashboard Chat sessions (fork addition).
//
// Auth is handled upstream by src/dashboardGuard.js — every /api/chat/* route
// is denied by default and only reachable with the dashboard session or CLI
// token, so these handlers stay auth-agnostic on purpose.
import { NextResponse } from "next/server";
import { listChatSessions, createChatSession } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessions = await listChatSessions();
  return NextResponse.json({ sessions });
}

export async function POST() {
  const session = await createChatSession({ title: "New chat" });
  return NextResponse.json({ session }, { status: 201 });
}
