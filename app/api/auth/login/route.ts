import { NextResponse } from "next/server";
import {
  createSessionToken,
  isValidCredentials,
  sessionCookieName,
  sessionMaxAge
} from "@/lib/simpleAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { username?: string; password?: string };
    const username = String(payload.username || "").trim();
    const password = String(payload.password || "");

    if (!isValidCredentials(username, password)) {
      return NextResponse.json({ error: "Usuario o clave inválidos." }, { status: 401 });
    }

    const token = createSessionToken();
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: sessionCookieName(),
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: sessionMaxAge()
    });
    return response;
  } catch {
    return NextResponse.json({ error: "No se pudo iniciar sesión." }, { status: 500 });
  }
}
