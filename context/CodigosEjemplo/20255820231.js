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

// ---------------- 3) Fechas (layout de este input) ----------------
// ... "Período Facturado Desde: Hasta: Fecha de Vto. para el pago:"
// luego: "01/12/2025 31/12/2025 08/01/2026"
// luego: "31/12/2025" (fecha de emisión)
let periodoDesde = null;
let periodoHasta = null;
let vtoPago = null;
let fecha = null;

{
  const m = block.match(
    /Período Facturado[\s\S]{0,200}?\n\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i
  );
  if (m) {
    periodoDesde = normalizeDate_ddmmyyyy(m[1]);
    periodoHasta = normalizeDate_ddmmyyyy(m[2]);
    vtoPago = normalizeDate_ddmmyyyy(m[3]);
    fecha = normalizeDate_ddmmyyyy(m[4]);
  }
}

// Fallback: si sólo aparece una fecha de emisión
if (!fecha) {
  const fechaRaw = pick(block, /\bFecha de Emisión:\s*[\s\S]{0,800}?\n\s*(\d{2}\/\d{2}\/\d{4})\b/i, 1);
  fecha = fechaRaw ? normalizeDate_ddmmyyyy(fechaRaw) : null;
}

// ✅ vencimiento: en este caso lo más consistente es el vto de pago (si existe)
const vencimiento = vtoPago ?? fecha;

// ---------------- 4) Emisor (Proveedor) ----------------
const emisorNombre =
  pick(block, /Domicilio Comercial:\s*\n\s*Razón Social:\s*\n\s*([^\n]+)\b/i, 1) ??
  pick(block, /\bORIGINAL\b\s*\n\s*([A-ZÁÉÍÓÚÑ ]{3,})\s*\n/i, 1) ??
  null;

// ✅ emisorCUIT: viene como "31/12/2025\n33717685259\n..."
const emisorCUIT = normalizeCuit(
  pick(block, /\n\s*\d{2}\/\d{2}\/\d{4}\s*\n\s*(\d{11})\b/, 1)
);

// ---------------- 5) Cliente ----------------
// En este input aparece: "30711867240 MKS S.R.L." en una sola línea.
let clienteNombre = null;
let clienteDomicilio = null;
let clienteCUIT = null;

if (emisorCUIT) {
  // Caso A: CUIT + Nombre en la misma línea
  let m = block.match(new RegExp(
    String.raw`\b${emisorCUIT}\b\s*\n\s*(\d{11})\s+([^\n]+)\s*\n\s*([^\n]+)\s*\n`,
    "i"
  ));
  if (m) {
    clienteCUIT = normalizeCuit(m[1]);
    clienteNombre = (m[2] || "").trim();
    clienteDomicilio = (m[3] || "").trim();
  } else {
    // Caso B: Nombre en línea siguiente (fallback)
    m = block.match(new RegExp(
      String.raw`\b${emisorCUIT}\b\s*\n\s*([^\n]+)\s*\n\s*([^\n]+)\s*\n`,
      "i"
    ));
    if (m) {
      clienteNombre = (m[1] || "").trim();
      clienteDomicilio = (m[2] || "").trim();
    }
  }
}

// Si aparece algún CUIT etiquetado, úsalo sólo si no pisa el emisor
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

// ---------------- 8) Conceptos (tabla) ----------------
function extractItemsFromTable(text) {
  const startIdx = text.search(/Código Producto\s*\/\s*Servicio/i);
  if (startIdx < 0) return [];

  let slice = text.slice(startIdx);

  const cutCandidates = [
    slice.search(/Importe Neto Gravado:/i),
    slice.search(/Importe Total:/i),
    slice.search(/\bCAE\b/i),
  ].filter(x => x >= 0);

  if (cutCandidates.length) {
    const endIdx = Math.min(...cutCandidates);
    if (endIdx > 0) slice = slice.slice(0, endIdx);
  }

  const flat = slice
    .replace(/\r/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  // Estructura esperada por línea (según tu texto):
  // codigo + descripcion + cantidad + unidad + precioUnit + bonif + neto + IVA% + totalConIVA
  const re =
    /(\d+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ.]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+(\d+(?:[.,]\d+)?)%\s+([\d.,]+)(?=\s+\d+\s+.+?\s+\d+(?:[.,]\d+)?\s+[A-Za-zÁÉÍÓÚÑáéíóúñ.]+|$)/g;

  const items = [];
  let m;
  while ((m = re.exec(flat)) !== null) {
    const codigo = m[1];
    const descripcion = m[2].replace(/\s+/g, " ").trim();
    const cantidad = parseNumberAR(m[3]);
    const unidad = (m[4] || "").trim();

    const precioUnitario = parseNumberAR(m[5]);
    const bonif = parseNumberAR(m[6]); // por si la querés luego
    const netoLinea = parseNumberAR(m[7]);
    const ivaPct = parseNumberAR(m[8]);
    const totalLinea = parseNumberAR(m[9]);

    items.push({
      codigo,
      descripcion,
      cantidad,
      unidad,
      precioUnitario,
      bonif,
      neto: netoLinea,
      totalLinea: totalLinea,
      ivaPorc: ivaPct,
    });
  }

  return items;
}

const conceptos = extractItemsFromTable(block);
const concepto = conceptos[0]?.descripcion ?? null;

// ---------------- 9) Importes (Factura A con IVA) ----------------
const netoNumeroDesdeLabel = parseNumberAR(
  pick(block, /Importe Neto Gravado:\s*\$?\s*\n?\s*([\d.,]+)/i, 1)
);

const iva21NumeroDesdeLabel = parseNumberAR(
  pick(block, /IVA\s*21%:\s*\$?\s*\n?\s*([\d.,]+)/i, 1)
);

const totalNumeroDesdeLabel = parseNumberAR(
  pick(block, /Importe Total:\s*\$?\s*\n?\s*([\d.,]+)/i, 1)
);

// Fallback por si faltaran labels (sumatoria de netos de la tabla)
let netoNumeroDesdeTabla = null;
if (Array.isArray(conceptos) && conceptos.length) {
  const sum = conceptos.reduce((acc, it) => acc + (Number(it.neto) || 0), 0);
  netoNumeroDesdeTabla = Number.isFinite(sum) && sum > 0 ? sum : null;
}

// Neto final
const netoGravadoNumero = netoNumeroDesdeLabel ?? netoNumeroDesdeTabla ?? null;

// Total final: label si está; si no, neto + iva21 si existe; si no, suma totales de línea
let totalNumero = totalNumeroDesdeLabel ?? null;
if (totalNumero == null && netoGravadoNumero != null && iva21NumeroDesdeLabel != null) {
  totalNumero = netoGravadoNumero + iva21NumeroDesdeLabel;
}
if (totalNumero == null && Array.isArray(conceptos) && conceptos.length) {
  const sumTot = conceptos.reduce((acc, it) => acc + (Number(it.totalLinea) || 0), 0);
  totalNumero = Number.isFinite(sumTot) && sumTot > 0 ? sumTot : null;
}

// IVA (porcentaje “principal”)
const ivaPorc = (iva21NumeroDesdeLabel != null || conceptos.some(x => Number(x.ivaPorc) === 21)) ? 21 : null;
const iva21 = iva21NumeroDesdeLabel != null ? formatNumberAR(iva21NumeroDesdeLabel, 2) : null;

// Strings AR
const netoGravado = netoGravadoNumero != null ? formatNumberAR(netoGravadoNumero, 2) : null;
const total = totalNumero != null ? formatNumberAR(totalNumero, 2) : null;

// ---------------- 10) Condición IVA (mejor match para este layout) ----------------
const condicionIVA =
  pick(block, /FACTURA\s*\n\s*[ABCM]\s*\n\s*COD\.\s*\d+\s*\n\s*([^\n]+)/i, 1) ??
  pick(block, /\bIVA\s+Responsable\s+Inscripto\b/i, 0) ??
  null;

// ---------------- 11) invoiceKey ----------------
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

    ivaPorc, // 21
    iva21,   // "1002921,08" (si vino en label)

    netoGravado,
    netoGravadoNumero,

    total,
    totalNumero,

    concepto,
    conceptos,

    invoiceKey,
  }
};
