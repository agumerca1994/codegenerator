const it = $input.item;

// El extractor puede dejar el texto en "text" o "texto"
const rawAll = (it.json.text ?? it.json.texto ?? "").toString();

// Normalización (primero normalizamos TODO)
const tAll = rawAll
  .replace(/\r/g, "\n")
  .replace(/[ \t]+/g, " ")
  .replace(/\n+/g, "\n")
  .trim();

// ✅ Nos quedamos SOLO con el bloque ORIGINAL para evitar triplicados
const t = tAll.split(/\nFecha de Emisión:\nDUPLICADO\b|\nFecha de Emisión:\nTRIPLICADO\b/i)[0].trim();

function pick(re, group = 1) {
  const m = t.match(re);
  return m ? (m[group] || "").trim() : null;
}

// Helpers numéricos AR
function parseArNumber(s) {
  if (!s) return null;
  const clean = s.replace(/\$/g, "").replace(/\s/g, "");
  const n = clean.replace(/\./g, "").replace(",", ".");
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function parseArPercent(s) {
  if (!s) return null;
  const v = parseArNumber(s.replace("%", "").trim());
  return Number.isFinite(v) ? v : null;
}

function normalizeCuit(cuit) {
  if (!cuit) return null;
  const digits = cuit.replace(/[^\d]/g, "");
  return digits.length === 11 ? digits : null;
}

// ================= CONCEPTOS (Ítems) =================
const lines = t.split("\n").map(l => l.trim()).filter(Boolean);

// Regex: descripción + cantidad + (unidad opcional) + precio + bonif + subtotal + alícuota + subtotal c/IVA
const itemRe =
  /^(.+?)\s+(\d+,\d{2})\s+(?:unidades|unidad|u\.?\s*medida)?\s*([\d\.]+,\d{2})\s+(\d+,\d{2})\s+([\d\.]+,\d{2})\s+(\d+(?:[.,]\d+)?)%?\s+([\d\.]+,\d{2})$/i;

const conceptosRaw = [];
for (let i = 0; i < lines.length; i++) {
  const candidate = [lines[i], lines[i + 1], lines[i + 2]].filter(Boolean).join(" ");
  const m = candidate.match(itemRe);
  if (!m) continue;

  conceptosRaw.push({
    cantidad: parseArNumber(m[2]),
    descripcion: m[1].trim(),
    precioUnitario: parseArNumber(m[3]),
    bonifPorc: parseArNumber(m[4]),
    ivaPorc: parseArPercent(m[6]),
    importe: parseArNumber(m[7]) ?? parseArNumber(m[5]) ?? null,
  });

  i += 2;
}

// ✅ Deduplicación por firma (por si el extractor repite líneas)
const seen = new Set();
const conceptos = [];
for (const c of conceptosRaw) {
  const key = [
    c.cantidad ?? "",
    (c.descripcion ?? "").toLowerCase(),
    c.precioUnitario ?? "",
    c.ivaPorc ?? "",
    c.importe ?? ""
  ].join("|");

  if (seen.has(key)) continue;
  seen.add(key);
  conceptos.push(c);
}

// ================= CAMPOS DE CABECERA =================

// Tipo comprobante
const tipoComprobante =
  pick(/\b(FACTURA|RECIBO|NOTA DE CR[ÉE]DITO|NOTA DE D[ÉE]BITO)\b/i) || "FACTURA";

// Tipo de factura: "FACTURA\nA\nCOD. 01"
const tipoFactura =
  pick(/\bFACTURA\s*\n\s*([ABCM])\s*\n\s*COD\.?\s*\d+\b/i) ||
  pick(/\bFACTURA\s+([ABCM])\b/i) ||
  pick(/\bFACTURA\s*\n\s*([ABCM])\b/i);

// Fecha de emisión (en tu ejemplo 01/11/2025)
const fecha = pick(/\b(\d{2}\/\d{2}\/\d{4})\b/);

// ✅ Vencimiento (tercera fecha del bloque 01/11/2025 01/12/2025 06/12/2025)
const vencimiento =
  pick(/Domicilio Comercial:\n(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/i, 3) ||
  pick(/Condici[oó]n frente al IVA:[\s\S]*?Domicilio Comercial:\n(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/i, 3);

// Punto de Venta + Comp. Nro (00003 00000938)
const pv = pick(/\bPunto de Venta:\s*Comp\.?\s*Nro:\s*\n\s*(\d{1,5})\s+(\d{1,12})/i, 1);
const cn = pick(/\bPunto de Venta:\s*Comp\.?\s*Nro:\s*\n\s*(\d{1,5})\s+(\d{1,12})/i, 2);

const puntoVenta = pv ? pv.padStart(5, "0") : null;
const numeroComprobante = cn ? cn.padStart(8, "0") : null;
const comprobante = (puntoVenta && numeroComprobante) ? `${puntoVenta}-${numeroComprobante}` : null;

// ✅ Emisor nombre (une 2 líneas después de ORIGINAL)
const emisorNombre = (() => {
  const a = pick(/Fecha de Emisi[oó]n:\nORIGINAL\n([^\n]+)\n([^\n]+)/i, 1);
  const b = pick(/Fecha de Emisi[oó]n:\nORIGINAL\n([^\n]+)\n([^\n]+)/i, 2);
  return (a && b) ? `${a} ${b}`.replace(/\s+/g, " ").trim() : (a ?? null);
})();

// Emisor CUIT: el CUIT aislado en línea (27263896756)
const emisorCUIT = normalizeCuit(pick(/(?:^|\n)(\d{11})(?:\n|$)/m, 1));

// ✅ Cliente CUIT + Nombre: "30711867240 MKS SRL"
const clienteCUIT =
  normalizeCuit(pick(/\n(\d{11})\s+MKS\s+S\.?R\.?L\.?/i, 1)) ||
  normalizeCuit(pick(/\n(\d{11})\s+[A-Z].+?\b(?:SRL|S\.R\.L\.|SA|S\.A\.)\b/i, 1));

const clienteNombre =
  (pick(/\n\d{11}\s+(MKS\s+S\.?R\.?L\.?)/i, 1) || pick(/\n\d{11}\s+([^\n]+)/i, 1))?.trim() ?? null;

// No es necesario
const condicionIVA = null;

// ✅ Venc CAE + CAE: del bloque N°CAE -> fecha -> CAE
const vencCae =
  pick(/N[°ºo]\s*CAE:\nFecha de Vto\. de CAE:[\s\S]*?\n(\d{2}\/\d{2}\/\d{4})\n(\d{10,20})/i, 1) ||
  pick(/CAE\s*N[°ºo]?:\nFecha de Vto\. de CAE:[\s\S]*?\n(\d{2}\/\d{2}\/\d{4})\n(\d{10,20})/i, 1);

const cae =
  pick(/N[°ºo]\s*CAE:\nFecha de Vto\. de CAE:[\s\S]*?\n(\d{2}\/\d{2}\/\d{4})\n(\d{10,20})/i, 2) ||
  pick(/CAE\s*N[°ºo]?:\nFecha de Vto\. de CAE:[\s\S]*?\n(\d{2}\/\d{2}\/\d{4})\n(\d{10,20})/i, 2);

// Totales
const netoGravado = parseArNumber(pick(/\bImporte Neto Gravado:\s*\$?\s*([\d\.\,]+)/i));
const total = parseArNumber(pick(/\bImportaci[oó]n Total:\s*\$?\s*([\d\.\,]+)/i));

// IVA por alícuota
const iva27  = parseArNumber(pick(/\bIVA\s*27%:\s*\$?\s*([\d\.\,]+)/i));
const iva21  = parseArNumber(pick(/\bIVA\s*21%:\s*\$?\s*([\d\.\,]+)/i));
const iva105 = parseArNumber(pick(/\bIVA\s*10[,\.]?5%:\s*\$?\s*([\d\.\,]+)/i));
const iva5   = parseArNumber(pick(/\bIVA\s*5%:\s*\$?\s*([\d\.\,]+)/i));
const iva25  = parseArNumber(pick(/\bIVA\s*2[,\.]?5%:\s*\$?\s*([\d\.\,]+)/i));
const iva0   = parseArNumber(pick(/\bIVA\s*0%:\s*\$?\s*([\d\.\,]+)/i));

// Clave anti duplicados
const invoiceKey = [
  emisorCUIT ?? "",
  tipoComprobante ?? "",
  tipoFactura ?? "",
  comprobante ?? "",
  fecha ?? "",
  total ?? ""
].join("|");

// ✅ SALIDA
return {
  json: {
    tipoComprobante,
    tipoFactura,
    comprobante,
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
    netoGravado,
    iva27,
    iva21,
    iva105,
    iva5,
    iva25,
    iva0,
    total,
    conceptos,
    invoiceKey,
  }
};
