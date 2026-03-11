import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { Template } from "@/lib/types";
import { requireAuth } from "@/lib/simpleAuth";

export const runtime = "nodejs";

const ROOT_DIR = process.cwd();
const TEMPLATES_DIR = path.join(ROOT_DIR, "context", "Plantillas");
const CANDIDATE_DIRS = [
  path.join(ROOT_DIR, "context", "FacturasProveedores"),
  path.join(ROOT_DIR, "context", "Input")
];

async function findPdfByName(fileName: string) {
  const safeName = path.basename(fileName);
  const safeNameLower = safeName.toLowerCase();

  for (const baseDir of CANDIDATE_DIRS) {
    const candidate = path.join(baseDir, safeName);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  const contextDir = path.join(ROOT_DIR, "context");
  const queue: string[] = [contextDir];
  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) continue;

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === safeNameLower) {
        return fullPath;
      }
    }
  }

  return null;
}

export async function GET(_request: Request, context: { params: { id: string } }) {
  const unauthorized = requireAuth(_request);
  if (unauthorized) return unauthorized;

  try {
    const id = context.params.id;
    const storedPdfPath = path.join(TEMPLATES_DIR, `${id}.pdf`);

    try {
      const storedPdfBuffer = await fs.readFile(storedPdfPath);
      return new Response(storedPdfBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Cache-Control": "no-store"
        }
      });
    } catch {
      // fallback a búsqueda por nombre en plantillas viejas
    }

    const templatePath = path.join(TEMPLATES_DIR, `${id}.json`);
    const raw = await fs.readFile(templatePath, "utf-8");
    const template = JSON.parse(raw) as Template;

    const sourceFileName = String(template.sourceFileName || "").trim();
    if (!sourceFileName) {
      return NextResponse.json({ error: "La plantilla no tiene sourceFileName." }, { status: 404 });
    }

    const pdfPath = await findPdfByName(sourceFileName);
    if (!pdfPath) {
      return NextResponse.json({ error: "No se encontró el PDF base de la plantilla." }, { status: 404 });
    }

    const pdfBuffer = await fs.readFile(pdfPath);
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store"
      }
    });
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 404 });
    }
    return NextResponse.json({ error: "No se pudo cargar el PDF base de la plantilla." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: { id: string } }) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const id = context.params.id;
    const templatePath = path.join(TEMPLATES_DIR, `${id}.json`);
    await fs.access(templatePath);

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No se recibió archivo PDF." }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Archivo inválido. Solo PDF." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await fs.mkdir(TEMPLATES_DIR, { recursive: true });
    const storedPdfPath = path.join(TEMPLATES_DIR, `${id}.pdf`);
    await fs.writeFile(storedPdfPath, buffer);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 404 });
    }
    return NextResponse.json({ error: "No se pudo guardar PDF base de la plantilla." }, { status: 500 });
  }
}
