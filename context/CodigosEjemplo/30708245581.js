// n8n Code node (Run once for each item)
// Parser genérico para Factura electrónica (layout tipo FACTURA A como el input nuevo)

const it = $input.item;
const raw = (it.json.texto ?? it.json.text ?? "").toString();

// Normalización base
let t = raw
  .replace(/\r/g, "\n")
  .replace(/[ \t]+/g, " ")
  .replace(/\n+/g, "\n")
  .trim();

// ---- Fix importante: algunos layouts “pegan” dos importes (ej: 180000.00180000.00)
// Inserta un espacio entre importes contiguos cuando termina en .dd y sigue un dígito
t = t.replace(/(\d[.,]\d{2})(?=\d)/g, "$1 ");

// Helpers
function pick(re, group = 1) {
  const m = t.match(re);
  return m ? (m[group] || "").trim() : null;
}
function normalizeCuit(cuit) {
  if (!cuit) return null;
  const digits = String(cuit).replace(/[^\d]/g, "");
  return digits.length === 11 ? digits : null;
}
// Número flexible (AR/US/plano)
function parseNumberMixed(s) {
  if (!s) return null;
  let clean = String(s).replace(/\$/g, "").replace(/\s/g, "");
  clean = clean.replace(/[^\d.,-]/g, "");
  if (!clean) return null;

  const hasDot = clean.includes(".");
  const hasComma = clean.includes(",");

  if (hasDot && hasComma) {
    const lastDot = clean.lastIndexOf(".");
    const lastComma = clean.lastIndexOf(",");
    const decimalIsComma = lastComma > lastDot;

    if (decimalIsComma) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      clean = clean.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else {
    clean = clean.replace(/,/g, "");
  }

  const v = Number(clean);
  return Number.isFinite(v) ? v : null;
}
function parsePercent(s) {
  if (!s) return null;
  const clean = String(s).replace("%", "").trim().replace(",", ".");
  const v = Number(clean);
  return Number.isFinite(v) ? v : null;
}
function normalizeDate_ddmmyyyy(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return s;
  const dd = m[1], mm = m[2], yy = m[3];
  if (yy.length === 4) return `${dd}/${mm}/${yy}`;
  const yyn = Number(yy);
  const yyyy = (yyn <= 79) ? (2000 + yyn) : (1900 + yyn);
  return `${dd}/${mm}/${yyyy}`;
}

// ================= CABECERA =================
const tipoComprobante = "FACTURA";

// Letra (A/B/C/M) suele venir sola al inicio
const tipoFactura =
  pick(/\bFACTURA\b[\s\S]{0,40}\b([ABCM])\b/i, 1) ||
  pick(/(?:^|\n)\s*([ABCM])\s*(?:\n|$)/i, 1) ||
  null;

// Número: "Nº 0010 - 00014884"
let comprobante = null;
let puntoVenta = null;
let numeroComprobante = null;

{
  const m = t.match(/\bN[º°]\s*(\d{4})\s*-\s*(\d{8})\b/i);
  if (m) {
    puntoVenta = m[1];
    numeroComprobante = m[2];
    comprobante = `${puntoVenta}-${numeroComprobante}`;
  }
}

// Fecha: "Fecha: 02/01/2026"
const fechaRaw =
  pick(/\bFecha:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i, 1) ||
  null;
const fecha = fechaRaw ? normalizeDate_ddmmyyyy(fechaRaw) : null;

// Vencimiento (en este layout suele ser CAE)
const vencimientoRaw =
  pick(/\bFecha\s+Vencimiento\s+CAE:\s*(\d{2}\/\d{2}\/\d{2,4})\b/i, 1) ||
  null;
const vencimiento = vencimientoRaw ? normalizeDate_ddmmyyyy(vencimientoRaw) : null;

// ================= EMISOR =================
// En este texto el CUIT del emisor aparece así:
// "CUIT Nº:" ... en otra línea "30-70824558-1"
const emisorCUIT = normalizeCuit(
  pick(/\bCUIT\s*N[º°]?:\s*\n?\s*(\d{2}-\d{8}-\d|\d{11})\b/i, 1)
);

// Nombre emisor: si no viene explícito, lo dejamos null (podés setearlo si tenés un patrón)
const emisorNombre = null;

// Condición IVA del emisor: "IVA: Resp.Inscripto"
const condicionIVA =
  pick(/\bIVA:\s*\n?\s*(RESP\.?INSCRIPTO|RESPONSABLE\s+INSCRIPTO|EXENTO|MONOTRIBUTO|NO\s+RESPONSABLE)\b/i, 1) ||
  pick(/\bIVA:\s*\n?\s*([^\n]+)/i, 1) ||
  null;

// ================= CLIENTE =================
let clienteNombre =
  pick(/\bSeñor\(es\):\s*\n?\s*([^\n]+)\b/i, 1) ||
  null;
if (clienteNombre) clienteNombre = clienteNombre.replace(/\s+/g, " ").trim();

// CUIT del cliente (en este layout aparece como "Cuenta Nº ... CUIT Nº: 30-....")
const clienteCUIT = normalizeCuit(
  pick(/\bCuenta\s*N[º°]?:\s*\d+\s*\n?\s*CUIT\s*N[º°]?:\s*(\d{2}-\d{8}-\d|\d{11})\b/i, 1)
) || (() => {
  // fallback: tomar el 2do CUIT distinto al emisor
  const all = [...t.matchAll(/\b(\d{2}-\d{8}-\d|\d{11})\b/g)]
    .map(m => normalizeCuit(m[1]))
    .filter(Boolean);
  return all.find(c => c && c !== emisorCUIT) ?? null;
})();

// ================= CAE =================
const cae = pick(/\bCAE:\s*(\d{10,20})\b/i, 1);
const vencCae = vencimiento; // en este layout es "Fecha Vencimiento CAE"

// ================= IVA % =================
// La tasa suele venir como "21.00%"
const ivaPorc =
  parsePercent(pick(/\bTasa\b[\s\S]{0,80}\b(\d{1,2}(?:[.,]\d{1,2})?)\s*%\b/i, 1)) ||
  parsePercent(pick(/\b(\d{1,2}(?:[.,]\d{1,2})?)\s*%\b/i, 1)) ||
  21;

// ================= IMPORTES (por etiquetas) =================
const netoGravado = parseNumberMixed(
  pick(/\bNeto\s+Gravado\b[\s\S]{0,40}\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\b/i, 1)
);

const iva21 = parseNumberMixed(
  pick(/\bI\.?V\.?A\.?\b[\s\S]{0,40}\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\b/i, 1)
);

// TOTAL: leer cerca de la palabra TOTAL, evitando agarrar 21.00%
// (buscamos el primer importe “money-like” después de "TOTAL")
let total = null;
{
  const m = t.match(/\bTOTAL\b[\s\S]{0,80}\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\b/i);
  if (m) total = parseNumberMixed(m[1]);
}

// Bonificación (no aparece en tu input)
const bonificacion = null;

// ================= CONCEPTOS (ítems) =================
function extractItems(text) {
  const res = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Ejemplos:
    // "PROD007 1.00 CAMPUS VIRTUAL- LICENCIA 180000.00 180000.00"
    // "HOST001 1.00 HOSTING ... 31000.00 31000.00"
    //
    // Luego del fix de importes pegados, debería haber espacio entre precio e importe.
    const m = line.match(/^([A-Z0-9]{3,})\s+(\d+(?:[.,]\d+)?)\s+(.+?)\s+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\s+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))$/);
    if (!m) continue;

    const codigo = m[1];
    const cantidad = parseNumberMixed(m[2]);
    const descripcion = m[3].replace(/\s+/g, " ").trim();
    const precioUnitario = parseNumberMixed(m[4]);
    const importe = parseNumberMixed(m[5]);

    if (!codigo || cantidad == null || !descripcion || importe == null) continue;

    res.push({
      codigo,
      cantidad,
      descripcion,
      precioUnitario,
      bonifPorc: null,
      ivaPorc,
      importe,
    });
  }

  return res;
}

const conceptos = extractItems(t);

// ================= KEY =================
const invoiceKey = [
  emisorCUIT ?? "",
  tipoComprobante ?? "",
  tipoFactura ?? "",
  numeroComprobante ?? "",
  fecha ?? "",
  total ?? ""
].join("|");

return {
  json: {
    tipoComprobante,
    tipoFactura,

    comprobante,        // "0010-00014884"
    puntoVenta,         // "0010"
    numeroComprobante,  // "00014884"

    fecha,              // dd/mm/yyyy
    vencimiento,        // dd/mm/yyyy (si querés usarlo como venc general)

    emisorNombre,
    emisorCUIT,

    clienteNombre,
    clienteCUIT,

    condicionIVA,

    cae,
    vencCae,

    ivaPorc,

    bonificacion,
    netoGravado,

    iva27: null,
    iva21,              // ahora lo completa (44310.00)
    iva105: null,
    iva5: null,
    iva25: null,
    iva0: null,

    total,

    conceptos,

    invoiceKey,
  }
};
