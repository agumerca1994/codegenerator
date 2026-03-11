// n8n Code node (Run once for each item)
// Parser genérico para Factura electrónica (adaptado al layout del input nuevo)

const it = $input.item;
const raw = (it.json.texto ?? it.json.text ?? "").toString();

// Normalización
let t = raw
  .replace(/\r/g, "\n")
  .replace(/[ \t]+/g, " ")
  .replace(/\n+/g, "\n")
  .trim();

// NEW: arreglar importes pegados (ej: 180000.00180000.00 -> 180000.00 180000.00)
t = t.replace(/(\d[.,]\d{2})(?=\d)/g, "$1 ");

function pick(re, group = 1) {
  const m = t.match(re);
  return m ? (m[group] || "").trim() : null;
}

function normalizeCuit(cuit) {
  if (!cuit) return null;
  const digits = cuit.replace(/[^\d]/g, "");
  return digits.length === 11 ? digits : null;
}

// Número flexible: soporta AR/US/plano
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

function normalizeDate_ddmmyy_to_ddmmyyyy(ddmmyy) {
  if (!ddmmyy) return null;
  const m = ddmmyy.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return ddmmyy; // si ya vino dd/mm/yyyy o algo distinto
  const dd = m[1], mm = m[2], yy = Number(m[3]);
  const yyyy = (yy <= 79) ? (2000 + yy) : (1900 + yy);
  return `${dd}/${mm}/${yyyy}`;
}

// NEW: normalizar dd/mm/yyyy (ya viene 2026)
function normalizeDate_ddmmyyyy(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : s;
}

// ================= CABECERA =================
const tipoComprobante = "FACTURA";

// CHANGED: en este layout es "FACTURA" y una letra suelta "A"
const tipoFactura =
  pick(/\bFACTURA\b[\s\S]{0,40}\b([ABCM])\b/i, 1) ||
  pick(/(?:^|\n)\s*([ABCM])\s*(?:\n|$)/i, 1);

// CHANGED: Número viene como "Nº 0010 - 00014884"
let comprobante = null;
let puntoVenta = null;
let numeroComprobante = null;

const pvNro = t.match(/\bN[º°]\s*(\d{4})\s*-\s*(\d{8})\b/i);
if (pvNro) {
  puntoVenta = pvNro[1];
  numeroComprobante = pvNro[2];
  comprobante = `${puntoVenta}-${numeroComprobante}`;
} else {
  // fallback viejo por si alguna vez viene en formato 00002-00025839
  const nFmt = pick(/\b(\d{4,5})-(\d{8})\b/, 0);
  if (nFmt) {
    comprobante = nFmt;
    puntoVenta = nFmt.split("-")[0];
    numeroComprobante = nFmt.split("-")[1];
  }
}

// CHANGED: Fecha viene dd/mm/yyyy
const fechaRaw =
  pick(/\bFecha:\s*(\d{2}\/\d{2}\/\d{4})\b/i, 1) ||
  pick(/\bFecha:\s*\n?\s*(\d{2}\/\d{2}\/\d{2})\b/i, 1);

const fecha = fechaRaw
  ? (fechaRaw.length === 10 ? normalizeDate_ddmmyyyy(fechaRaw) : normalizeDate_ddmmyy_to_ddmmyyyy(fechaRaw))
  : null;

// CHANGED: en este layout no hay "Fecha Vto." general; usamos vencimiento CAE si querés poblarlo
const vencimientoRaw =
  pick(/\bFecha\s+Vencimiento\s+CAE:\s*(\d{2}\/\d{2}\/\d{4})\b/i, 1) ||
  pick(/\bFecha\s+Vencimiento\s+CAE:\s*(\d{2}\/\d{2}\/\d{2})\b/i, 1);

const vencimiento = vencimientoRaw
  ? (vencimientoRaw.length === 10 ? normalizeDate_ddmmyyyy(vencimientoRaw) : normalizeDate_ddmmyy_to_ddmmyyyy(vencimientoRaw))
  : null;

// ================= EMISOR =================
// CHANGED: acá el texto dice "CUIT Nº:" y el valor puede estar en la línea siguiente
const emisorCUIT = normalizeCuit(
  pick(/\bCUIT\s*N[º°]?:\s*\n?\s*(\d{2}-\d{8}-\d|\d{11})\b/i, 1)
);

// Para este tipo de factura, el emisor no viene en el texto => fijo
const emisorNombre = "ALARMAS ARGENTINAS SRL";

// Condición IVA del emisor
const condicionIVA =
  pick(/\bIVA:\s*(INSCRIPTO|RESPONSABLE\s+INSCRIPTO|RESP\.?INSCRIPTO|EXENTO|MONOTRIBUTO|NO\s+RESPONSABLE)\b/i, 1) ||
  pick(/\bIVA:\s*([^\n]+)/i, 1) ||
  null;

// ================= CLIENTE =================
// CHANGED: cliente CUIT viene como "Cuenta Nº: 2030 ... CUIT Nº: 30-71186724-0"
const clienteCUIT = normalizeCuit(
  pick(/\bCuenta\s*N[º°]?:\s*\d+\s*\n?\s*CUIT\s*N[º°]?:\s*(\d{2}-\d{8}-\d|\d{11})\b/i, 1)
) || (() => {
  // fallback: tomar un CUIT distinto al emisor
  const cuitAll = [...t.matchAll(/\b(\d{2}-\d{8}-\d)\b/g)]
    .map(m => normalizeCuit(m[1]))
    .filter(Boolean);
  return (cuitAll.find(c => c && c !== emisorCUIT)) ?? null;
})();

// CHANGED: nombre cliente desde "Señor(es):"
let clienteNombre =
  pick(/\bSeñor\(es\):\s*\n?\s*([^\n]+)\b/i, 1) ||
  pick(/\b([A-Z0-9][A-Z0-9\.\s]+S\.?R\.?L\.?)\b/i, 1) ||
  null;

if (clienteNombre) {
  clienteNombre = clienteNombre.replace(/\s+/g, " ").trim();
  if (/^M\.?K\.?S\.?\s+S\.?R\.?L\.?$/i.test(clienteNombre)) {
    clienteNombre = "M.K.S. S.R.L.";
  }
}

// ================= CAE =================
const cae = pick(/\bCAE:\s*(\d{10,20})\b/i, 1);

// CHANGED: "Fecha Vencimiento CAE: 12/01/2026"
const vencCaeRaw =
  pick(/\bFecha\s+Vencimiento\s+CAE:\s*(\d{2}\/\d{2}\/\d{4})\b/i, 1) ||
  pick(/\bFecha\s+Vencimiento\s+CAE:\s*(\d{2}\/\d{2}\/\d{2})\b/i, 1);

const vencCae = vencCaeRaw
  ? (vencCaeRaw.length === 10 ? normalizeDate_ddmmyyyy(vencCaeRaw) : normalizeDate_ddmmyy_to_ddmmyyyy(vencCaeRaw))
  : null;

// ================= IVA % =================
const ivaPorc =
  parsePercent(pick(/\bTasa\b[\s\S]{0,80}\b(\d+(?:[.,]\d+)?)\s*%\b/i, 1)) ||
  parsePercent(pick(/\b([0-9]+(?:[.,][0-9]+)?)\s*%\b/i, 1)) ||
  21;

// ================= IMPORTES =================
const bonificacion = null;

// CHANGED: leer neto/iva/total por etiquetas (evita que "21.00%" termine como total)
const netoGravado =
  parseNumberMixed(pick(/\bNeto\s+Gravado\b[\s\S]{0,60}\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\b/i, 1)) ||
  null;

const iva21 =
  parseNumberMixed(pick(/\bI\.?V\.?A\.?\b[\s\S]{0,60}\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\b/i, 1)) ||
  null;

let total = null;
{
  const m = t.match(/\bTOTAL\b[\s\S]{0,80}\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\b/i);
  if (m) total = parseNumberMixed(m[1]);
}

// otros IVA en null
const iva27 = null, iva105 = null, iva5 = null, iva25 = null, iva0 = null;

// ================= CONCEPTOS =================
const conceptos = [];

// CHANGED: parsear líneas "CODIGO 1.00 DESCRIPCION 180000.00 180000.00"
function extractItems(text) {
  const res = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const m = line.match(
      /^([A-Z0-9]{3,})\s+(\d+(?:[.,]\d+)?)\s+(.+?)\s+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\s+(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))$/
    );
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

const items = extractItems(t);
conceptos.push(...items);

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

    fecha,              // "02/01/2026"
    vencimiento,        // "12/01/2026" (si querés usarlo así)

    emisorNombre,
    emisorCUIT,         // "30708245581"

    clienteNombre,      // "MKS SRL"
    clienteCUIT,        // "30711867240"

    condicionIVA,

    cae,
    vencCae,            // "12/01/2026"

    ivaPorc,            // 21

    bonificacion,
    netoGravado,        // 211000.00

    iva27,
    iva21,              // 44310.00
    iva105,
    iva5,
    iva25,
    iva0,

    total,              // 255310.00

    conceptos,          // 2 items

    invoiceKey,
  }
};
