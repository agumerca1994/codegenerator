// n8n Code node (Run once for each item)
// Parser Factura A (AFIP) - layout como tu input (ORIGINAL/DUPLICADO/TRIPLICADO)
// Requisitos aplicados:
// - fecha: sale de "Domicilio Comercial:" (la del cliente) => 14/01/2026
// - vencimiento: IGUAL a fecha (pedido)
// - emisorNombre: FORZADO SIEMPRE a "AB GRAFICA"
// - concepto: se levanta desde la tabla ("certificado" u otro), no hardcodeado

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
  return m ? `${m[1]}/${m[2]}/${m[3]}` : s;
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
const tipoFactura = pick(block, /\bFACTURA\b[\s\S]{0,80}\b([ABCM])\b/i, 1) ?? null;

// ✅ Fecha: viene DESPUÉS de "Domicilio Comercial:" (en tu layout real)
const fechaRaw = pick(block, /Domicilio Comercial:\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i, 1);
const fecha = fechaRaw ? normalizeDate_ddmmyyyy(fechaRaw) : null;

// ✅ Vencimiento: IGUAL a fecha (pedido)
const vencimiento = fecha;

// Punto de venta + comprobante
const pvNc = block.match(/Punto de Venta:\s*Comp\. Nro:\s*\n\s*(\d{5})\s+(\d{8})/i);
const puntoVenta = pvNc ? pvNc[1] : null;
const numeroComprobante = pvNc ? pvNc[2] : null;
const comprobante = (puntoVenta && numeroComprobante) ? `${puntoVenta}-${numeroComprobante}` : null;

// CAE + vto CAE
const cae = pick(block, /\bCAE\s*N[°º]?:\s*\n\s*(\d{10,20})\b/i, 1);
const vencCaeRaw = pick(block, /Fecha de Vto\. de CAE:\s*\n\s*(\d{2}\/\d{2}\/\d{4})/i, 1);
const vencCae = vencCaeRaw ? normalizeDate_ddmmyyyy(vencCaeRaw) : null;

// ---------------- 3) Cliente ----------------
const clienteNombre =
  pick(block, /\b(ORIGINAL|DUPLICADO|TRIPLICADO)\b\s*\n\s*([A-ZÁÉÍÓÚÑ ]{3,})\s*\n/i, 2) ?? null;

const clienteCUIT = normalizeCuit(pick(block, /\bCUIT:\s*\n\s*(\d{11})\b/i, 1));

let clienteDomicilio = null;
{
  const m = block.match(
    /\b(ORIGINAL|DUPLICADO|TRIPLICADO)\b\s*\n\s*[A-ZÁÉÍÓÚÑ ]{3,}\s*\n([\s\S]{0,200}?)\n\s*CUIT:/i
  );
  if (m) clienteDomicilio = m[2].replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------- 4) Emisor (PROVEEDOR) ----------------
// ✅ FORZADO: siempre AB GRAFICA
const emisorNombre = "AB GRAFICA";

// CUIT del emisor: primer CUIT (11 dígitos) que NO sea el del cliente
let emisorCUIT = null;
{
  const cuits = [...block.matchAll(/\b(\d{11})\b/g)]
    .map(m => normalizeCuit(m[1]))
    .filter(Boolean);

  emisorCUIT = cuits.find(c => c && c !== clienteCUIT) ?? null;
}

// Condición IVA del emisor
const condicionIVA =
  pick(
    block,
    /Condición frente al IVA:\s*\n\s*(IVA\s+Responsable\s+Inscripto|Responsable\s+Inscripto|Monotributo|Exento|Consumidor\s+Final)\b/i,
    1
  ) ??
  pick(block, /\b(IVA\s+Responsable\s+Inscripto)\b/i, 1) ??
  null;

// ---------------- 5) Importes ----------------
const netoGravado = parseNumberAR(pick(block, /Importe Neto Gravado:\s*\$\s*([\d.,]+)/i, 1));
const iva21 = parseNumberAR(pick(block, /IVA\s*21%:\s*\$\s*([\d.,]+)/i, 1));
const total = parseNumberAR(pick(block, /Importe Total:\s*\$\s*([\d.,]+)/i, 1));

const ivaPorc = 21;

// ---------------- 6) Conceptos (tabla) ----------------
function extractItemsFromTable(text) {
  const startIdx = text.search(/Código Producto\s*\/\s*Servicio/i);
  if (startIdx < 0) return [];

  let slice = text.slice(startIdx);

  const endByCAE = slice.search(/\bCAE\b/i);
  const endByTotal = slice.search(/Importe\s+Total/i);

  let endIdx = -1;
  if (endByCAE >= 0 && endByTotal >= 0) endIdx = Math.min(endByCAE, endByTotal);
  else if (endByCAE >= 0) endIdx = endByCAE;
  else if (endByTotal >= 0) endIdx = endByTotal;

  if (endIdx > 0) slice = slice.slice(0, endIdx);

  const flat = slice
    .replace(/\r/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  const re =
    /(\d+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ.]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+(\d{1,2}(?:[.,]\d+)?)%\s+([\d.,]+)/g;

  const items = [];
  let m;
  while ((m = re.exec(flat)) !== null) {
    items.push({
      codigo: m[1],
      descripcion: m[2].replace(/\s+/g, " ").trim(),
      cantidad: parseNumberAR(m[3]),
      unidad: m[4],
      precioUnitario: parseNumberAR(m[5]),
      bonifPorc: parseNumberAR(m[6]),
      neto: parseNumberAR(m[7]),
      ivaPorc: parseNumberAR(m[8]) ?? ivaPorc,
      totalLinea: parseNumberAR(m[9]),
    });
  }

  return items;
}

const conceptos = extractItemsFromTable(block);
const concepto = conceptos[0]?.descripcion ?? null;

// ---------------- 7) invoiceKey ----------------
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

    comprobante,
    puntoVenta,
    numeroComprobante,

    fecha,
    vencimiento, // ✅ igual a fecha

    emisorNombre, // ✅ siempre "AB GRAFICA"
    emisorCUIT,

    clienteNombre,
    clienteCUIT,
    clienteDomicilio,

    condicionIVA,

    cae,
    vencCae,

    ivaPorc,

    netoGravado,

    iva27: parseNumberAR(pick(block, /IVA\s*27%:\s*\$\s*([\d.,]+)/i, 1)),
    iva21,
    iva105: parseNumberAR(pick(block, /IVA\s*10\.?5%:\s*\$\s*([\d.,]+)/i, 1)),
    iva5: parseNumberAR(pick(block, /IVA\s*5%:\s*\$\s*([\d.,]+)/i, 1)),
    iva25: parseNumberAR(pick(block, /IVA\s*2\.?5%:\s*\$\s*([\d.,]+)/i, 1)),
    iva0: parseNumberAR(pick(block, /IVA\s*0%:\s*\$\s*([\d.,]+)/i, 1)),

    total,

    concepto,
    conceptos,

    invoiceKey,
  }
};

