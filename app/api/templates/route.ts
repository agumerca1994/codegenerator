import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { InvoiceFieldType, Template, TemplateField } from "@/lib/types";
import { requireAuth } from "@/lib/simpleAuth";

export const runtime = "nodejs";

const TEMPLATES_DIR = path.join(process.cwd(), "context", "Plantillas");

async function ensureTemplatesDir() {
  await fs.mkdir(TEMPLATES_DIR, { recursive: true });
}

function safeSlug(raw: string) {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "template";
}

function normalizeRect(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeFieldType(type: unknown): InvoiceFieldType {
  return type === "date" || type === "number" || type === "array" ? type : "string";
}

function normalizeFields(fields: TemplateField[]): TemplateField[] {
  return fields.map((field) => ({
    ...field,
    name: String(field.name || "").trim(),
    type: normalizeFieldType(field.type),
    rect: {
      page: 1,
      x: normalizeRect(field.rect?.x ?? 0),
      y: normalizeRect(field.rect?.y ?? 0),
      w: normalizeRect(field.rect?.w ?? 0),
      h: normalizeRect(field.rect?.h ?? 0)
    },
    label: field.label?.trim() || null,
    valuePattern: field.valuePattern?.trim() || null,
    sampleValue: field.sampleValue?.trim() || null
  }));
}

export async function GET(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  await ensureTemplatesDir();
  const files = await fs.readdir(TEMPLATES_DIR);
  const templates = [];

  for (const file of files) {
    if (!file.toLowerCase().endsWith(".json")) continue;
    const fullPath = path.join(TEMPLATES_DIR, file);
    try {
      const raw = await fs.readFile(fullPath, "utf-8");
      const data = JSON.parse(raw) as Template;
      templates.push({
        id: data.id,
        provider: data.provider,
        providerCuit: data.providerCuit ?? null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt ?? null
      });
    } catch {
      // ignore invalid files
    }
  }

  templates.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  await ensureTemplatesDir();

  try {
    const payload = (await request.json()) as Partial<Template> & {
      provider?: string;
      providerCuit?: string | null;
      fields?: TemplateField[];
      sourceFileName?: string | null;
      pageSize?: { width: number; height: number } | null;
    };

    const provider = String(payload.provider || "").trim();
    if (!provider) {
      return NextResponse.json({ error: "Proveedor requerido." }, { status: 400 });
    }

    const fields = Array.isArray(payload.fields) ? normalizeFields(payload.fields).filter((field) => field.name) : [];
    if (!fields.length) {
      return NextResponse.json({ error: "Se requieren zonas/fields para guardar la plantilla." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const id = `${safeSlug(provider)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const template: Template = {
      id,
      provider,
      providerCuit: payload.providerCuit?.trim() || null,
      createdAt: now,
      updatedAt: now,
      sourceFileName: payload.sourceFileName ?? null,
      pageSize: payload.pageSize ?? null,
      fields
    };

    const filePath = path.join(TEMPLATES_DIR, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(template, null, 2), "utf-8");

    return NextResponse.json({ template });
  } catch {
    return NextResponse.json({ error: "No se pudo guardar la plantilla." }, { status: 500 });
  }
}
