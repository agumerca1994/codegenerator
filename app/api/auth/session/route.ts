import { NextResponse } from "next/server";
import { configuredUsername, isAuthenticatedRequest } from "@/lib/simpleAuth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }
  return NextResponse.json({
    authenticated: true,
    username: configuredUsername()
  });
}
