const raw = (($json.texto ?? $json.text ?? "") + "").toString();

// ---------------- Normalización ----------------
let t = raw
  .replace(/\r/g, "\n")
  .replace(/[ \t]+/g, " ")
  .replace(/\n+/g, "\n")
  .trim()
  .replace(/\\"/g, '"');

// ---------------- Helpers ----------------
function pick(text, re, group = 1) {
  const m = text.match(re);
  return m ? (m[group] || "").trim() : null;
}

function normalizeCuit(s) {
  if (!s) return null;
  const digits = String(s).replace(/[^\d]/g, "");
  return digits.length === 11 ? digits : null;
}

function parseNumberAR(s) {
  if (!s) return null;

  let x = String(s).replace(/\$/g, "").trim();
  x = x.replace(/[^\d.,-]/g, "");
  if (!x) return null;

  const hasDot = x.includes(".");
  const hasComma = x.includes(",");

  if (hasDot && hasComma) {
    const lastDot = x.lastIndexOf(".");
    const lastComma = x.lastIndexOf(",");
    const decimalIsComma = lastComma > lastDot;

    if (decimalIsComma) {
      x = x.replace(/\./g, "").replace(",", ".");
    } else {
      x = x.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    x = x.replace(/\./g, "").replace(",", ".");
  } else {
    x = x.replace(/,/g, "");
  }

  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function normalizeDate_ddmmyyyy(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
}

function formatNumberAR(n, decimals = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return n.toFixed(decimals).replace(".", ",");
}

// ---------------- 1) Elegir SOLO ORIGINAL ----------------
let block = t;
const originalStart = t.search(/\bORIGINAL\b/i);
if (originalStart >= 0) {
  const afterOriginal = t.slice(originalStart);
  const cutIdx = afterOriginal.search(/\bDUPLICADO\b/i);
  block = cutIdx > 0 ? afterOriginal.slice(0, cutIdx).trim() : afterOriginal.trim();
}

// ---------------- 2) Campos base ----------------
const tipoComprobante = pick(block, /\b(FACTURA)\b/i, 1) ?? "FACTURA";
const tipoFactura = pick(block, /\bFACTURA\b[\s\S]{0,80}\b([ABCM])\b/i, 1) ?? "C";

// ---------------- 3) Fechas (layout de tu input) ----------------
let periodoDesde = null;
let periodoHasta = null;
let vtoPago = null;
let fecha = null;

{
  const m = block.match(
    /Período Facturado[\s\S]{0,250}?\n\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i
  );
  if (m) {
    periodoDesde = normalizeDate_ddmmyyyy(m[1]);
    periodoHasta = normalizeDate_ddmmyyyy(m[2]);
    vtoPago = normalizeDate_ddmmyyyy(m[3]);
    fecha = normalizeDate_ddmmyyyy(m[4]);
  }
}

if (!fecha) {
  const fechaRaw = pick(block, /\bFecha de Emisión:\s*[\s\S]{0,800}?\n\s*(\d{2}\/\d{2}\/\d{4})\b/i, 1);
  fecha = fechaRaw ? normalizeDate_ddmmyyyy(fechaRaw) : null;
}

const vencimiento = vtoPago ?? fecha;

// ---------------- 4) Emisor ----------------
const emisorNombre =
  pick(block, /Domicilio Comercial:\s*\n\s*Razón Social:\s*\n\s*([^\n]+)\b/i, 1) ??
  pick(block, /\bORIGINAL\b\s*\n\s*([A-ZÁÉÍÓÚÑ ]{3,})\s*\n/i, 1) ??
  null;

const emisorCUIT = normalizeCuit(
  pick(block, /\n\s*\d{2}\/\d{2}\/\d{4}\s*\n\s*(\d{11})\b/, 1)
);

// ---------------- 5) Cliente ----------------
let clienteNombre = null;
let clienteDomicilio = null;
let clienteCUIT = null;

if (emisorCUIT) {
  const m = block.match(new RegExp(
    String.raw`\b${emisorCUIT}\b\s*\n\s*(\d{11})\s+([^\n]+)\s*\n\s*([^\n]+)\s*\n`,
    "i"
  ));
  if (m) {
    clienteCUIT = normalizeCuit(m[1]);
    clienteNombre = (m[2] || "").trim();
    clienteDomicilio = (m[3] || "").trim();
  }
}

{
  const labeledCu = normalizeCuit(pick(block, /\bCUIT:\s*(\d{11})\b/i, 1));
  if (labeledCu && labeledCu !== emisorCUIT && !clienteCUIT) clienteCUIT = labeledCu;
}

// ---------------- 6) Punto de venta + comprobante ----------------
const pvNc = block.match(/Punto de Venta:\s*Comp\. Nro:\s*\n\s*(\d{5})\s+(\d{8})/i);
const puntoVenta = pvNc ? pvNc[1] : null;
const numeroComprobante = pvNc ? pvNc[2] : null;
const comprobante = (puntoVenta && numeroComprobante) ? `${puntoVenta}-${numeroComprobante}` : null;

// ---------------- 7) CAE + vto CAE ----------------
const cae = pick(block, /\bCAE\s*N[°º]?:\s*\n\s*(\d{10,20})\b/i, 1);

let vencCaeRaw = pick(block, /Fecha de Vto\. de CAE:\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i, 1);
if (!vencCaeRaw) {
  vencCaeRaw = pick(block, /Comprobante Autorizado[\s\S]{0,400}?\n\s*(\d{2}\/\d{2}\/\d{4})\b/i, 1);
}
const vencCae = vencCaeRaw ? normalizeDate_ddmmyyyy(vencCaeRaw) : null;

// ---------------- 8) Un solo concepto ----------------
let concepto =
  pick(block, /\n\s*\d{2}\s+([^\n]+?)\s+\d+(?:[.,]\d+)?\s+unidades?\b/i, 1) ??
  "Servicios";

concepto = String(concepto).replace(/\s+/g, " ").trim();

// ---------------- 9) Importes (IVA 21) ----------------
// IMPORTANTE: acá devolvemos NUMBERS en los campos "originales" para que n8n IF no falle.
const netoGravadoNumero = parseNumberAR(
  pick(block, /Importe Neto Gravado:\s*\$?\s*\n?\s*([\d.,]+)/i, 1)
);

const iva21Numero = parseNumberAR(
  pick(block, /IVA\s*21%:\s*\$?\s*\n?\s*([\d.,]+)/i, 1)
);

const totalNumero = parseNumberAR(
  pick(block, /Importe Total:\s*\$?\s*\n?\s*([\d.,]+)/i, 1)
);

// ✅ estos 3 salen NUMÉRICOS (lo que tu IF espera)
const netoGravado = netoGravadoNumero; // number
const iva21 = iva21Numero;             // number
const total = totalNumero;             // number

// ✅ y acá van los strings AR para mostrar (si los necesitás)
const netoGravadoStr = netoGravadoNumero != null ? formatNumberAR(netoGravadoNumero, 2) : null;
const iva21Str = iva21Numero != null ? formatNumberAR(iva21Numero, 2) : null;
const totalStr = totalNumero != null ? formatNumberAR(totalNumero, 2) : null;

// ✅ IVA seteado como en tu esquema
const ivaPorc = 21;

// ---------------- 10) Conceptos (array con 1 item, compatibilidad) ----------------
const conceptos = [{
  codigo: null,
  descripcion: concepto,
  cantidad: null,
  unidad: null,
  precioUnitario: null,

  // neto por línea = neto total (un solo concepto)
  neto: netoGravadoNumero,
  totalLinea: netoGravadoNumero,

  ivaPorc: 21,
}];

// ---------------- 11) Condición IVA ----------------
const condicionIVA =
  (block.match(/\bIVA Responsable Inscripto\b/i) ? "IVA Responsable Inscripto" : null);

// ---------------- 12) invoiceKey ----------------
const invoiceKey = [
  emisorCUIT ?? "",
  tipoComprobante ?? "",
  tipoFactura ?? "",
  numeroComprobante ?? "",
  fecha ?? "",
  totalNumero ?? ""
].join("|");

return {
  json: {
    tipoComprobante,
    tipoFactura,

    comprobante,
    puntoVenta,
    numeroComprobante,

    fecha,
    vencimiento,

    periodoDesde,
    periodoHasta,
    vtoPago,

    emisorNombre,
    emisorCUIT,

    clienteNombre,
    clienteCUIT,
    clienteDomicilio,

    condicionIVA,

    cae,
    vencCae,

    // ✅ IVA 21 donde corresponde
    ivaPorc,       // 21
    iva21,         // NUMBER (para IF)
    iva21Numero,   // NUMBER (alias)

    // ✅ Importes
    netoGravado,       // NUMBER (para IF)
    netoGravadoNumero, // NUMBER

    total,             // NUMBER (para IF)
    totalNumero,       // NUMBER

    // ✅ strings “AR” (si querés guardar/mostrar con coma)
    netoGravadoStr,
    iva21Str,
    totalStr,

    // ✅ un solo concepto / un solo importe (sin IVA)
    concepto,
    conceptos,

    invoiceKey,
  }
};
