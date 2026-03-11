import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { InvoiceFieldType, Template, TemplateField } from "@/lib/types";
import { requireAuth } from "@/lib/simpleAuth";

export const runtime = "nodejs";

const TEMPLATES_DIR = path.join(process.cwd(), "context", "Plantillas");

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

export async function GET(request: Request, context: { params: { id: string } }) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const id = context.params.id;
    const filePath = path.join(TEMPLATES_DIR, `${id}.json`);
    const raw = await fs.readFile(filePath, "utf-8");
    const template = JSON.parse(raw) as Template;
    const normalizedTemplate: Template = {
      ...template,
      fields: Array.isArray(template.fields) ? normalizeFields(template.fields) : []
    };
    return NextResponse.json({ template: normalizedTemplate });
  } catch {
    return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 404 });
  }
}

export async function PUT(request: Request, context: { params: { id: string } }) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const id = context.params.id;
    const filePath = path.join(TEMPLATES_DIR, `${id}.json`);
    const currentRaw = await fs.readFile(filePath, "utf-8");
    const currentTemplate = JSON.parse(currentRaw) as Template;

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
    const template: Template = {
      id: currentTemplate.id || id,
      provider,
      providerCuit: payload.providerCuit?.trim() || null,
      createdAt: currentTemplate.createdAt || now,
      updatedAt: now,
      sourceFileName: payload.sourceFileName ?? currentTemplate.sourceFileName ?? null,
      pageSize: payload.pageSize ?? currentTemplate.pageSize ?? null,
      fields
    };

    await fs.writeFile(filePath, JSON.stringify(template, null, 2), "utf-8");

    return NextResponse.json({ template });
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 404 });
    }
    return NextResponse.json({ error: "No se pudo actualizar la plantilla." }, { status: 500 });
  }
}
