import { NextResponse } from "next/server";
import OpenAI from "openai";
import { Script, createContext } from "node:vm";
import type { GeneratedCode, InvoiceField, QualityBreakdown } from "@/lib/types";

export const runtime = "nodejs";

type FieldType = "string" | "number" | "date" | "array";
type InvoiceFamily = "afip_standard" | "alba_seguros" | "direct_number" | "generic";
type ProfileStatus = "stable" | "draft";

interface TargetFieldSpec {
  key: keyof StrictInvoiceDraft;
  type: FieldType;
  required: boolean;
  description: string;
}

interface ExtractionContext {
  raw: string;
  normalizedText: string;
  lines: string[];
  extractionQuality: number;
  extractionIssues: string[];
}

interface FileNameHints {
  emisorCUIT: string | null;
  puntoVenta: string | null;
  numeroComprobante: string | null;
  comprobante: string | null;
}

interface ClassificationResult {
  family: InvoiceFamily;
  profile: string;
  profileStatus: ProfileStatus;
  familyScore: number;
  providerHint: string | null;
  reasons: string[];
}

interface StrictConcept {
  cantidad: number | null;
  descripcion: string | null;
  precioUnitario: number | null;
  bonifPorc: number | null;
  ivaPorc: number | null;
  importe: number | null;
}

interface StrictInvoiceDraft {
  tipoComprobante: string | null;
  tipoFactura: string | null;
  comprobante: string | null;
  puntoVenta: string | null;
  numeroComprobante: string | null;
  fecha: string | null;
  vencimiento: string | null;
  emisorNombre: string | null;
  emisorCUIT: string | null;
  clienteNombre: string | null;
  clienteCUIT: string | null;
  condicionIVA: string | null;
  cae: string | null;
  vencCae: string | null;
  ivaPorc: number | null;
  bonificacion: number | null;
  netoGravado: number | null;
  iva27: number | null;
  iva21: number | null;
  iva105: number | null;
  iva5: number | null;
  iva25: number | null;
  iva0: number | null;
  total: number | null;
  conceptos: StrictConcept[];
  invoiceKey: string;
}

type DraftStringKey =
  | "tipoComprobante"
  | "tipoFactura"
  | "comprobante"
  | "puntoVenta"
  | "numeroComprobante"
  | "fecha"
  | "vencimiento"
  | "emisorNombre"
  | "emisorCUIT"
  | "clienteNombre"
  | "clienteCUIT"
  | "condicionIVA"
  | "cae"
  | "vencCae";

type DraftDateKey = "fecha" | "vencimiento" | "vencCae";

type DraftNumberKey =
  | "ivaPorc"
  | "bonificacion"
  | "netoGravado"
  | "iva27"
  | "iva21"
  | "iva105"
  | "iva5"
  | "iva25"
  | "iva0"
  | "total";

interface CandidateEvaluation {
  source: string;
  code: string;
  draft: StrictInvoiceDraft;
  quality: QualityBreakdown;
  confidence: number;
}

const TARGET_SCHEMA: TargetFieldSpec[] = [
  { key: "tipoComprobante", type: "string", required: true, description: "Tipo de comprobante" },
  { key: "tipoFactura", type: "string", required: false, description: "Letra de factura" },
  { key: "comprobante", type: "string", required: true, description: "Comprobante 0000-00000000" },
  { key: "puntoVenta", type: "string", required: true, description: "Punto de venta 4 digitos" },
  { key: "numeroComprobante", type: "string", required: true, description: "Numero de comprobante" },
  { key: "fecha", type: "date", required: true, description: "Fecha emision" },
  { key: "vencimiento", type: "date", required: false, description: "Fecha vencimiento" },
  { key: "emisorNombre", type: "string", required: false, description: "Nombre emisor" },
  { key: "emisorCUIT", type: "string", required: true, description: "CUIT emisor" },
  { key: "clienteNombre", type: "string", required: false, description: "Nombre cliente" },
  { key: "clienteCUIT", type: "string", required: true, description: "CUIT cliente" },
  { key: "condicionIVA", type: "string", required: false, description: "Condicion IVA" },
  { key: "cae", type: "string", required: true, description: "CAE" },
  { key: "vencCae", type: "date", required: false, description: "Vencimiento CAE" },
  { key: "ivaPorc", type: "number", required: false, description: "Porcentaje IVA" },
  { key: "bonificacion", type: "number", required: false, description: "Bonificacion" },
  { key: "netoGravado", type: "number", required: true, description: "Importe neto gravado" },
  { key: "iva27", type: "number", required: false, description: "IVA 27" },
  { key: "iva21", type: "number", required: true, description: "IVA 21" },
  { key: "iva105", type: "number", required: false, description: "IVA 10.5" },
  { key: "iva5", type: "number", required: false, description: "IVA 5" },
  { key: "iva25", type: "number", required: false, description: "IVA 2.5" },
  { key: "iva0", type: "number", required: false, description: "IVA 0" },
  { key: "total", type: "number", required: true, description: "Importe total" },
  { key: "conceptos", type: "array", required: true, description: "Conceptos de la factura" },
  { key: "invoiceKey", type: "string", required: true, description: "Clave anti duplicados" }
];

const DEFAULT_MODEL = "gpt-5.3-codex";
const FALLBACK_MODEL = "gpt-4o";

const LABELS: Record<keyof StrictInvoiceDraft, string> = TARGET_SCHEMA.reduce((acc, item) => {
  acc[item.key] = item.description;
  return acc;
}, {} as Record<keyof StrictInvoiceDraft, string>);

function createEmptyDraft(): StrictInvoiceDraft {
  return {
    tipoComprobante: null,
    tipoFactura: null,
    comprobante: null,
    puntoVenta: null,
    numeroComprobante: null,
    fecha: null,
    vencimiento: null,
    emisorNombre: null,
    emisorCUIT: null,
    clienteNombre: null,
    clienteCUIT: null,
    condicionIVA: null,
    cae: null,
    vencCae: null,
    ivaPorc: null,
    bonificacion: null,
    netoGravado: null,
    iva27: null,
    iva21: null,
    iva105: null,
    iva5: null,
    iva25: null,
    iva0: null,
    total: null,
    conceptos: [],
    invoiceKey: ""
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeJson(raw: string): string {
  return raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "").trim();
}

function sanitizeCode(raw: string): string {
  return raw.replace(/^```(?:javascript|js)?\s*/i, "").replace(/```$/, "").trim();
}

function normalizeInputText(raw: string): string {
  const normalized = raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();

  return normalized
    .split("\n")
    .map((line) => line.replace(/\b(?:[A-Za-zÁÉÍÓÚÑÜ][ \t]+){2,}[A-Za-zÁÉÍÓÚÑÜ]\b/g, (token) => token.replace(/[ \t]+/g, "")))
    .join("\n");
}

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildLooseSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/.\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirstNumericToken(text: string): string | null {
  const match = text.match(/-?\d[\d\.,]*/);
  return match ? match[0] : null;
}

function extractAmountTokens(text: string): string[] {
  const matches = Array.from(
    text.matchAll(/-?(?:\d{1,3}(?:[.\s]\d{3})+,\d{2}|\d+,\d{2})\b/g)
  );
  return matches.map((match) => match[0]).filter((value) => value.length > 0);
}

function pick(text: string, re: RegExp, group = 1): string | null {
  const m = text.match(re);
  if (!m) return null;
  const value = m[group] ?? "";
  const clean = value.trim();
  return clean.length > 0 ? clean : null;
}

function pickAll(text: string, re: RegExp, group = 1): string[] {
  const matches = Array.from(text.matchAll(re));
  return matches
    .map((match) => (match[group] ?? "").trim())
    .filter((value) => value.length > 0);
}

function normalizeCuit(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

function parseMixedNumber(raw: string | null): number | null {
  if (!raw) return null;
  let clean = raw.replace(/\$/g, "").replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  if (!clean) return null;

  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      clean = clean.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    if (/,\d{2}$/.test(clean)) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      clean = clean.replace(/,/g, "");
    }
  } else if ((clean.match(/\./g) || []).length > 1) {
    clean = clean.replace(/\./g, "");
  }

  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

function parsePercent(raw: string | null): number | null {
  if (!raw) return null;
  const normalized = raw.replace("%", "").trim();
  const value = parseMixedNumber(normalized);
  return Number.isFinite(value ?? NaN) ? value : null;
}

function pickDateNearLabel(lines: string[], label: RegExp, lookAhead = 2): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!label.test(line)) continue;

    const same = line.match(/\b(\d{2}[\/\.-]\d{2}[\/\.-]\d{2,4})\b/);
    if (same) {
      const normalized = normalizeDate(same[1]);
      if (normalized) return normalized;
    }

    for (let offset = 1; offset <= lookAhead; offset += 1) {
      const next = lines[index + offset] ?? "";
      const candidate = next.match(/\b(\d{2}[\/\.-]\d{2}[\/\.-]\d{2,4})\b/);
      if (!candidate) continue;
      const normalized = normalizeDate(candidate[1]);
      if (normalized) return normalized;
    }
  }
  return null;
}

function pickNumberNearLabel(lines: string[], label: RegExp, lookAhead = 2): number | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!label.test(line)) continue;

    const sameLine = parseMixedNumber(extractFirstNumericToken(line));
    if (sameLine !== null) return sameLine;

    for (let offset = 1; offset <= lookAhead; offset += 1) {
      const next = lines[index + offset] ?? "";
      const candidate = parseMixedNumber(extractFirstNumericToken(next));
      if (candidate !== null) return candidate;
    }
  }
  return null;
}

function pickLastAmount(text: string): number | null {
  const tokens = extractAmountTokens(text);
  if (tokens.length === 0) return null;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const parsed = parseMixedNumber(tokens[index]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function pickAmountAfterLabel(text: string, label: RegExp, lookAhead = 120): number | null {
  const m = text.match(label);
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length;
  const slice = text.slice(start, start + lookAhead);
  const token = slice.match(/-?(?:\d{1,3}(?:[.\s]\d{3})+,\d{2}|\d+,\d{2}|\d+(?:\.\d{2})?)/);
  return parseMixedNumber(token?.[0] ?? null);
}

function pickDigitsAfterLabel(text: string, label: RegExp, minDigits: number, maxDigits: number, lookAhead = 120): string | null {
  const m = text.match(label);
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length;
  const slice = text.slice(start, start + lookAhead);
  const token = slice.match(new RegExp(`(?:\\d[\\s.\\-]*){${minDigits},${maxDigits}}`));
  if (!token) return null;
  const digits = token[0].replace(/\D/g, "");
  if (digits.length < minDigits || digits.length > maxDigits) return null;
  return digits;
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const full = raw.match(/^(\d{2})[\/\.-](\d{2})[\/\.-](\d{4})$/);
  if (full) return `${full[1]}/${full[2]}/${full[3]}`;

  const short = raw.match(/^(\d{2})[\/\.-](\d{2})[\/\.-](\d{2})$/);
  if (!short) return null;
  const yy = Number(short[3]);
  const yyyy = yy <= 79 ? 2000 + yy : 1900 + yy;
  return `${short[1]}/${short[2]}/${String(yyyy)}`;
}

function cleanTextValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 0 ? clean : null;
}

function cleanNumberValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    return parseMixedNumber(value);
  }
  return null;
}

function sanitizeConcepts(value: unknown): StrictConcept[] {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .map((item): StrictConcept | null => {
      if (!isRecord(item)) return null;
      const descripcion = cleanTextValue(item.descripcion);
      const cantidad = cleanNumberValue(item.cantidad);
      const precioUnitario = cleanNumberValue(item.precioUnitario);
      const bonifPorc = cleanNumberValue(item.bonifPorc);
      const ivaPorc = cleanNumberValue(item.ivaPorc);
      const importe = cleanNumberValue(item.importe);

      if (!descripcion && cantidad === null && precioUnitario === null && importe === null) {
        return null;
      }

      return {
        cantidad,
        descripcion,
        precioUnitario,
        bonifPorc,
        ivaPorc,
        importe
      };
    })
    .filter((item): item is StrictConcept => item !== null);

  const seen = new Set<string>();
  const deduped: StrictConcept[] = [];
  for (const concept of normalized) {
    const signature = `${concept.descripcion ?? ""}|${concept.importe ?? ""}|${concept.cantidad ?? ""}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(concept);
  }

  return deduped;
}

function buildInvoiceKey(draft: StrictInvoiceDraft): string {
  return [
    draft.emisorCUIT ?? "",
    draft.tipoComprobante ?? "",
    draft.tipoFactura ?? "",
    draft.numeroComprobante ?? "",
    draft.fecha ?? "",
    draft.total ?? ""
  ].join("|");
}

function parseFileNameHints(fileName: string | null): FileNameHints {
  if (!fileName) {
    return {
      emisorCUIT: null,
      puntoVenta: null,
      numeroComprobante: null,
      comprobante: null
    };
  }

  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  const normalized = baseName.replace(/\s+/g, "");
  const match = normalized.match(/(\d{11})[_-]\d{2,3}[_-](\d{4,5})[_-](\d{8})/i);

  if (!match) {
    return {
      emisorCUIT: null,
      puntoVenta: null,
      numeroComprobante: null,
      comprobante: null
    };
  }

  const emisorCUIT = normalizeCuit(match[1]);
  const puntoVenta = match[2].padStart(5, "0").slice(-5);
  const numeroComprobante = match[3].padStart(8, "0").slice(-8);

  return {
    emisorCUIT,
    puntoVenta,
    numeroComprobante,
    comprobante: `${puntoVenta}-${numeroComprobante}`
  };
}

function applyFileNameHints(draft: StrictInvoiceDraft, hints: FileNameHints): StrictInvoiceDraft {
  if (!hints.comprobante && !hints.emisorCUIT) return draft;

  return toStrictDraft({
    ...draft,
    emisorCUIT: draft.emisorCUIT || hints.emisorCUIT,
    comprobante: draft.comprobante || hints.comprobante,
    puntoVenta: draft.puntoVenta || hints.puntoVenta,
    numeroComprobante: draft.numeroComprobante || hints.numeroComprobante
  });
}

function toStrictDraft(candidate: Partial<StrictInvoiceDraft>): StrictInvoiceDraft {
  const draft = createEmptyDraft();

  const stringKeys: DraftStringKey[] = [
    "tipoComprobante",
    "tipoFactura",
    "comprobante",
    "puntoVenta",
    "numeroComprobante",
    "fecha",
    "vencimiento",
    "emisorNombre",
    "emisorCUIT",
    "clienteNombre",
    "clienteCUIT",
    "condicionIVA",
    "cae",
    "vencCae"
  ];

  const dateKeys: DraftDateKey[] = ["fecha", "vencimiento", "vencCae"];

  const numberKeys: DraftNumberKey[] = [
    "ivaPorc",
    "bonificacion",
    "netoGravado",
    "iva27",
    "iva21",
    "iva105",
    "iva5",
    "iva25",
    "iva0",
    "total"
  ];

  for (const key of stringKeys) {
    draft[key] = cleanTextValue(candidate[key]);
  }

  for (const key of dateKeys) {
    const normalized = normalizeDate(cleanTextValue(candidate[key]));
    draft[key] = normalized;
  }

  for (const key of numberKeys) {
    draft[key] = cleanNumberValue(candidate[key]);
  }

  draft.emisorCUIT = normalizeCuit(draft.emisorCUIT);
  draft.clienteCUIT = normalizeCuit(draft.clienteCUIT);
  draft.conceptos = sanitizeConcepts(candidate.conceptos);

  const currentInvoiceKey = cleanTextValue(candidate.invoiceKey);
  draft.invoiceKey = currentInvoiceKey ?? "";

  if (!draft.comprobante && draft.puntoVenta && draft.numeroComprobante) {
    draft.comprobante = `${draft.puntoVenta}-${draft.numeroComprobante}`;
  }
  if (!draft.puntoVenta && draft.comprobante) {
    draft.puntoVenta = draft.comprobante.split("-")[0] ?? null;
  }
  if (!draft.numeroComprobante && draft.comprobante) {
    draft.numeroComprobante = draft.comprobante.split("-")[1] ?? null;
  }

  if (!draft.tipoComprobante && /FACTURA/i.test(draft.comprobante ?? "")) {
    draft.tipoComprobante = "FACTURA";
  }

  if (!draft.invoiceKey || /(undefined|null|nan)/i.test(draft.invoiceKey)) {
    draft.invoiceKey = buildInvoiceKey(draft);
  }

  return draft;
}

function preprocessText(raw: string): ExtractionContext {
  const normalizedText = normalizeInputText(raw);
  const lines = splitLines(normalizedText);

  const extractionIssues: string[] = [];
  let extractionQuality = 100;

  if (normalizedText.length < 300) {
    extractionQuality -= 30;
    extractionIssues.push("Texto extraido demasiado corto");
  }
  if (lines.length < 12) {
    extractionQuality -= 20;
    extractionIssues.push("Pocas lineas detectadas");
  }

  const nonPrintable = (normalizedText.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  if (nonPrintable > 0) {
    extractionQuality -= Math.min(15, nonPrintable);
    extractionIssues.push("Texto con caracteres de control");
  }

  if (!/\b(CUIT|CAE|Factura|FACTURA)\b/.test(normalizedText)) {
    extractionQuality -= 20;
    extractionIssues.push("Faltan marcadores comunes de factura");
  }

  extractionQuality = clamp(extractionQuality);

  return {
    raw,
    normalizedText,
    lines,
    extractionQuality,
    extractionIssues: Array.from(new Set(extractionIssues))
  };
}

function resolveProviderHint(text: string): string | null {
  if (/albacaucion|alba\s+compa/i.test(text)) {
    return "ALBA Compañía Argentina de Seguros S.A.";
  }

  const razonSocial = pick(text, /\bRaz[oó]n\s+Social:\s*([^\n]+)\b/i);
  if (razonSocial) return razonSocial;

  const firstUpper = pick(text, /(?:^|\n)([A-ZÁÉÍÓÚÑ"'\.\-\s]{8,})\n(?:COD\.|CUIT|FACTURA)/m, 1);
  return firstUpper;
}

function classifyInvoiceFamily(text: string): ClassificationResult {
  const reasons: string[] = [];
  const providerHint = resolveProviderHint(text);
  const search = buildLooseSearchText(text);

  if (/albacaucion|alba\s+compa/i.test(text) || (/\bTOMADOR\b/i.test(text) && /\bASEGURADO\b/i.test(text) && /P[óo]liza/i.test(text))) {
    reasons.push("Patron de seguros ALBA/TOMADOR/ASEGURADO detectado");
    return {
      family: "alba_seguros",
      profile: "alba",
      profileStatus: "stable",
      familyScore: 95,
      providerHint,
      reasons
    };
  }

  const hasPointOfSale =
    /\bPunto\s*de\s*Venta\s*[:\-]?\s*\d{1,5}\b/i.test(text) ||
    /\bpunto\s+de\s+v(?:enta|ta)\s+\d{1,5}\b/i.test(search) ||
    /\bpv\s+\d{1,5}\b/i.test(search);
  const hasCompNumber =
    /\bComp\.?\s*Nro\.?\s*[:\-]?\s*\d{1,8}\b/i.test(text) ||
    /\bcomp(?:robante)?\.?\s*(?:nro|numero|n)\.?\s+\d{1,8}\b/i.test(search);
  const hasCae =
    /\bCAE\b[^\d\n]{0,24}\d{10,20}\b/i.test(text) ||
    /\bcae(?:\s+n)?\s+\d{10,20}\b/i.test(search);
  const hasAfipHeaders =
    (/\bRaz[oó]n\s+Social:\b/i.test(text) &&
      /\bFecha\s+de\s+Emisi[oó]n:\b/i.test(text) &&
      /\bCondici[oó]n\s+frente\s+al\s+IVA:\b/i.test(text)) ||
    (search.includes("razon social") && search.includes("fecha de emision") && search.includes("condicion frente al iva"));

  if ((hasPointOfSale && hasCompNumber) || (hasCompNumber && hasCae) || (hasAfipHeaders && (hasPointOfSale || hasCompNumber || hasCae))) {
    reasons.push("Patron AFIP Punto de Venta / Comp. Nro detectado");
    return {
      family: "afip_standard",
      profile: "afip-standard",
      profileStatus: "stable",
      familyScore: 92,
      providerHint,
      reasons
    };
  }

  if (/\b\d{4,5}-\d{8}\b/.test(text)) {
    reasons.push("Comprobante directo 0000-00000000 detectado");
    return {
      family: "direct_number",
      profile: "direct-number",
      profileStatus: "stable",
      familyScore: 78,
      providerHint,
      reasons
    };
  }

  reasons.push("Layout no clasificado, se usa familia generica");
  return {
    family: "generic",
    profile: "generic-draft",
    profileStatus: "draft",
    familyScore: 58,
    providerHint,
    reasons
  };
}

function extractAllCuits(text: string): string[] {
  const byLabel = pickAll(text, /\bC\.?U\.?I\.?T\.?[: ]+([0-9\-]{11,13})\b/gi);
  const normalized = byLabel
    .map((raw) => normalizeCuit(raw))
    .filter((raw): raw is string => typeof raw === "string");
  return Array.from(new Set(normalized));
}

function buildBaseConcepts(text: string, ivaPorc: number | null): StrictConcept[] {
  const concepts: StrictConcept[] = [];

  const addAmountConcept = (label: string, re: RegExp) => {
    const amount = parseMixedNumber(pick(text, re));
    if (amount === null) return;
    concepts.push({
      cantidad: 1,
      descripcion: label,
      precioUnitario: null,
      bonifPorc: null,
      ivaPorc,
      importe: amount
    });
  };

  addAmountConcept("Impuestos y Tasas", /\bImpuestos\s+y\s+Tasas:?\s*\$?\s*([\d\.,]+)/i);
  addAmountConcept("Percepción IIBB", /\bPercepci[oó]n\s*IIBB\s*\([^\)]*\)\s*([\d\.,]+)/i);
  addAmountConcept("Gastos", /\bGastos:?\s*\$?\s*([\d\.,]+)/i);

  const sellados = Array.from(text.matchAll(/^(?<label>(?:prov(?:incia)?\.?)[^\n]*?\bsellado\b)\s+(?<amount>[\d\.,]+)$/gim));
  for (const match of sellados) {
    const label = cleanTextValue(match.groups?.label ?? null);
    const amount = parseMixedNumber(match.groups?.amount ?? null);
    if (!label || amount === null) continue;
    concepts.push({
      cantidad: 1,
      descripcion: label,
      precioUnitario: null,
      bonifPorc: null,
      ivaPorc,
      importe: amount
    });
  }

  return sanitizeConcepts(concepts);
}

function extractAfipTableConcepts(lines: string[], ivaPorc: number | null): StrictConcept[] {
  const concepts: StrictConcept[] = [];
  const start = lines.findIndex((line) => /(C[oó]digo|Producto\/Servicio|Descripci[oó]n)\b/i.test(line));
  if (start === -1) return concepts;

  let end = lines.findIndex((line, idx) => idx > start && /(Subtotal|Importe Neto Gravado|Importe Total)/i.test(line));
  if (end === -1) end = Math.min(lines.length, start + 30);

  for (let i = start + 1; i < end; i += 1) {
    const current = lines[i] ?? "";
    const merged = `${current} ${lines[i + 1] ?? ""}`.trim();

    const row =
      merged.match(/^(.+?)\s+(\d+(?:[\.,]\d+)?)\s+(?:[A-Za-z]+)?\s*([\d\.,]+)\s+([\d\.,]+)\s+([\d\.,]+)\s+([\d\.,]+)$/) ||
      current.match(/^(.+?)\s+(\d+(?:[\.,]\d+)?)\s+(?:[A-Za-z]+)?\s*([\d\.,]+)\s+([\d\.,]+)\s+([\d\.,]+)\s+([\d\.,]+)$/);

    if (!row) continue;

    const descripcion = cleanTextValue(row[1]);
    const cantidad = parseMixedNumber(row[2]);
    const precioUnitario = parseMixedNumber(row[3]);
    const bonifPorc = parseMixedNumber(row[4]);
    const ivaFromLine = parsePercent(row[5]);
    const importe = parseMixedNumber(row[6]);

    concepts.push({
      cantidad,
      descripcion,
      precioUnitario,
      bonifPorc,
      ivaPorc: ivaFromLine ?? ivaPorc,
      importe
    });
  }

  return sanitizeConcepts(concepts);
}

function parseGenericDraft(ctx: ExtractionContext): StrictInvoiceDraft {
  const text = ctx.normalizedText;
  const search = buildLooseSearchText(text);
  const lines = ctx.lines;

  const comprobanteFromPair =
    text.match(
      /\bPunto\s*de\s*V(?:enta|ta)\s*[:\-]?\s*(\d{1,5})[^\d\n]{0,40}Comp(?:robante)?\.?\s*(?:Nro|N[°ºo])\.?\s*[:\-]?\s*(\d{1,8})\b/i
    ) ||
    text.match(
      /\bComp(?:robante)?\.?\s*(?:Nro|N[°ºo])\.?\s*[:\-]?\s*(\d{1,8})[^\d\n]{0,40}Punto\s*de\s*V(?:enta|ta)\s*[:\-]?\s*(\d{1,5})\b/i
    );
  const loosePair =
    search.match(/\bpunto\s+de\s+v(?:enta|ta)\s+(\d{1,5})\s+comp(?:robante)?\.?\s*(?:nro|numero|n)\.?\s+(\d{1,8})\b/i) ||
    search.match(/\bcomp(?:robante)?\.?\s*(?:nro|numero|n)\.?\s+(\d{1,8})\s+punto\s+de\s+v(?:enta|ta)\s+(\d{1,5})\b/i) ||
    text.match(/\b(\d{4,5})\D{1,24}(\d{8})\b/);

  const directComprobante = pick(text, /\b(\d{4,5}-\d{8})\b/);
  const pointOfSaleRaw =
    (comprobanteFromPair ? (comprobanteFromPair[1]?.length <= 5 ? comprobanteFromPair[1] : comprobanteFromPair[2]) : null) ||
    (loosePair ? (loosePair[1]?.length <= 5 ? loosePair[1] : loosePair[2]) : null) ||
    pick(text, /\bPunto\s*de\s*Venta\s*[:\-]?\s*(\d{1,5})\b/i) ||
    pick(text, /\bPunto\s*de\s*Vta\s*[:\-]?\s*(\d{1,5})\b/i) ||
    pick(search, /\bpunto\s+de\s+v(?:enta|ta)\s+(\d{1,5})\b/i) ||
    pick(text, /\bPV\s*[:\-]?\s*(\d{1,5})\b/i);
  const compNroRaw =
    (comprobanteFromPair ? (comprobanteFromPair[1]?.length > 5 ? comprobanteFromPair[1] : comprobanteFromPair[2]) : null) ||
    (loosePair ? (loosePair[1]?.length > 5 ? loosePair[1] : loosePair[2]) : null) ||
    pick(text, /\bComp\.?\s*Nro\.?\s*[:\-]?\s*(\d{1,8})\b/i) ||
    pick(text, /\bComprobante\.?\s*Nro\.?\s*[:\-]?\s*(\d{1,8})\b/i) ||
    pick(search, /\bcomp(?:robante)?\.?\s*(?:nro|numero|n)\.?\s+(\d{1,8})\b/i) ||
    pick(text, /\bNro\.?\s*Comprobante\s*[:\-]?\s*(\d{1,8})\b/i) ||
    pick(text, /\bN[°ºo]\s*:\s*(\d{4}-\d{8})\b/i)?.split("-")[1] ||
    null;

  const pointOfSale = pointOfSaleRaw ? pointOfSaleRaw.padStart(5, "0").slice(-5) : null;
  const compNro = compNroRaw ? compNroRaw.padStart(8, "0").slice(-8) : null;

  const allCuits = extractAllCuits(text);

  const tipoComprobante = /\bFactura\b/i.test(text)
    ? "FACTURA"
    : pick(text, /\b(RECIBO|NOTA\s+DE\s+CR[ÉE]DITO|NOTA\s+DE\s+D[ÉE]BITO)\b/i);

  const tipoFactura =
    pick(text, /\bFACTURA\b[\s\S]{0,80}\b([ABCM])\b/i) ||
    pick(text, /(?:^|\n)\s*([ABCM])\s*(?:\n|$)/im);

  const comprobante = directComprobante || (pointOfSale && compNro ? `${pointOfSale}-${compNro}` : null);

  const fecha =
    normalizeDate(pick(text, /\bFecha\s+de\s+Emisi[oó]n:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i)) ||
    normalizeDate(pick(text, /\bFecha\s*de\s*Emisi[oó]n[^\d\n]{0,18}(\d{2}[\/\.-]\d{2}[\/\.-]\d{2,4})\b/i)) ||
    normalizeDate(pick(text, /\bFecha\s+Emisi[oó]n:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i)) ||
    normalizeDate(pick(text, /\bFecha:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i)) ||
    normalizeDate(pick(search, /\bfecha\s+de\s+emision\s+(\d{2}[\/\.-]\d{2}[\/\.-]\d{2,4})\b/i)) ||
    pickDateNearLabel(lines, /\bFecha\s+de\s+Emisi[oó]n\b/i, 2) ||
    pickDateNearLabel(lines, /\bFecha\b/i, 3) ||
    normalizeDate(pick(text, /\b(\d{2}[\/\.-]\d{2}[\/\.-]\d{4})\b/i)) ||
    normalizeDate(pick(text, /\b(\d{2}[\/\.-]\d{2}[\/\.-]\d{2})\b/i));

  const vencimiento =
    normalizeDate(pick(text, /\bPer[ií]odo\s+\d{2}\/\d{2}\/\d{2,4}\s+al\s+(\d{2}\/\d{2}\/\d{2,4})\b/i)) ||
    normalizeDate(pick(text, /\bFecha\s+de\s+Vto\.\s*para\s+el\s+pago:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i)) ||
    normalizeDate(pick(text, /\bFecha\s+de\s+Vencimiento:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i)) ||
    normalizeDate(pick(text, /\bVencimiento:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i));

  const emisorCUIT =
    normalizeCuit(pick(text, /\bC\.?U\.?I\.?T\.?[: ]+([0-9\-]{11,13})\b/i)) ||
    allCuits[0] ||
    null;

  const clienteCUIT =
    normalizeCuit(pick(text, /\bCUIT:\s*(\d{11})\s+Apellido\s+y\s+Nombre/i)) ||
    normalizeCuit(pick(text, /\bCUIT:\s*(\d{11})\s+I\.?V\.?A/i)) ||
    (allCuits.length > 1 ? allCuits[1] : allCuits[0] ?? null);

  const emisorNombre =
    (/www\.albacaucion\.com\.ar/i.test(text) ? "albacaucion" : null) ||
    pick(text, /\bRaz[oó]n\s+Social:\s*([^\n]+?)(?:\s+Fecha\s+de\s+Emisi[oó]n|\n)/i) ||
    pick(text, /\bRaz[oó]n\s+Social:\s*([^\n]+)/i);

  const clienteNombre =
    pick(text, /\bApellido\s+y\s+Nombre\s*\/\s*Raz[oó]n\s+Social:\s*([^\n]+)/i) ||
    pick(text, /\bTOMADOR\s*\n([^\n]+)/i) ||
    pick(text, /\bASEGURADO\s*\n([^\n]+)/i);

  let condicionIVA =
    pick(text, /\bCondici[oó]n\s+frente\s+al\s+IVA:\s*([^\n]+)/i) ||
    pick(text, /\bI\.?V\.?A\.:\s*([^\n]+)/i) ||
    pick(text, /\bIVA\s+Responsable\s+Inscripto\b/i, 0);

  if (condicionIVA && /Fecha\s+de\s+Inicio/i.test(condicionIVA)) {
    condicionIVA = condicionIVA.split(/Fecha\s+de\s+Inicio/i)[0]?.trim() ?? null;
  }

  const cae =
    pick(text, /\bCAE\s*N[°º]?:\s*(\d{10,20})\b/i) ||
    pick(text, /\bCAE:\s*(\d{10,20})\b/i) ||
    pick(text, /\bC\.?A\.?E\.?\s*N?[°º]?\s*[:\-]?\s*(\d{10,20})\b/i) ||
    pick(text, /\bCAE\b[^\d\n]{0,24}(\d{10,20})\b/i) ||
    pickDigitsAfterLabel(text, /\bCAE\b/i, 10, 20) ||
    pick(search, /\bcae(?:\s+n)?\s+(\d{10,20})\b/i) ||
    pick(text, /(?:^|\D)(\d{14})(?:\D|$)/);
  const vencCae =
    normalizeDate(pick(text, /\bFecha\s+de\s+Vto\.\s+de\s+CAE:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i)) ||
    normalizeDate(pick(text, /\bFecha\s+de\s+Vencimiento:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i));

  const ivaPorc =
    parsePercent(pick(text, /\bI\.?V\.?A\s*\(\s*([0-9]+(?:[\.,][0-9]+)?)\s*%\s*\)/i)) ||
    parsePercent(pick(text, /\bIVA\s+([0-9]+(?:[\.,][0-9]+)?)\s*%/i));

  const netoGravado =
    parseMixedNumber(pick(text, /\bImporte\s+Neto\s+Gravado:\s*\$?\s*([\d\.,]+)/i)) ||
    parseMixedNumber(pick(text, /\bSubtotal:?\s*\$?\s*([\d\.,]+)/i)) ||
    pickAmountAfterLabel(text, /\bImporte\s+Neto\s+Gravado\b/i) ||
    pickNumberNearLabel(lines, /\bImporte\s+Neto\s+Gravado\b/i, 2) ||
    pickNumberNearLabel(lines, /\bSubtotal\b/i, 2);

  const iva21 =
    parseMixedNumber(pick(text, /\bIVA\s*21(?:[\.,]00)?%:\s*\$?\s*([\d\.,]+)/i)) ||
    parseMixedNumber(pick(text, /\bI\.?V\.?A\s*\(21,00%\)\s*([\d\.,]+)/i)) ||
    pickAmountAfterLabel(text, /\bIVA\s*21(?:[.,]00)?%?\b/i) ||
    pickNumberNearLabel(lines, /\bIVA\s*21(?:[.,]00)?%?\b/i, 2);

  const total =
    parseMixedNumber(pick(text, /\bImporte\s+Total:\s*\$?\s*([\d\.,]+)/i)) ||
    parseMixedNumber(pick(text, /\bTOTAL\s+en\s+PESOS\b[^\d\n]*\n?\s*([\d\.,]+)/i)) ||
    pickAmountAfterLabel(text, /\bImporte\s+Total\b/i) ||
    pickAmountAfterLabel(text, /\bTOTAL\s+en\s+PESOS\b/i) ||
    pickNumberNearLabel(lines, /\bImporte\s+Total\b/i, 2) ||
    pickNumberNearLabel(lines, /\bTOTAL\b/i, 2) ||
    pickLastAmount(text);

  const concepts = buildBaseConcepts(text, ivaPorc);

  const tipoFacturaDetected =
    tipoFactura || pick(text, /(?:^|\n)\s*([ABCM])\s*(?:\n|$)/im) || null;

  const resolvedIvaPorc = ivaPorc ?? (tipoFacturaDetected === "C" ? 0 : 21);
  const resolvedIva21 = iva21 ?? (tipoFacturaDetected === "C" ? 0 : null);
  const resolvedNeto = netoGravado ?? (tipoFacturaDetected === "C" ? total : null);

  const fallbackConceptos =
    concepts.length > 0
      ? concepts
      : [
          {
            cantidad: 1,
            descripcion:
              pick(text, /\bConcepto\/s?:\s*([^\n]+)/i) ||
              pick(text, /\bProducto\/Servicio:\s*([^\n]+)/i) ||
              "Servicio",
            precioUnitario: null,
            bonifPorc: null,
            ivaPorc: resolvedIvaPorc,
            importe: total ?? resolvedNeto ?? null
          }
        ];

  return toStrictDraft({
    tipoComprobante,
    tipoFactura: tipoFacturaDetected,
    comprobante,
    puntoVenta: pointOfSale || (comprobante ? comprobante.split("-")[0] : null),
    numeroComprobante: compNro || (comprobante ? comprobante.split("-")[1] : null),
    fecha,
    vencimiento,
    emisorNombre,
    emisorCUIT,
    clienteNombre,
    clienteCUIT,
    condicionIVA,
    cae,
    vencCae,
    ivaPorc: resolvedIvaPorc,
    bonificacion: null,
    netoGravado: resolvedNeto,
    iva27: parseMixedNumber(pick(text, /\bIVA\s*27(?:[\.,]00)?%:\s*\$?\s*([\d\.,]+)/i)),
    iva21: resolvedIva21,
    iva105: parseMixedNumber(pick(text, /\bIVA\s*10(?:[\.,]5)?%:\s*\$?\s*([\d\.,]+)/i)),
    iva5: parseMixedNumber(pick(text, /\bIVA\s*5(?:[\.,]00)?%:\s*\$?\s*([\d\.,]+)/i)),
    iva25: parseMixedNumber(pick(text, /\bIVA\s*2(?:[\.,]5)?%:\s*\$?\s*([\d\.,]+)/i)),
    iva0: parseMixedNumber(pick(text, /\bIVA\s*0(?:[\.,]00)?%:\s*\$?\s*([\d\.,]+)/i)),
    total,
    conceptos: fallbackConceptos,
    invoiceKey: ""
  });
}

function applyAfipFamily(base: StrictInvoiceDraft, ctx: ExtractionContext): StrictInvoiceDraft {
  const text = ctx.normalizedText;
  const search = buildLooseSearchText(text);
  const lines = ctx.lines;
  const allCuits = extractAllCuits(text);
  const pair =
    text.match(
      /\bPunto\s*de\s*V(?:enta|ta)\s*[:\-]?\s*(\d{1,5})[^\d\n]{0,40}Comp(?:robante)?\.?\s*(?:Nro|N[°ºo])\.?\s*[:\-]?\s*(\d{1,8})\b/i
    ) ||
    text.match(
      /\bComp(?:robante)?\.?\s*(?:Nro|N[°ºo])\.?\s*[:\-]?\s*(\d{1,8})[^\d\n]{0,40}Punto\s*de\s*V(?:enta|ta)\s*[:\-]?\s*(\d{1,5})\b/i
    );
  const loosePair =
    search.match(/\bpunto\s+de\s+v(?:enta|ta)\s+(\d{1,5})\s+comp(?:robante)?\.?\s*(?:nro|numero|n)\.?\s+(\d{1,8})\b/i) ||
    search.match(/\bcomp(?:robante)?\.?\s*(?:nro|numero|n)\.?\s+(\d{1,8})\s+punto\s+de\s+v(?:enta|ta)\s+(\d{1,5})\b/i) ||
    text.match(/\b(\d{4,5})\D{1,24}(\d{8})\b/);
  const tableConcepts = extractAfipTableConcepts(ctx.lines, base.ivaPorc ?? 21);

  const afipConcept = pick(text, /\bConcepto\/s?:\s*([^\n]+)/i);
  const fallbackConcepts = [
    {
      cantidad: 1,
      descripcion: afipConcept || "Servicio",
      precioUnitario: null,
      bonifPorc: null,
      ivaPorc: base.ivaPorc ?? (base.tipoFactura === "C" ? 0 : 21),
      importe: base.total ?? base.netoGravado ?? null
    }
  ];

  return toStrictDraft({
    ...base,
    tipoComprobante: base.tipoComprobante ?? "FACTURA",
    tipoFactura:
      base.tipoFactura ||
      pick(text, /(?:^|\n)\s*([ABCM])\s*\n\s*FACTURA\b/im) ||
      pick(text, /\bFACTURA\s+([ABCM])\b/i),
    comprobante:
      base.comprobante ||
      (() => {
        const pv =
          (pair ? (pair[1]?.length <= 5 ? pair[1] : pair[2]) : null) ||
          (loosePair ? (loosePair[1]?.length <= 5 ? loosePair[1] : loosePair[2]) : null) ||
          pick(text, /\bPunto\s*de\s*Venta\s*[:\-]?\s*(\d{1,5})\b/i) ||
          pick(text, /\bPunto\s*de\s*Vta\s*[:\-]?\s*(\d{1,5})\b/i) ||
          pick(search, /\bpunto\s+de\s+v(?:enta|ta)\s+(\d{1,5})\b/i);
        const nc =
          (pair ? (pair[1]?.length > 5 ? pair[1] : pair[2]) : null) ||
          (loosePair ? (loosePair[1]?.length > 5 ? loosePair[1] : loosePair[2]) : null) ||
          pick(text, /\bComp\.?\s*Nro\.?\s*[:\-]?\s*(\d{1,8})\b/i) ||
          pick(text, /\bComprobante\.?\s*Nro\.?\s*[:\-]?\s*(\d{1,8})\b/i) ||
          pick(search, /\bcomp(?:robante)?\.?\s*(?:nro|numero|n)\.?\s+(\d{1,8})\b/i);
        return pv && nc ? `${pv.padStart(5, "0").slice(-5)}-${nc.padStart(8, "0").slice(-8)}` : null;
      })(),
    emisorNombre:
      base.emisorNombre ||
      pick(text, /\bRaz[oó]n\s+Social:\s*([^\n]+?)(?:\s+Fecha\s+de\s+Emisi[oó]n|\n)/i) ||
      pick(text, /\bRaz[oó]n\s+Social:\s*([^\n]+)/i),
    emisorCUIT:
      base.emisorCUIT ||
      normalizeCuit(pick(text, /\bC\.?U\.?I\.?T\.?[: ]+([0-9\-]{11,13})\b/i)) ||
      allCuits[0] ||
      null,
    clienteNombre:
      base.clienteNombre ||
      pick(text, /\bApellido\s+y\s+Nombre\s*\/\s*Raz[oó]n\s+Social:\s*([^\n]+)/i),
    clienteCUIT:
      base.clienteCUIT ||
      normalizeCuit(pick(text, /\bCUIT:\s*(\d{11})\s+Apellido\s+y\s+Nombre/i)) ||
      normalizeCuit(pick(text, /\bCUIT:\s*(\d{11})\s+Raz[oó]n\s+Social/i)) ||
      (allCuits.length > 1 ? allCuits[1] : allCuits[0] ?? null),
    fecha:
      base.fecha ||
      normalizeDate(pick(text, /\bFecha\s+de\s+Emisi[oó]n:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i)) ||
      normalizeDate(pick(text, /\bFecha\s*de\s*Emisi[oó]n[^\d\n]{0,18}(\d{2}[\/\.-]\d{2}[\/\.-]\d{2,4})\b/i)) ||
      normalizeDate(pick(search, /\bfecha\s+de\s+emision\s+(\d{2}[\/\.-]\d{2}[\/\.-]\d{2,4})\b/i)) ||
      pickDateNearLabel(lines, /\bFecha\s+de\s+Emisi[oó]n\b/i, 2) ||
      pickDateNearLabel(lines, /\bFecha\b/i, 3),
    vencimiento:
      base.vencimiento || normalizeDate(pick(text, /\bFecha\s+de\s+Vto\.\s+para\s+el\s+pago:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i)),
    netoGravado:
      base.netoGravado ||
      parseMixedNumber(pick(text, /\bImporte\s+Neto\s+Gravado:\s*\$?\s*([\d\.,]+)/i)) ||
      pickNumberNearLabel(lines, /\bImporte\s+Neto\s+Gravado\b/i, 2) ||
      pickNumberNearLabel(lines, /\bSubtotal\b/i, 2),
    iva21:
      base.iva21 ||
      parseMixedNumber(pick(text, /\bIVA\s*21(?:[\.,]00)?%:\s*\$?\s*([\d\.,]+)/i)) ||
      pickNumberNearLabel(lines, /\bIVA\s*21(?:[.,]00)?%?\b/i, 2) ||
      (base.tipoFactura === "C" ? 0 : null),
    total:
      base.total ||
      parseMixedNumber(pick(text, /\bImporte\s+Total:\s*\$?\s*([\d\.,]+)/i)) ||
      pickAmountAfterLabel(text, /\bImporte\s+Total\b/i) ||
      pickNumberNearLabel(lines, /\bImporte\s+Total\b/i, 2) ||
      pickLastAmount(text),
    cae:
      base.cae ||
      pick(text, /\bCAE\s*N[°º]?:\s*(\d{10,20})\b/i) ||
      pick(text, /\bCAE:\s*(\d{10,20})\b/i) ||
      pick(text, /\bCAE\b[^\d\n]{0,24}(\d{10,20})\b/i) ||
      pickDigitsAfterLabel(text, /\bCAE\b/i, 10, 20) ||
      pick(search, /\bcae(?:\s+n)?\s+(\d{10,20})\b/i),
    vencCae:
      base.vencCae ||
      normalizeDate(pick(text, /\bFecha\s+de\s+Vto\.\s+de\s+CAE:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i)) ||
      normalizeDate(pick(text, /\bFecha\s+de\s+Vencimiento:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i)),
    conceptos: tableConcepts.length > 0 ? tableConcepts : base.conceptos.length > 0 ? base.conceptos : fallbackConcepts
  });
}

function applyAlbaFamily(base: StrictInvoiceDraft, ctx: ExtractionContext): StrictInvoiceDraft {
  const text = ctx.normalizedText;

  const numeroComp =
    pick(text, /\bFactura\b\s*\n\s*(\d{4}-\d{8})\b/i) || pick(text, /\b(\d{4}-\d{8})\b/i);

  const tomadorNombre = pick(text, /\bTOMADOR\s*\n([^\n]+)/i);
  const tomadorCuit = normalizeCuit(pick(text, /\bCUIT:\s*(\d{11})\s+I\.?V\.?A/i));

  const asegurado = pick(text, /\bASEGURADO\s*\n([^\n]+)/i);
  const riesgo = pick(text, /\bRIESGO\s*([\s\S]{0,160})\nOBJETO\b/i, 1);
  const objeto = pick(text, /\bOBJETO\s*\n([\s\S]*?)\nP[óo]liza\s*N[°ºo]?:/i, 1);
  const poliza = pick(text, /\bP[óo]liza\s*N[°ºo]?:\s*\n?\s*(\d+)\b/i);

  const mainDescription = [
    asegurado,
    riesgo ? riesgo.replace(/\n/g, " ") : null,
    objeto ? objeto.replace(/\n/g, " ") : null,
    poliza ? `Poliza N°: ${poliza}.` : null
  ]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const concepts = [...base.conceptos];
  if (mainDescription) {
    concepts.unshift({
      cantidad: 1,
      descripcion: mainDescription,
      precioUnitario: null,
      bonifPorc: null,
      ivaPorc: base.ivaPorc ?? 21,
      importe: null
    });
  }

  return toStrictDraft({
    ...base,
    tipoComprobante: "FACTURA",
    tipoFactura:
      base.tipoFactura ||
      pick(text, /\n([ABCM])\n\s*C[ÓO]DIGO\b/i) ||
      pick(text, /(?:^|\n)\s*([ABCM])\s*(?:\n|$)/i),
    comprobante: numeroComp || base.comprobante,
    puntoVenta: numeroComp ? numeroComp.split("-")[0] : base.puntoVenta,
    numeroComprobante: numeroComp ? numeroComp.split("-")[1] : base.numeroComprobante,
    fecha: base.fecha || normalizeDate(pick(text, /\bFecha\s+Emisi[oó]n:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i)),
    vencimiento:
      base.vencimiento ||
      normalizeDate(pick(text, /\bPer[ií]odo\s+\d{2}\/\d{2}\/\d{2,4}\s+al\s+(\d{2}\/\d{2}\/\d{2,4})\b/i)),
    emisorNombre: "albacaucion",
    emisorCUIT: tomadorCuit || base.emisorCUIT,
    clienteNombre: tomadorNombre || base.clienteNombre,
    clienteCUIT: tomadorCuit || base.clienteCUIT,
    condicionIVA:
      pick(text, /\bI\.?V\.?A\.:\s*([^\n]+)/i) ||
      pick(text, /\bIVA\s+Responsable\s+Inscripto\b/i, 0) ||
      base.condicionIVA,
    cae: base.cae || pick(text, /\bCAE:\s*(\d{10,20})\b/i),
    vencCae: base.vencCae || normalizeDate(pick(text, /\bFecha\s+de\s+Vencimiento:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i)),
    ivaPorc:
      base.ivaPorc ||
      parsePercent(pick(text, /\bI\.?V\.?A\s*\(\s*([0-9]+(?:[\.,][0-9]+)?)\s*%\s*\)/i)) ||
      21,
    netoGravado: base.netoGravado || parseMixedNumber(pick(text, /\bSubtotal\s*([\d\.,]+)/i)),
    iva21:
      base.iva21 ||
      parseMixedNumber(pick(text, /\bI\.?V\.?A\s*\(21,00%\)\s*([\d\.,]+)/i)) ||
      parseMixedNumber(pick(text, /\bIVA\s*21(?:[\.,]00)?%?\s*([\d\.,]+)/i)),
    total: base.total || parseMixedNumber(pick(text, /\bTOTAL\s+en\s+PESOS\b[^\d\n]*\n?\s*([\d\.,]+)/i)),
    conceptos: concepts
  });
}

function parseDeterministic(ctx: ExtractionContext, classification: ClassificationResult): StrictInvoiceDraft {
  let draft = parseGenericDraft(ctx);

  if (classification.family === "afip_standard") {
    draft = applyAfipFamily(draft, ctx);
  }
  if (classification.family === "alba_seguros") {
    draft = applyAlbaFamily(draft, ctx);
  }

  if (!draft.invoiceKey || /(undefined|null|nan)/i.test(draft.invoiceKey)) {
    draft.invoiceKey = buildInvoiceKey(draft);
  }

  return toStrictDraft(draft);
}

function buildDeterministicCodeTemplate(family: InvoiceFamily, profile: string): string {
  const lines = [
    "const it = $input.item;",
    "const rawInput = (it.json.texto ?? it.json.text ?? \"\").toString();",
    "",
    "const raw = rawInput",
    "  .replace(/\\\\r\\\\n/g, \"\\n\")",
    "  .replace(/\\\\n/g, \"\\n\")",
    "  .replace(/\\\\t/g, \"\\t\");",
    "",
    "const t = raw",
    "  .replace(/\\u0000/g, \"\")",
    "  .replace(/\\r/g, \"\\n\")",
    "  .replace(/[ \\t]+/g, \" \")",
    "  .replace(/\\n+/g, \"\\n\")",
    "  .trim();",
    "",
    "const search = t",
    "  .normalize('NFD')",
    "  .replace(/[\\u0300-\\u036f]/g, '')",
    "  .toLowerCase()",
    "  .replace(/[^a-z0-9/\\.\\-]+/g, ' ')",
    "  .replace(/\\s+/g, ' ')",
    "  .trim();",
    "",
    `const FAMILY = ${JSON.stringify(family)};`,
    `const PROFILE = ${JSON.stringify(profile)};`,
    "",
    "function pick(re, group = 1) {",
    "  const m = t.match(re);",
    "  return m ? (m[group] || \"\").trim() || null : null;",
    "}",
    "",
    "function normalizeCuit(raw) {",
    "  if (!raw) return null;",
    "  const digits = String(raw).replace(/\\D/g, \"\");",
    "  return digits.length === 11 ? digits : null;",
    "}",
    "",
    "function parseMixedNumber(raw) {",
    "  if (!raw) return null;",
    "  let clean = String(raw).replace(/\\$/g, \"\").replace(/\\s/g, \"\").replace(/[^\\d.,-]/g, \"\");",
    "  if (!clean) return null;",
    "  const lastComma = clean.lastIndexOf(',');",
    "  const lastDot = clean.lastIndexOf('.');",
    "  if (lastComma >= 0 && lastDot >= 0) {",
    "    if (lastComma > lastDot) clean = clean.replace(/\\./g, \"\").replace(',', '.');",
    "    else clean = clean.replace(/,/g, \"\");",
    "  } else if (lastComma >= 0) {",
    "    if (/,\\d{2}$/.test(clean)) clean = clean.replace(/\\./g, \"\").replace(',', '.');",
    "    else clean = clean.replace(/,/g, \"\");",
    "  } else if ((clean.match(/\\./g) || []).length > 1) {",
    "    clean = clean.replace(/\\./g, \"\");",
    "  }",
    "  const value = Number(clean);",
    "  return Number.isFinite(value) ? value : null;",
    "}",
    "",
    "function normalizeDate(raw) {",
    "  if (!raw) return null;",
    "  const full = String(raw).match(/^(\\d{2})[\\/\\.-](\\d{2})[\\/\\.-](\\d{4})$/);",
    "  if (full) return `${full[1]}/${full[2]}/${full[3]}`;",
    "  const short = String(raw).match(/^(\\d{2})[\\/\\.-](\\d{2})[\\/\\.-](\\d{2})$/);",
    "  if (!short) return null;",
    "  const yy = Number(short[3]);",
    "  const yyyy = yy <= 79 ? 2000 + yy : 1900 + yy;",
    "  return `${short[1]}/${short[2]}/${yyyy}`;",
    "}",
    "",
    "function pickDateNear(labelRe, lookAhead = 2) {",
    "  const lines = t.split(\"\\n\").map((l) => l.trim()).filter(Boolean);",
    "  for (let i = 0; i < lines.length; i++) {",
    "    const line = lines[i] || \"\";",
    "    if (!labelRe.test(line)) continue;",
    "    const same = line.match(/\\b(\\d{2}[\\/\\.-]\\d{2}[\\/\\.-]\\d{2,4})\\b/);",
    "    if (same) {",
    "      const d = normalizeDate(same[1]);",
    "      if (d) return d;",
    "    }",
    "    for (let j = 1; j <= lookAhead; j++) {",
    "      const next = lines[i + j] || \"\";",
    "      const m = next.match(/\\b(\\d{2}[\\/\\.-]\\d{2}[\\/\\.-]\\d{2,4})\\b/);",
    "      if (!m) continue;",
    "      const d = normalizeDate(m[1]);",
    "      if (d) return d;",
    "    }",
    "  }",
    "  return null;",
    "}",
    "",
    "function pickNumberNear(labelRe, lookAhead = 2) {",
    "  const lines = t.split(\"\\n\").map((l) => l.trim()).filter(Boolean);",
    "  for (let i = 0; i < lines.length; i++) {",
    "    const line = lines[i] || \"\";",
    "    if (!labelRe.test(line)) continue;",
    "    const same = line.match(/-?\\d[\\d\\.,]*/);",
    "    if (same) {",
    "      const v = parseMixedNumber(same[0]);",
    "      if (v !== null) return v;",
    "    }",
    "    for (let j = 1; j <= lookAhead; j++) {",
    "      const next = lines[i + j] || \"\";",
    "      const m = next.match(/-?\\d[\\d\\.,]*/);",
    "      if (!m) continue;",
    "      const v = parseMixedNumber(m[0]);",
    "      if (v !== null) return v;",
    "    }",
    "  }",
    "  return null;",
    "}",
    "",
    "function pickAmountAfterLabel(labelRe, lookAhead = 120) {",
    "  const m = t.match(labelRe);",
    "  if (!m || typeof m.index !== 'number') return null;",
    "  const slice = t.slice(m.index + m[0].length, m.index + m[0].length + lookAhead);",
    "  const token = slice.match(/-?(?:\\d{1,3}(?:[.\\s]\\d{3})+,\\d{2}|\\d+,\\d{2}|\\d+(?:\\.\\d{2})?)/);",
    "  return parseMixedNumber(token ? token[0] : null);",
    "}",
    "",
    "function pickLastAmount() {",
    "  const tokens = Array.from(t.matchAll(/-?(?:\\d{1,3}(?:[.\\s]\\d{3})+,\\d{2}|\\d+,\\d{2})\\b/g)).map((m) => m[0]);",
    "  for (let i = tokens.length - 1; i >= 0; i--) {",
    "    const v = parseMixedNumber(tokens[i]);",
    "    if (v !== null) return v;",
    "  }",
    "  return null;",
    "}",
    "",
    "const directComp = pick(/\\b(\\d{4,5}-\\d{8})\\b/);",
    "const pair = t.match(/\\bPunto\\s*de\\s*V(?:enta|ta)\\s*[:\\-]?\\s*(\\d{1,5})[^\\d\\n]{0,40}Comp(?:robante)?\\.?\\s*(?:Nro|N[°ºo])\\.?\\s*[:\\-]?\\s*(\\d{1,8})\\b/i) || t.match(/\\bComp(?:robante)?\\.?\\s*(?:Nro|N[°ºo])\\.?\\s*[:\\-]?\\s*(\\d{1,8})[^\\d\\n]{0,40}Punto\\s*de\\s*V(?:enta|ta)\\s*[:\\-]?\\s*(\\d{1,5})\\b/i);",
    "const loosePair = search.match(/\\bpunto\\s+de\\s+v(?:enta|ta)\\s+(\\d{1,5})\\s+comp(?:robante)?\\.?\\s*(?:nro|numero|n)\\.?\\s+(\\d{1,8})\\b/i) || search.match(/\\bcomp(?:robante)?\\.?\\s*(?:nro|numero|n)\\.?\\s+(\\d{1,8})\\s+punto\\s+de\\s+v(?:enta|ta)\\s+(\\d{1,5})\\b/i) || t.match(/\\b(\\d{4,5})\\D{1,24}(\\d{8})\\b/);",
    "const pointOfSaleRaw = (pair ? (pair[1] && pair[1].length <= 5 ? pair[1] : pair[2]) : null) || (loosePair ? (loosePair[1] && loosePair[1].length <= 5 ? loosePair[1] : loosePair[2]) : null) || pick(/\\bPunto\\s*de\\s*Venta\\s*[:\\-]?\\s*(\\d{1,5})\\b/i) || pick(/\\bPunto\\s*de\\s*Vta\\s*[:\\-]?\\s*(\\d{1,5})\\b/i) || pick(/\\bpunto\\s+de\\s+v(?:enta|ta)\\s+(\\d{1,5})\\b/i) || pick(/\\bPV\\s*[:\\-]?\\s*(\\d{1,5})\\b/i);",
    "const compNroRaw = (pair ? (pair[1] && pair[1].length > 5 ? pair[1] : pair[2]) : null) || (loosePair ? (loosePair[1] && loosePair[1].length > 5 ? loosePair[1] : loosePair[2]) : null) || pick(/\\bComp\\.?\\s*Nro\\.?\\s*[:\\-]?\\s*(\\d{1,8})\\b/i) || pick(/\\bComprobante\\.?\\s*Nro\\.?\\s*[:\\-]?\\s*(\\d{1,8})\\b/i) || pick(/\\bcomp(?:robante)?\\.?\\s*(?:nro|numero|n)\\.?\\s+(\\d{1,8})\\b/i) || (pick(/\\bN[°ºo]\\s*:\\s*(\\d{4}-\\d{8})\\b/i) || \"\").split('-')[1] || null;",
    "const pointOfSale = pointOfSaleRaw ? pointOfSaleRaw.padStart(5, '0').slice(-5) : null;",
    "const compNro = compNroRaw ? compNroRaw.padStart(8, '0').slice(-8) : null;",
    "const comprobante = directComp || (pointOfSale && compNro ? `${pointOfSale}-${compNro}` : null);",
    "",
    "const tipoComprobante = /\\bFactura\\b/i.test(t)",
    "  ? \"FACTURA\"",
    "  : pick(/\\b(RECIBO|NOTA\\s+DE\\s+CR[ÉE]DITO|NOTA\\s+DE\\s+D[ÉE]BITO)\\b/i);",
    "",
    "const tipoFactura =",
    "  pick(/\\bFACTURA\\b[\\s\\S]{0,80}\\b([ABCM])\\b/i) ||",
    "  pick(/(?:^|\\n)\\s*([ABCM])\\s*(?:\\n|$)/im);",
    "",
    "const fecha =",
    "  normalizeDate(pick(/\\bFecha\\s+de\\s+Emisi[oó]n:\\s*(\\d{2}\\/\\d{2}\\/\\d{2,4})\\b/i)) ||",
    "  normalizeDate(pick(/\\bFecha\\s*de\\s*Emisi[oó]n[^\\d\\n]{0,18}(\\d{2}[\\/\\.-]\\d{2}[\\/\\.-]\\d{2,4})\\b/i)) ||",
    "  normalizeDate(pick(/\\bFecha\\s+Emisi[oó]n:\\s*(\\d{2}\\/\\d{2}\\/\\d{2,4})\\b/i)) ||",
    "  normalizeDate(pick(/\\bFecha:\\s*(\\d{2}\\/\\d{2}\\/\\d{2,4})\\b/i)) ||",
    "  normalizeDate(pick(/\\bfecha\\s+de\\s+emision\\s+(\\d{2}[\\/\\.-]\\d{2}[\\/\\.-]\\d{2,4})\\b/i)) ||",
    "  pickDateNear(/\\bFecha\\s+de\\s+Emisi[oó]n\\b/i, 2) ||",
    "  pickDateNear(/\\bFecha\\b/i, 3) ||",
    "  normalizeDate(pick(/\\b(\\d{2}[\\/\\.-]\\d{2}[\\/\\.-]\\d{2,4})\\b/i));",
    "",
    "const vencimiento =",
    "  normalizeDate(pick(/\\bPer[ií]odo\\s+\\d{2}\\/\\d{2}\\/\\d{2,4}\\s+al\\s+(\\d{2}\\/\\d{2}\\/\\d{2,4})\\b/i)) ||",
    "  normalizeDate(pick(/\\bFecha\\s+de\\s+Vto\\.\\s*para\\s+el\\s+pago:\\s*(\\d{2}\\/\\d{2}\\/\\d{2,4})\\b/i)) ||",
    "  normalizeDate(pick(/\\bFecha\\s+de\\s+Vencimiento:\\s*(\\d{2}\\/\\d{2}\\/\\d{2,4})\\b/i));",
    "",
    "const cuits = Array.from(t.matchAll(/\\bC\\.?U\\.?I\\.?T\\.?[: ]+([0-9\\-]{11,13})\\b/gi))",
    "  .map((m) => normalizeCuit(m[1]))",
    "  .filter(Boolean);",
    "const uniqCuits = Array.from(new Set(cuits));",
    "",
    "let emisorNombre =",
    "  (/www\\.albacaucion\\.com\\.ar/i.test(t) ? \"albacaucion\" : null) ||",
    "  pick(/\\bRaz[oó]n\\s+Social:\\s*([^\\n]+?)(?:\\s+Fecha\\s+de\\s+Emisi[oó]n|\\n)/i) ||",
    "  pick(/\\bRaz[oó]n\\s+Social:\\s*([^\\n]+)/i);",
    "",
    "let emisorCUIT = normalizeCuit(pick(/\\bC\\.?U\\.?I\\.?T\\.?[: ]+([0-9\\-]{11,13})\\b/i)) || uniqCuits[0] || null;",
    "let clienteNombre =",
    "  pick(/\\bApellido\\s+y\\s+Nombre\\s*\\/\\s*Raz[oó]n\\s+Social:\\s*([^\\n]+)/i) ||",
    "  pick(/\\bTOMADOR\\s*\\n([^\\n]+)/i) ||",
    "  pick(/\\bASEGURADO\\s*\\n([^\\n]+)/i);",
    "let clienteCUIT =",
    "  normalizeCuit(pick(/\\bCUIT:\\s*(\\d{11})\\s+Apellido\\s+y\\s+Nombre/i)) ||",
    "  normalizeCuit(pick(/\\bCUIT:\\s*(\\d{11})\\s+I\\.?V\\.?A/i)) ||",
    "  (uniqCuits.length > 1 ? uniqCuits[1] : (uniqCuits[0] || null));",
    "",
    "if (FAMILY === \"alba_seguros\") {",
    "  const nro = pick(/\\bFactura\\b\\s*\\n\\s*(\\d{4}-\\d{8})\\b/i) || pick(/\\b(\\d{4}-\\d{8})\\b/i);",
    "  if (nro) {",
    "    emisorNombre = \"albacaucion\";",
    "    const tomadorCUIT = normalizeCuit(pick(/\\bCUIT:\\s*(\\d{11})\\s+I\\.?V\\.?A/i));",
    "    if (tomadorCUIT) { emisorCUIT = tomadorCUIT; clienteCUIT = tomadorCUIT; }",
    "    clienteNombre = clienteNombre || pick(/\\bTOMADOR\\s*\\n([^\\n]+)/i);",
    "  }",
    "}",
    "",
    "const ivaPorc = parseMixedNumber(pick(/\\bI\\.?V\\.?A\\s*\\(\\s*([0-9]+(?:[\\.,][0-9]+)?)\\s*%\\s*\\)/i)) || 21;",
    "const netoGravado =",
    "  parseMixedNumber(pick(/\\bImporte\\s+Neto\\s+Gravado:\\s*\\$?\\s*([\\d\\.,]+)/i)) ||",
    "  parseMixedNumber(pick(/\\bSubtotal:?\\s*\\$?\\s*([\\d\\.,]+)/i)) ||",
    "  pickNumberNear(/\\bImporte\\s+Neto\\s+Gravado\\b/i, 2) ||",
    "  pickNumberNear(/\\bSubtotal\\b/i, 2);",
    "const iva21 =",
    "  parseMixedNumber(pick(/\\bIVA\\s*21(?:[\\.,]00)?%:\\s*\\$?\\s*([\\d\\.,]+)/i)) ||",
    "  parseMixedNumber(pick(/\\bI\\.?V\\.?A\\s*\\(21,00%\\)\\s*([\\d\\.,]+)/i)) ||",
    "  pickNumberNear(/\\bIVA\\s*21(?:[.,]00)?%?\\b/i, 2);",
    "const total =",
    "  parseMixedNumber(pick(/\\bImporte\\s+Total:\\s*\\$?\\s*([\\d\\.,]+)/i)) ||",
    "  parseMixedNumber(pick(/\\bTOTAL\\s+en\\s+PESOS\\b[^\\d\\n]*\\n?\\s*([\\d\\.,]+)/i)) ||",
    "  pickAmountAfterLabel(/\\bImporte\\s+Total\\b/i) ||",
    "  pickAmountAfterLabel(/\\bTOTAL\\s+en\\s+PESOS\\b/i) ||",
    "  pickNumberNear(/\\bImporte\\s+Total\\b/i, 2) ||",
    "  pickNumberNear(/\\bTOTAL\\b/i, 2) ||",
    "  pickLastAmount();",
    "",
    "const cae = pick(/\\bCAE\\s*N[°º]?:\\s*(\\d{10,20})\\b/i) || pick(/\\bCAE:\\s*(\\d{10,20})\\b/i) || pick(/\\bC\\.?A\\.?E\\.?\\s*N?[°º]?\\s*[:\\-]?\\s*(\\d{10,20})\\b/i) || pick(/\\bCAE\\b[^\\d\\n]{0,24}(\\d{10,20})\\b/i) || pick(/(?:^|\\D)(\\d{14})(?:\\D|$)/);",
    "const vencCae =",
    "  normalizeDate(pick(/\\bFecha\\s+de\\s+Vto\\.\\s+de\\s+CAE:\\s*(\\d{2}\\/\\d{2}\\/\\d{2,4})\\b/i)) ||",
    "  normalizeDate(pick(/\\bFecha\\s+de\\s+Vencimiento:\\s*(\\d{2}\\/\\d{2}\\/\\d{2,4})\\b/i));",
    "",
    "const conceptos = [];",
    "const impuestos = parseMixedNumber(pick(/\\bImpuestos\\s+y\\s+Tasas:?\\s*\\$?\\s*([\\d\\.,]+)/i));",
    "if (impuestos !== null) conceptos.push({ cantidad: 1, descripcion: \"Impuestos y Tasas\", precioUnitario: null, bonifPorc: null, ivaPorc, importe: impuestos });",
    "const iibb = parseMixedNumber(pick(/\\bPercepci[oó]n\\s*IIBB\\s*\\([^\\)]*\\)\\s*([\\d\\.,]+)/i));",
    "if (iibb !== null) conceptos.push({ cantidad: 1, descripcion: \"Percepción IIBB\", precioUnitario: null, bonifPorc: null, ivaPorc, importe: iibb });",
    "const gastos = parseMixedNumber(pick(/\\bGastos:?\\s*\\$?\\s*([\\d\\.,]+)/i));",
    "if (gastos !== null) conceptos.push({ cantidad: 1, descripcion: \"Gastos\", precioUnitario: null, bonifPorc: null, ivaPorc, importe: gastos });",
    "",
    "const sellado = t.match(/\\b(Prov\\.?\\s*[^\\n]*?Sellado)\\s+([\\d\\.,]+)/i);",
    "if (sellado) {",
    "  const amount = parseMixedNumber(sellado[2]);",
    "  if (amount !== null) conceptos.push({ cantidad: 1, descripcion: sellado[1], precioUnitario: null, bonifPorc: null, ivaPorc, importe: amount });",
    "}",
    "",
    "const out = {",
    "  tipoComprobante: tipoComprobante || null,",
    "  tipoFactura: tipoFactura || null,",
    "  comprobante: comprobante || null,",
    "  puntoVenta: pointOfSale || (comprobante ? comprobante.split('-')[0] : null),",
    "  numeroComprobante: compNro || (comprobante ? comprobante.split('-')[1] : null),",
    "  fecha: fecha || null,",
    "  vencimiento: vencimiento || null,",
    "  emisorNombre: emisorNombre || null,",
    "  emisorCUIT: emisorCUIT || null,",
    "  clienteNombre: clienteNombre || null,",
    "  clienteCUIT: clienteCUIT || null,",
    "  condicionIVA: pick(/\\bCondici[oó]n\\s+frente\\s+al\\s+IVA:\\s*([^\\n]+)/i) || pick(/\\bI\\.?V\\.?A\\.:\\s*([^\\n]+)/i) || null,",
    "  cae: cae || null,",
    "  vencCae: vencCae || null,",
    "  ivaPorc: ivaPorc ?? (tipoFactura === 'C' ? 0 : null),",
    "  bonificacion: null,",
    "  netoGravado: netoGravado ?? null,",
    "  iva27: parseMixedNumber(pick(/\\bIVA\\s*27(?:[\\.,]00)?%:\\s*\\$?\\s*([\\d\\.,]+)/i)),",
    "  iva21: iva21 ?? (tipoFactura === 'C' ? 0 : null),",
    "  iva105: parseMixedNumber(pick(/\\bIVA\\s*10(?:[\\.,]5)?%:\\s*\\$?\\s*([\\d\\.,]+)/i)),",
    "  iva5: parseMixedNumber(pick(/\\bIVA\\s*5(?:[\\.,]00)?%:\\s*\\$?\\s*([\\d\\.,]+)/i)),",
    "  iva25: parseMixedNumber(pick(/\\bIVA\\s*2(?:[\\.,]5)?%:\\s*\\$?\\s*([\\d\\.,]+)/i)),",
    "  iva0: parseMixedNumber(pick(/\\bIVA\\s*0(?:[\\.,]00)?%:\\s*\\$?\\s*([\\d\\.,]+)/i)),",
    "  total: total ?? null,",
    "  conceptos: conceptos.length ? conceptos : [{ cantidad: 1, descripcion: (pick(/\\bConcepto\\/s?:\\s*([^\\n]+)/i) || 'Servicio'), precioUnitario: null, bonifPorc: null, ivaPorc: (ivaPorc ?? (tipoFactura === 'C' ? 0 : 21)), importe: (total ?? netoGravado ?? null) }],",
    "  invoiceKey: \"\"",
    "};",
    "",
    "out.invoiceKey = [",
    "  out.emisorCUIT ?? \"\",",
    "  out.tipoComprobante ?? \"\",",
    "  out.tipoFactura ?? \"\",",
    "  out.numeroComprobante ?? \"\",",
    "  out.fecha ?? \"\",",
    "  out.total ?? \"\"",
    "].join('|');",
    "",
    "return { json: out };"
  ];

  return lines.join("\n");
}

function computeStructureScore(code: string): number {
  const hasCarriageNormalize =
    code.includes("replace(/\\\\r/g") || code.includes("replace(/\\r/g") || code.includes("replace(/\\\\r\\\\n/g");
  const hasLineNormalize = code.includes("replace(/\\\\n/g") || code.includes("replace(/\\n/g");

  return clamp(
    (code.includes("const it = $input.item") ? 18 : 0) +
      ((code.includes("it.json.text") || code.includes("it.json.texto") || code.includes("$json.text")) ? 14 : 0) +
      (hasCarriageNormalize && hasLineNormalize ? 10 : 0) +
      (code.includes("function pick") ? 12 : 0) +
      ((code.includes("parseArNumber") || code.includes("parseMixedNumber") || code.includes("parseNumber")) ? 10 : 0) +
      (/return\s*\{\s*json\s*:/.test(code) ? 36 : 0)
  );
}

function evaluateCoverage(draft: StrictInvoiceDraft): { score: number; missing: string[] } {
  const requiredKeys = TARGET_SCHEMA.filter((field) => field.required).map((field) => field.key);
  const missing: string[] = [];

  for (const key of requiredKeys) {
    const value = draft[key];
    const present =
      Array.isArray(value)
        ? value.length > 0
        : typeof value === "number"
          ? Number.isFinite(value)
          : typeof value === "string"
            ? value.trim().length > 0
            : value !== null && value !== undefined;

    if (!present) {
      missing.push(String(key));
    }
  }

  const score = clamp(((requiredKeys.length - missing.length) / requiredKeys.length) * 100);
  return { score, missing };
}

function evaluateValueScore(draft: StrictInvoiceDraft): { score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 100;

  if (!draft.comprobante || !draft.puntoVenta || !draft.numeroComprobante) {
    score -= 18;
    issues.push("Comprobante incompleto");
  }
  if (!draft.fecha) {
    score -= 14;
    issues.push("Fecha no detectada");
  }
  if (!draft.cae) {
    score -= 12;
    issues.push("CAE no detectado");
  }
  if (!draft.emisorCUIT) {
    score -= 10;
    issues.push("CUIT emisor no detectado");
  }
  if (!draft.clienteCUIT) {
    score -= 10;
    issues.push("CUIT cliente no detectado");
  }
  if (draft.total === null) {
    score -= 15;
    issues.push("Total no detectado");
  }
  if (draft.netoGravado === null) {
    score -= 10;
    issues.push("Neto gravado no detectado");
  }
  if (draft.iva21 === null) {
    score -= 8;
    issues.push("IVA 21 no detectado");
  }
  if (!Array.isArray(draft.conceptos) || draft.conceptos.length === 0) {
    score -= 12;
    issues.push("Conceptos vacios");
  }
  if (!draft.invoiceKey || /(undefined|null|nan)/i.test(draft.invoiceKey)) {
    score -= 16;
    issues.push("invoiceKey invalido");
  }
  if (draft.condicionIVA && /\n/.test(draft.condicionIVA)) {
    score -= 8;
    issues.push("Condicion IVA contaminada con multilinea");
  }

  return { score: clamp(score), issues };
}

function executeCandidateCode(code: string, text: string): StrictInvoiceDraft {
  const sandbox = createContext({
    __input: {
      item: {
        json: {
          text,
          texto: text
        }
      }
    }
  });

  const wrapped = `(() => {\nconst $input = __input;\nconst $json = __input.item.json;\n${code}\n})()`;
  const script = new Script(wrapped);

  const result = script.runInContext(sandbox, {
    timeout: 1200
  }) as unknown;

  if (!isRecord(result)) {
    throw new Error("El codigo no retorno un objeto");
  }

  const jsonPayload = isRecord(result.json) ? result.json : result;
  return toStrictDraft(jsonPayload as Partial<StrictInvoiceDraft>);
}

function computeCandidateQuality(params: {
  profile: string;
  profileStatus: ProfileStatus;
  familyScore: number;
  extractionQuality: number;
  modelScore: number;
  structureScore: number;
  coverageScore: number;
  valueScore: number;
  issues: string[];
  source: string;
}): QualityBreakdown {
  const issues = Array.from(new Set(params.issues));

  if (params.profileStatus === "draft") {
    issues.push("Perfil en borrador (promocion manual requerida)");
  }

  return {
    profile: params.profile,
    profileStatus: params.profileStatus,
    selectedSource: params.source,
    modelScore: clamp(params.modelScore),
    familyScore: clamp(params.familyScore),
    extractionQuality: clamp(params.extractionQuality),
    structureScore: clamp(params.structureScore),
    coverageScore: clamp(params.coverageScore),
    valueScore: clamp(params.valueScore),
    issues: issues.slice(0, 12)
  };
}

function computeConfidenceFromQuality(quality: QualityBreakdown): number {
  return clamp(
    quality.coverageScore * 0.35 +
      quality.valueScore * 0.25 +
      quality.structureScore * 0.15 +
      quality.familyScore * 0.1 +
      quality.extractionQuality * 0.1 +
      quality.modelScore * 0.05
  );
}

function evaluateCandidate(params: {
  source: string;
  code: string;
  text: string;
  profile: string;
  profileStatus: ProfileStatus;
  familyScore: number;
  extractionQuality: number;
  modelScore: number;
  fallbackDraft: StrictInvoiceDraft;
  inheritedIssues?: string[];
}): CandidateEvaluation {
  const structureScore = computeStructureScore(params.code);
  const issues: string[] = [...(params.inheritedIssues ?? [])];

  let draft = params.fallbackDraft;
  if (structureScore < 45) {
    issues.push("Estructura n8n insuficiente en codigo generado");
  } else {
    try {
      draft = executeCandidateCode(params.code, params.text);
    } catch {
      issues.push("El codigo generado fallo en dry-run");
    }
  }

  draft = toStrictDraft(draft);
  if (!draft.invoiceKey || /(undefined|null|nan)/i.test(draft.invoiceKey)) {
    draft.invoiceKey = buildInvoiceKey(draft);
  }

  const coverage = evaluateCoverage(draft);
  const value = evaluateValueScore(draft);

  if (coverage.missing.length > 0) {
    issues.push(`Campos requeridos faltantes: ${coverage.missing.join(", ")}`);
  }

  const quality = computeCandidateQuality({
    profile: params.profile,
    profileStatus: params.profileStatus,
    familyScore: params.familyScore,
    extractionQuality: params.extractionQuality,
    modelScore: params.modelScore,
    structureScore,
    coverageScore: coverage.score,
    valueScore: value.score,
    issues: [...issues, ...value.issues],
    source: params.source
  });

  const confidence = computeConfidenceFromQuality(quality);

  return {
    source: params.source,
    code: params.code,
    draft,
    quality,
    confidence
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

function extractResponseText(response: unknown): string | null {
  const direct = (response as { output_text?: string })?.output_text;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }

  const output = (response as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> })?.output;
  if (!Array.isArray(output)) return null;

  const chunks: string[] = [];
  for (const item of output) {
    if (!Array.isArray(item?.content)) continue;
    for (const part of item.content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }

  const combined = chunks.join("\n").trim();
  return combined.length > 0 ? combined : null;
}

async function requestCodeFromModel(params: {
  openai: OpenAI;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string | null> {
  const response = await withTimeout(
    params.openai.responses.create({
      model: params.model,
      ...(params.model.startsWith("gpt-5") ? { reasoning: { effort: "medium" as const } } : {}),
      input: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt }
      ]
    }),
    25000
  );

  const content = extractResponseText(response);
  if (!content) return null;
  const code = sanitizeCode(content);
  return code.length > 0 ? code : null;
}

function buildGeneratorSystemPrompt(): string {
  return [
    "Generas SOLO codigo JavaScript para un nodo Code de n8n.",
    "No usar markdown, no usar bloques ```.",
    "El codigo debe iniciar con `const it = $input.item;`.",
    "Debe leer texto desde `(it.json.texto ?? it.json.text ?? \"\").toString()`.",
    "Debe normalizar lineas y espacios de forma no destructiva.",
    "Debe retornar `return { json: { ... } };`.",
    "Debe devolver schema estricto sin `undefined` ni `NaN`.",
    "Si un campo no se detecta, devolver null (o [] en conceptos)."
  ].join("\n");
}

function buildGeneratorUserPrompt(params: {
  text: string;
  classification: ClassificationResult;
  deterministicDraft: StrictInvoiceDraft;
  extraction: ExtractionContext;
}): string {
  return [
    `Familia detectada: ${params.classification.family}`,
    `Perfil: ${params.classification.profile}`,
    `Score familia: ${params.classification.familyScore}`,
    `Calidad de extraccion: ${params.extraction.extractionQuality}`,
    `Razones de clasificacion: ${params.classification.reasons.join(" | ")}`,
    `Schema objetivo estricto: ${JSON.stringify(TARGET_SCHEMA)}`,
    `Draft deterministico base: ${JSON.stringify(params.deterministicDraft)}`,
    "Reglas obligatorias:",
    "1) Mantener helper pick null-safe.",
    "2) Incluir parser numerico AR/mixed null-safe.",
    "3) Parsear cabecera, importes, conceptos e invoiceKey.",
    "4) Soportar ambos campos it.json.text e it.json.texto.",
    "5) Devolver SIEMPRE las claves del schema target.",
    "Texto fuente:",
    params.text
  ].join("\n\n");
}

function buildRepairPrompt(params: {
  text: string;
  classification: ClassificationResult;
  deterministicDraft: StrictInvoiceDraft;
  previousCode: string;
  issues: string[];
}): string {
  return [
    `Familia: ${params.classification.family}`,
    `Perfil: ${params.classification.profile}`,
    `Issues detectados: ${params.issues.join(" | ")}`,
    `Draft deterministico de referencia: ${JSON.stringify(params.deterministicDraft)}`,
    "Corrige el codigo manteniendo formato n8n y schema estricto.",
    "Codigo previo:",
    params.previousCode,
    "Texto fuente:",
    params.text
  ].join("\n\n");
}

function selectBestCandidate(candidates: CandidateEvaluation[]): CandidateEvaluation {
  return [...candidates].sort((a, b) => {
    if (b.quality.coverageScore !== a.quality.coverageScore) return b.quality.coverageScore - a.quality.coverageScore;
    if (b.quality.valueScore !== a.quality.valueScore) return b.quality.valueScore - a.quality.valueScore;
    return b.confidence - a.confidence;
  })[0];
}

function detectProviderName(classification: ClassificationResult, draft: StrictInvoiceDraft): string {
  if (classification.providerHint) return classification.providerHint;
  if (classification.family === "alba_seguros") return "ALBA Compañía Argentina de Seguros S.A.";
  if (draft.emisorNombre) return draft.emisorNombre;
  return "Proveedor Detectado";
}

function draftToFields(draft: StrictInvoiceDraft): InvoiceField[] {
  const typeOf = (value: unknown): InvoiceField["type"] => {
    if (Array.isArray(value)) return "array";
    if (typeof value === "number") return "number";
    if (typeof value === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(value)) return "date";
    return "string";
  };

  return TARGET_SCHEMA.map(({ key }) => {
    const value = draft[key];
    return {
      field: key,
      label: LABELS[key],
      detectedValue: value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value),
      type: typeOf(value)
    };
  });
}

function buildDetectionDebug(text: string): string {
  const search = buildLooseSearchText(text);
  const flags = {
    pv:
      /\bPunto\s*de\s*V(?:enta|ta)\s*[:\-]?\s*\d{1,5}\b/i.test(text) ||
      /\bpunto\s+de\s+v(?:enta|ta)\s+\d{1,5}\b/i.test(search) ||
      /\bpv\s+\d{1,5}\b/i.test(search),
    comp:
      /\bComp(?:robante)?\.?\s*(?:Nro|N[°ºo])\.?\s*[:\-]?\s*\d{1,8}\b/i.test(text) ||
      /\bcomp(?:robante)?\.?\s*(?:nro|numero|n)\.?\s+\d{1,8}\b/i.test(search),
    compPair:
      /\bPunto\s*de\s*V(?:enta|ta)\s*[:\-]?\s*\d{1,5}[^\d\n]{0,40}Comp(?:robante)?\.?\s*(?:Nro|N[°ºo])\.?\s*[:\-]?\s*\d{1,8}\b/i.test(
        text
      ) ||
      /\bpunto\s+de\s+v(?:enta|ta)\s+\d{1,5}\s+comp(?:robante)?\.?\s*(?:nro|numero|n)\.?\s+\d{1,8}\b/i.test(search),
    fecha:
      /\bFecha\s*de\s*Emisi[oó]n[^\d\n]{0,18}\d{2}[\/\.-]\d{2}[\/\.-]\d{2,4}\b/i.test(text) ||
      /\bfecha\s+de\s+emision\s+\d{2}[\/\.-]\d{2}[\/\.-]\d{2,4}\b/i.test(search),
    cae: /\bCAE\b[^\d\n]{0,24}\d{10,20}\b/i.test(text) || /\bcae(?:\s+n)?\s+\d{10,20}\b/i.test(search),
    total: /\bImporte\s+Total\b/i.test(text) || /\bimporte\s+total\b/i.test(search)
  };

  return `DebugPatrones pv=${flags.pv ? 1 : 0} comp=${flags.comp ? 1 : 0} pair=${flags.compPair ? 1 : 0} fecha=${flags.fecha ? 1 : 0} cae=${flags.cae ? 1 : 0} total=${flags.total ? 1 : 0}`;
}

async function generateLlmCandidates(params: {
  openai: OpenAI;
  text: string;
  classification: ClassificationResult;
  extraction: ExtractionContext;
  deterministicDraft: StrictInvoiceDraft;
}): Promise<CandidateEvaluation[]> {
  const candidates: CandidateEvaluation[] = [];
  const systemPrompt = buildGeneratorSystemPrompt();

  const modelAttempts = [
    { model: DEFAULT_MODEL, modelScore: 88 },
    { model: FALLBACK_MODEL, modelScore: 76 }
  ];

  for (const attempt of modelAttempts) {
    let generatedCode: string | null = null;
    try {
      generatedCode = await requestCodeFromModel({
        openai: params.openai,
        model: attempt.model,
        systemPrompt,
        userPrompt: buildGeneratorUserPrompt({
          text: params.text,
          classification: params.classification,
          deterministicDraft: params.deterministicDraft,
          extraction: params.extraction
        })
      });
    } catch {
      generatedCode = null;
    }

    if (!generatedCode) {
      continue;
    }

    let evaluation = evaluateCandidate({
      source: `${attempt.model}-gen`,
      code: generatedCode,
      text: params.text,
      profile: params.classification.profile,
      profileStatus: params.classification.profileStatus,
      familyScore: params.classification.familyScore,
      extractionQuality: params.extraction.extractionQuality,
      modelScore: attempt.modelScore,
      fallbackDraft: params.deterministicDraft
    });

    candidates.push(evaluation);

    for (let round = 1; round <= 2; round += 1) {
      const needsRepair =
        evaluation.quality.structureScore < 70 ||
        evaluation.quality.coverageScore < 80 ||
        evaluation.quality.valueScore < 72;

      if (!needsRepair) {
        break;
      }

      let repairedCode: string | null = null;
      try {
        repairedCode = await requestCodeFromModel({
          openai: params.openai,
          model: attempt.model,
          systemPrompt,
          userPrompt: buildRepairPrompt({
            text: params.text,
            classification: params.classification,
            deterministicDraft: params.deterministicDraft,
            previousCode: evaluation.code,
            issues: evaluation.quality.issues
          })
        });
      } catch {
        repairedCode = null;
      }

      if (!repairedCode) {
        break;
      }

      evaluation = evaluateCandidate({
        source: `${attempt.model}-repair-${round}`,
        code: repairedCode,
        text: params.text,
        profile: params.classification.profile,
        profileStatus: params.classification.profileStatus,
        familyScore: params.classification.familyScore,
        extractionQuality: params.extraction.extractionQuality,
        modelScore: attempt.modelScore,
        fallbackDraft: params.deterministicDraft
      });

      candidates.push(evaluation);
    }

    if (candidates.some((candidate) => candidate.confidence >= 88)) {
      break;
    }
  }

  return candidates;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const text = body?.text;
    const fileName = typeof body?.fileName === "string" ? body.fileName : null;

    if (typeof text !== "string" || text.trim().length < 50) {
      return NextResponse.json({ error: "El texto es demasiado corto para analizar (minimo 50 caracteres)." }, { status: 400 });
    }

    const extraction = preprocessText(text);
    const fileNameHints = parseFileNameHints(fileName);
    let classification = classifyInvoiceFamily(extraction.normalizedText);
    let deterministicDraft = parseDeterministic(extraction, classification);
    deterministicDraft = applyFileNameHints(deterministicDraft, fileNameHints);

    if (
      classification.family === "generic" &&
      deterministicDraft.comprobante &&
      (deterministicDraft.cae || deterministicDraft.fecha || deterministicDraft.total)
    ) {
      classification = {
        ...classification,
        family: "afip_standard",
        profile: "afip-standard",
        profileStatus: "stable",
        familyScore: deterministicDraft.cae && deterministicDraft.fecha ? 84 : 76,
        reasons: [
          ...classification.reasons,
          "Reclasificado por hallazgos determinísticos (comprobante + campos de cabecera/importes)"
        ]
      };
      deterministicDraft = parseDeterministic(extraction, classification);
      deterministicDraft = applyFileNameHints(deterministicDraft, fileNameHints);
    }
    const deterministicCode = buildDeterministicCodeTemplate(classification.family, classification.profile);

    const deterministicCoverage = evaluateCoverage(deterministicDraft);
    const deterministicValues = evaluateValueScore(deterministicDraft);
    const deterministicStructure = computeStructureScore(deterministicCode);
    const deterministicIssues = [...extraction.extractionIssues, ...deterministicValues.issues];
    if (deterministicCoverage.missing.length > 0) {
      deterministicIssues.push(`Campos requeridos faltantes: ${deterministicCoverage.missing.join(", ")}`);
      if (
        deterministicCoverage.missing.includes("comprobante") ||
        deterministicCoverage.missing.includes("fecha") ||
        deterministicCoverage.missing.includes("cae") ||
        deterministicCoverage.missing.includes("total")
      ) {
        deterministicIssues.push(buildDetectionDebug(extraction.normalizedText));
      }
    }

    const deterministicQuality = computeCandidateQuality({
      profile: classification.profile,
      profileStatus: classification.profileStatus,
      familyScore: classification.familyScore,
      extractionQuality: extraction.extractionQuality,
      modelScore: 68,
      structureScore: deterministicStructure,
      coverageScore: deterministicCoverage.score,
      valueScore: deterministicValues.score,
      issues: deterministicIssues,
      source: "deterministic"
    });

    const deterministicCandidate: CandidateEvaluation = {
      source: "deterministic",
      code: deterministicCode,
      draft: deterministicDraft,
      quality: deterministicQuality,
      confidence: computeConfidenceFromQuality(deterministicQuality)
    };

    const candidates: CandidateEvaluation[] = [deterministicCandidate];

    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const llmCandidates = await generateLlmCandidates({
        openai,
        text: extraction.normalizedText,
        classification,
        extraction,
        deterministicDraft
      });
      const llmAccepted = llmCandidates.filter((candidate) => {
        const minCoverage = Math.max(35, deterministicCandidate.quality.coverageScore - 10);
        const minValue = Math.max(25, deterministicCandidate.quality.valueScore - 10);
        return candidate.quality.coverageScore >= minCoverage && candidate.quality.valueScore >= minValue;
      });

      candidates.push(...llmAccepted);

      if (llmCandidates.length === 0) {
        deterministicCandidate.quality.issues.push("No se pudo generar candidato IA, se uso parser deterministico");
      } else if (llmAccepted.length === 0) {
        deterministicCandidate.quality.issues.push("Candidatos IA descartados por baja cobertura/validez");
      }
    } else {
      deterministicCandidate.quality.issues.push("OPENAI_API_KEY ausente: se uso solo parser deterministico");
    }

    const selected = selectBestCandidate(candidates);

    if (classification.profileStatus === "draft" && !selected.quality.issues.includes("Perfil en borrador (promocion manual requerida)")) {
      selected.quality.issues.push("Perfil en borrador (promocion manual requerida)");
    }

    const fields = draftToFields(selected.draft);
    const provider = detectProviderName(classification, selected.draft);

    const response: GeneratedCode = {
      provider,
      confidence: selected.confidence,
      fields,
      code: selected.code,
      quality: selected.quality
    };

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { error: "Error procesando la factura. Verifica el texto de entrada e intenta nuevamente." },
      { status: 500 }
    );
  }
}
