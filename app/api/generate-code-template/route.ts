import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { GeneratedCode, InvoiceField, Template } from "@/lib/types";
import { requireAuth } from "@/lib/simpleAuth";

export const runtime = "nodejs";

const TEMPLATES_DIR = path.join(process.cwd(), "context", "Plantillas");

function normalizeFieldType(type: unknown): "string" | "number" | "date" | "array" {
  return type === "date" || type === "number" || type === "array" ? type : "string";
}

function escapeRegex(source: string) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeForJsString(source: string) {
  return source.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

function buildValuePattern(templateField: Template["fields"][number]) {
  if (templateField.valuePattern) return templateField.valuePattern;
  if (templateField.name.toLowerCase().includes("cuit")) {
    return "\\b\\d{2}-?\\d{8}-?\\d\\b|\\b\\d{11}\\b";
  }
  switch (templateField.type) {
    case "date":
      return "\\b\\d{2}[\\/\\.-]\\d{2}[\\/\\.-]\\d{2,4}\\b";
    case "number":
      return "\\b\\d{1,3}(?:[\\.\\s]\\d{3})*(?:,\\d{2})\\b|\\b\\d+(?:[\\.,]\\d+)?\\b";
    default:
      return "[^\\n]+";
  }
}

function buildRegex(label: string | null | undefined, valuePattern: string) {
  if (label) {
    const safeLabel = escapeRegex(label.trim());
    const pattern = `${safeLabel}\\s*[:\\-]?\\s*(${valuePattern})`;
    return `new RegExp("${escapeForJsString(pattern)}", "i")`;
  }
  const pattern = `(${valuePattern})`;
  return `new RegExp("${escapeForJsString(pattern)}", "i")`;
}

function inferNeedsCuit(fieldName: string, valuePattern: string) {
  return fieldName.toLowerCase().includes("cuit") || /cuit/i.test(valuePattern);
}

function buildTemplateCode(template: Template) {
  const lines: string[] = [];

  lines.push("// n8n Code node (Run once for each item)");
  lines.push(`// Parser por plantilla: ${template.provider}`);
  lines.push("");
  lines.push("const it = $input.item;");
  lines.push('const raw = (it.json.texto ?? it.json.text ?? "").toString();');
  lines.push("");
  lines.push("// Normalizacion base");
  lines.push("let t = raw.replace(/\\r/g, \"\\n\").replace(/[ \\t]+/g, \" \").replace(/\\n+/g, \"\\n\").trim();");
  lines.push("");
  lines.push("function pick(re, group = 1) {");
  lines.push("  const m = t.match(re);");
  lines.push("  return m ? (m[group] || \"\").trim() : null;");
  lines.push("}");
  lines.push("function normalizeCuit(cuit) {");
  lines.push("  if (!cuit) return null;");
  lines.push("  const digits = String(cuit).replace(/[^\\d]/g, \"\");");
  lines.push("  return digits.length === 11 ? digits : null;");
  lines.push("}");
  lines.push("function parseNumberMixed(s) {");
  lines.push("  if (!s) return null;");
  lines.push("  let clean = String(s).replace(/\\$/g, \"\").replace(/\\s/g, \"\");");
  lines.push("  clean = clean.replace(/[^\\d.,-]/g, \"\");");
  lines.push("  if (!clean) return null;");
  lines.push("  const hasDot = clean.includes(\".\");");
  lines.push("  const hasComma = clean.includes(\",\");");
  lines.push("  if (hasDot && hasComma) {");
  lines.push("    const lastDot = clean.lastIndexOf(\".\");");
  lines.push("    const lastComma = clean.lastIndexOf(\",\");");
  lines.push("    const decimalIsComma = lastComma > lastDot;");
  lines.push("    if (decimalIsComma) {");
  lines.push("      clean = clean.replace(/\\./g, \"\").replace(\",\", \".\");");
  lines.push("    } else {");
  lines.push("      clean = clean.replace(/,/g, \"\");");
  lines.push("    }");
  lines.push("  } else if (hasComma && !hasDot) {");
  lines.push("    clean = clean.replace(/\\./g, \"\").replace(\",\", \".\");");
  lines.push("  } else {");
  lines.push("    clean = clean.replace(/,/g, \"\");");
  lines.push("  }");
  lines.push("  const v = Number(clean);");
  lines.push("  return Number.isFinite(v) ? v : null;");
  lines.push("}");
  lines.push("function normalizeDate_ddmmyyyy(s) {");
  lines.push("  if (!s) return null;");
  lines.push("  const m = String(s).match(/^(\\d{2})[\\/\\.-](\\d{2})[\\/\\.-](\\d{2}|\\d{4})$/);");
  lines.push("  if (!m) return s;");
  lines.push("  const dd = m[1], mm = m[2], yy = m[3];");
  lines.push("  if (yy.length === 4) return `${dd}/${mm}/${yy}`;");
  lines.push("  const yyn = Number(yy);");
  lines.push("  const yyyy = yyn <= 79 ? 2000 + yyn : 1900 + yyn;");
  lines.push("  return `${dd}/${mm}/${yyyy}`;");
  lines.push("}");
  lines.push("");

  const outputs: string[] = [];

  template.fields.forEach((field) => {
    const valuePattern = buildValuePattern(field);
    const regexExpr = buildRegex(field.label, valuePattern);
    let safeName = field.name.replace(/[^a-zA-Z0-9_]/g, "_");
    if (/^[0-9]/.test(safeName)) safeName = `_${safeName}`;
    const rawVar = `${safeName}Raw`;

    lines.push(`const ${rawVar} = pick(${regexExpr}, 1);`);

    if (field.type === "date") {
      lines.push(`const ${safeName} = ${rawVar} ? normalizeDate_ddmmyyyy(${rawVar}) : null;`);
    } else if (field.type === "number") {
      lines.push(`const ${safeName} = ${rawVar} ? parseNumberMixed(${rawVar}) : null;`);
    } else if (inferNeedsCuit(field.name, valuePattern)) {
      lines.push(`const ${safeName} = ${rawVar} ? normalizeCuit(${rawVar}) : null;`);
    } else {
      lines.push(`const ${safeName} = ${rawVar} || null;`);
    }

    outputs.push(safeName);
    lines.push("");
  });

  lines.push("return {");
  lines.push("  json: {");
  outputs.forEach((name) => {
    lines.push(`    ${name},`);
  });
  lines.push("  }");
  lines.push("};");

  return lines.join("\n");
}

export async function POST(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const payload = (await request.json()) as { templateId?: string };
    if (!payload.templateId) {
      return NextResponse.json({ error: "templateId requerido." }, { status: 400 });
    }

    const filePath = path.join(TEMPLATES_DIR, `${payload.templateId}.json`);
    const raw = await fs.readFile(filePath, "utf-8");
    const template = JSON.parse(raw) as Template;

    const fields: InvoiceField[] = template.fields.map((field) => ({
      field: field.name,
      label: field.label || field.name,
      detectedValue: field.sampleValue || "",
      type: normalizeFieldType(field.type)
    }));

    const missingLabels = template.fields.filter((field) => !field.label).length;
    const confidence = Math.max(35, Math.round(85 - missingLabels * 12));
    const issues = template.fields
      .filter((field) => !field.label)
      .map((field) => `Campo ${field.name} sin etiqueta: se usa patron global.`);

    const code = buildTemplateCode(template);

    const result: GeneratedCode = {
      provider: template.provider,
      confidence,
      fields,
      code,
      quality: issues.length
        ? {
            profile: "template",
            modelScore: 0,
            familyScore: 0,
            extractionQuality: 0,
            structureScore: 100,
            coverageScore: Math.round((fields.length / Math.max(template.fields.length, 1)) * 100),
            valueScore: 0,
            issues
          }
        : undefined
    };

    return NextResponse.json(result);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 404 });
    }
    return NextResponse.json({ error: "No se pudo generar el codigo desde la plantilla." }, { status: 500 });
  }
}
