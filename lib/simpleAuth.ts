import crypto from "crypto";
import { NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "mks_auth";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

function authSecret() {
  return process.env.AUTH_SECRET || "mks-auth-dev-secret";
}

function authUsername() {
  return process.env.APP_USERNAME || "admin";
}

function authPassword() {
  return process.env.APP_PASSWORD || "mkssrl";
}

function parseCookies(header: string | null) {
  const result: Record<string, string> = {};
  if (!header) return result;
  const parts = header.split(";");
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey || rawValue.length === 0) continue;
    result[rawKey] = decodeURIComponent(rawValue.join("="));
  }
  return result;
}

function sign(data: string) {
  return crypto.createHmac("sha256", authSecret()).update(data).digest("base64url");
}

export function createSessionToken() {
  const payload = {
    u: authUsername(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function isAuthenticatedRequest(request: Request) {
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return false;

  const [encoded, providedSignature] = token.split(".");
  if (!encoded || !providedSignature) return false;

  const expectedSignature = sign(encoded);
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(providedSignature);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as {
      u?: string;
      exp?: number;
    };
    if (!payload.u || payload.u !== authUsername()) return false;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

export function requireAuth(request: Request) {
  if (isAuthenticatedRequest(request)) return null;
  return NextResponse.json({ error: "No autorizado. Inicia sesión." }, { status: 401 });
}

export function isValidCredentials(username: string, password: string) {
  const expectedUser = authUsername();
  const expectedPass = authPassword();
  return username === expectedUser && password === expectedPass;
}

export function sessionCookieName() {
  return SESSION_COOKIE_NAME;
}

export function sessionMaxAge() {
  return SESSION_TTL_SECONDS;
}

export function configuredUsername() {
  return authUsername();
}
