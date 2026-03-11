const it = $input.item;

// El extractor te deja el texto en it.json.text
const raw = (it.json.text ?? "").toString();

// Normalización
const t = raw
  .replace(/\r/g, "\n")
  .replace(/[ \t]+/g, " ")
  .replace(/\n+/g, "\n")
  .trim();

function pick(re, group = 1) {
  const m = t.match(re);
  return m ? (m[group] || "").trim() : null;
}

// Helpers numéricos AR: 1.234.567,89  o $1.234.567,89
function parseArNumber(s) {
  if (!s) return null;
  const clean = s.replace(/\$/g, "").replace(/\s/g, "");
  const n = clean.replace(/\./g, "").replace(",", ".");
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function parseArPercent(s) {
  const v = parseArNumber(s);
  return Number.isFinite(v) ? v : null;
}

// ================= CONCEPTOS (Ítems) =================
const lines = t.split("\n").map(l => l.trim()).filter(Boolean);

// Regex: cantidad + descripción + precio unitario + IVA % + Bonif % + importe
const itemRe =
  /^(\d+)\s+(.+?)\s+([\d\.]+,\d{2})\s+(\d+,\d{2})\s*%\s+(\d+,\d{2})\s*%\s+([\d\.]+,\d{2})$/;

const conceptos = [];
for (const line of lines) {
  const m = line.match(itemRe);
  if (!m) continue;

  conceptos.push({
    cantidad: Number(m[1]),
    descripcion: m[2].trim(),
    precioUnitario: parseArNumber(m[3]),
    ivaPorc: parseArPercent(m[4]),
    bonifPorc: parseArPercent(m[5]),
    importe: parseArNumber(m[6]),
  });
}

// ================= CAMPOS DE CABECERA =================

// Tipo comprobante
const tipoComprobante = pick(/\b(FACTURA|RECIBO|NOTA DE CR[ÉE]DITO|NOTA DE D[ÉE]BITO)\b/i);

// Tipo de factura: A/B/C/M
const tipoFactura =
  pick(/\n([ABCM])\n\s*Cod\.\s*\d+\n\s*FACTURA/i) ||
  pick(/\bFACTURA\s+([ABCM])\b/i) ||
  pick(/\n([ABCM])\n\s*FACTURA/i);

// Nº: 0009-00001220
const comp = pick(/\bN[º°o]\s*:\s*(\d{4}-\d{8})/i);
const puntoVenta = comp ? comp.split("-")[0] : null;
const numeroComprobante = comp ? comp.split("-")[1] : null;

// Fechas
const fecha = pick(/\bFecha:\s*(\d{2}\/\d{2}\/\d{4})/i);
const vencimiento = pick(/\bVencimiento:\s*(\d{2}\/\d{2}\/\d{4})/i);

// Emisor / Cliente (en tu texto hay 2 CUIT)
const emisorNombre = pick(/\n([^\n]+S\.R\.L)\nBv\./i) || pick(/\n([^\n]+)\nBv\./i);
const emisorCUIT = pick(/\nCUIT:\s*(\d{11})\b/i);

const clienteNombre = pick(/\bRaz[oó]n social:\s*([^\n]+)/i);
const clienteCUIT = pick(/\bUbicaci[oó]n:.*?\bCUIT:\s*(\d{11})\b/i);

// Condición de IVA (cortamos antes de “Condición de venta” si viene pegado)
let condicionIVA = pick(/\bCondici[oó]n de IVA:\s*([^\n]+)/i);
if (condicionIVA) {
  condicionIVA = condicionIVA.split("Condición de venta")[0].trim();
}

// CAE
const cae = pick(/\bCAE:\s*(\d+)/i);
const vencCae = pick(/\bVencimiento CAE:\s*(\d{2}\/\d{2}\/\d{4})/i);

// Importes finales
const bonificacion = parseArNumber(pick(/\bBonificaci[oó]n:\s*\$?([\d\.\,]+)/i));
const netoGravado = parseArNumber(pick(/\bImporte Neto Gravado:\s*\$?([\d\.\,]+)/i));
const iva21 = parseArNumber(pick(/\bIVA\s*21%:\s*\$?([\d\.\,]+)/i));
const total = parseArNumber(pick(/\bImporte Total:\s*\$?([\d\.\,]+)/i));

// Clave anti duplicados
const invoiceKey = [
  emisorCUIT ?? "",
  tipoComprobante ?? "",
  tipoFactura ?? "",
  comp ?? "",
  fecha ?? "",
  total ?? ""
].join("|");

// ✅ SALIDA: SOLO LO ANALIZADO
return {
  json: {
    tipoComprobante,
    tipoFactura,
    comprobante: comp,
    puntoVenta,
    numeroComprobante,
    fecha,
    vencimiento,
    emisorNombre,
    emisorCUIT,
    clienteNombre,
    clienteCUIT,
    condicionIVA,
    cae,
    vencCae,
    bonificacion,
    netoGravado,
    iva21,
    total,
    conceptos,
    invoiceKey,
  }
};
