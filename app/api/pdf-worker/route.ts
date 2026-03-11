import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const WORKER_PATH = path.join(process.cwd(), "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");

let cachedWorkerSource: string | null = null;

async function getWorkerSource() {
  if (cachedWorkerSource) return cachedWorkerSource;
  cachedWorkerSource = await fs.readFile(WORKER_PATH, "utf-8");
  return cachedWorkerSource;
}

export async function GET() {
  try {
    const source = await getWorkerSource();
    return new Response(source, {
      status: 200,
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400"
      }
    });
  } catch {
    return NextResponse.json({ error: "No se pudo cargar el worker de PDF.js." }, { status: 500 });
  }
}
