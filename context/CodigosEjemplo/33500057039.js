// n8n Code node (Run once for each item)
// Parser para factura "albacaucion" (ALBA CAUCIÓN)
// ✅ Agrega ivaPorc (21.00% / 21,00% / 21%) normalizado a número 21
// ✅ conceptos con ivaPorc = 21
// ✅ Detecta dinámicamente sellados provinciales (ej: "Prov. Sta. Fe Sellado 682,64")
//    para que funcione con otras provincias / nombres / importes (la info está en el campo texto)

const it = $input.item;
const raw = (it.json.texto ?? it.json.text ?? "").toString();

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

function normalizeCuit(cuit) {
  if (!cuit) return null;
  const digits = cuit.replace(/[^\d]/g, "");
  return digits.length === 11 ? digits : null;
}

// Número AR: 29.955,00 / 8.432,55 / 62.676,40
function parseArNumber(s) {
  if (!s) return null;
  const clean = s.replace(/\$/g, "").replace(/\s/g, "");
  const n = clean.replace(/\./g, "").replace(",", ".");
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

// Porcentaje flexible: "21.00%" / "21,00%" / "21%"
function parsePercent(s) {
  if (!s) return null;
  const clean = s.replace("%", "").trim();
  const n = clean.replace(",", ".");
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

// ================= CABECERA =================
const tipoComprobante = "FACTURA";

const tipoFactura =
  pick(/\n([ABCM])\n\s*C[ÓO]DIGO\b/i, 1) ||
  pick(/\b([ABCM])\b[\s\S]{0,60}\bC[ÓO]DIGO\b/i, 1) ||
  pick(/(?:^|\n)\s*([ABCM])\s*(?:\n|$)/i, 1);

// "0022-00468622"
const numeroComp =
  pick(/\bFactura\b\s*\n\s*(\d{4}-\d{8})\b/i, 1) ||
  pick(/\b(\d{4}-\d{8})\b/, 1);

const puntoVenta = numeroComp ? numeroComp.split("-")[0] : null;
const comprobante = numeroComp ?? null; // 0022-00468622
const numeroComprobante = numeroComp ? numeroComp.split("-")[1] : null; // 00468622

const fecha = pick(/\bFecha Emisi[oó]n:\s*(\d{2}\/\d{2}\/\d{4})\b/i, 1);

// Período "09/12/2025 al 09/12/2026" => vencimiento = 09/12/2026
const vencimiento =
  pick(/\bPer[ií]odo\s+\d{2}\/\d{2}\/\d{4}\s+al\s+(\d{2}\/\d{2}\/\d{4})\b/i, 1);

// ================= EMISOR =================
let emisorNombre = pick(/\bwww\.albacaucion\.com\.ar\b/i, 0) ? "albacaucion" : null;
const emisorCUIT = normalizeCuit(pick(/\bC\.?U\.?IT:\s*(\d{2}-\d{8}-\d|\d{11})\b/i, 1));

// Condición IVA (como estaba)
const condicionIVA =
  pick(/\bI\.?V\.?A:\s*([^\n]+)/i, 1) ||
  pick(/\bIVA:\s*([^\n]+)/i, 1) ||
  null;

// ================= CLIENTE =================
const clienteCUIT =
  normalizeCuit(pick(/\bCUIT:\s*(\d{11})\s+IVA:/i, 1)) ||
  normalizeCuit(pick(/\bCUIT:\s*(\d{11})\b/i, 1));

let clienteNombre =
  pick(/\b(\d{11})\s+(MKS\s+S\.?R\.?L\.?)\b/i, 2) ||
  pick(/\bMKS\s+S\.?R\.?L\.?\b/i, 0) ||
  pick(/\bASEGURADO\s*\n([^\n]+)\n/i, 1) ||
  null;

if (clienteNombre) {
  const up = clienteNombre.toUpperCase().replace(/\s+/g, " ").trim();
  if (up === "MKS SRL" || up === "MKS S.R.L." || up === "MKS S R L") {
    clienteNombre = "MKS S.R.L.";
  } else {
    clienteNombre = clienteNombre.replace(/\s+/g, " ").trim();
  }
}

// ================= CAE =================
const cae = pick(/\bCAE:\s*(\d{10,20})\b/i, 1);
const vencCae = pick(/\bFecha de Vencimiento:\s*(\d{2}\/\d{2}\/\d{4})\b/i, 1);

// ================= IVA % (NUEVO) =================
// Puede aparecer como "I.VA (21,00%)" o "21.00%" en el texto.
// Tomamos el primer match y lo normalizamos a número.
const ivaPorc =
  parsePercent(pick(/\bI\.?V\.?A\s*\(\s*([0-9]+(?:[.,][0-9]+)?)\s*%\s*\)/i, 1)) ||
  parsePercent(pick(/\b([0-9]+(?:[.,][0-9]+)?)\s*%\b/i, 1)) ||
  21; // fallback razonable en este tipo de factura (podés quitarlo si preferís null)

// ================= IMPORTES =================
const bonificacion = null;

// Neto gravado correcto: Subtotal 40.155,00
const netoGravado = parseArNumber(pick(/\bSubtotal\s+([\d\.]+,\d{2})\b/i, 1));

const iva21 =
  parseArNumber(pick(/\bI\.?V\.?A\b[^\n]*\b21[,\.]00%?\b[^\n]*\b([\d\.]+,\d{2})\b/i, 1)) ||
  parseArNumber(pick(/\bI\.?V\.?A\s*\(21,00%\)\s*([\d\.]+,\d{2})\b/i, 1));

const total = parseArNumber(pick(/\bTOTAL\b[^\n]*\n\s*([\d\.]+,\d{2})\b/i, 1));

// Otros IVA no presentes en este layout
const iva27 = null, iva105 = null, iva5 = null, iva25 = null, iva0 = null;

// ================= CONCEPTOS =================
function cleanSpaces(s) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Detecta sellados genéricos en el texto.
 * Ejemplos:
 *  - "Prov. Sta. Fe Sellado 682,64"
 *  - "Prov. CABA Sellado 123,45"
 *  - "Provincia de Santa Fe Sellado 682,64"
 * Captura:
 *  - label: todo el texto antes del importe (trim)
 *  - importe: número AR
 */
function detectSellados(text) {
  const res = [];

  // Tomamos líneas (el layout de esta factura lo trae línea por línea)
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // Regex flexible:
  // - empieza con Prov / Provincia (con o sin punto)
  // - contiene "Sellado"
  // - termina con un importe estilo AR 1.234,56
  const re = /^(?<label>(?:prov(?:incia)?\.?)\s+.*?\bsellado\b)\s+(?<importe>[\d\.]+,\d{2})$/i;

  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;

    const label = cleanSpaces(m.groups?.label || "");
    const importe = parseArNumber(m.groups?.importe || "");
    if (!label || importe == null) continue;

    res.push({ label, importe });
  }

  // Evitar duplicados exactos (por si el PDF repite líneas)
  const uniq = [];
  const seen = new Set();
  for (const r of res) {
    const k = `${r.label}|${r.importe}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(r);
  }
  return uniq;
}

// Concepto principal armado con Asegurado + Riesgo + Objeto + Póliza
const asegurado =
  pick(/\bASEGURADO\s*\n([^\n]+)\n/i, 1) ||
  pick(/\bASEGURADO\b\s*\n?([^\n]+)/i, 1);

const riesgo =
  pick(/\bRIESGO\b[\s\S]{0,120}/i, 0); // toma el bloque de riesgo

let objeto = null;
{
  const m = t.match(/\bOBJETO\b\s*\n([\s\S]*?)\nP[óo]liza\s*N[°ºo]?:/i);
  if (m) objeto = m[1];
}

const poliza = pick(/\bP[óo]liza\s*N[°ºo]?:\s*\n?\s*(\d+)/i, 1);

const mainDescripcion = cleanSpaces([
  asegurado ? `CORTE SUPREMA DE JUSTICIA DE LA NACION ${asegurado}` : "",
  riesgo ? cleanSpaces(riesgo.replace(/\n/g, " ")) : "",
  objeto ? cleanSpaces(objeto) : "",
  poliza ? `Póliza N°: ${poliza}.` : "",
].filter(Boolean).join(" "));

// Conceptos extra fijos (sin sellado hardcodeado)
const extraConcepts = [
  { label: "Impuestos y Tasas", re: /\bImpuestos y Tasas\s+([\d\.]+,\d{2})\b/i },

  // Percepción IIBB: capturar cualquier alícuota entre paréntesis
  { label: "Percepción IIBB", re: /\bPercepci[oó]n\s*IIBB\s*\([^\)]*\)\s+([\d\.]+,\d{2})\b/i },

  { label: "Gastos", re: /\bGastos\s+([\d\.]+,\d{2})\b/i },
];

const conceptos = [];

if (mainDescripcion) {
  conceptos.push({
    cantidad: 1,
    descripcion: mainDescripcion,
    precioUnitario: null,
    bonifPorc: null,
    ivaPorc, // ✅ agregado
    importe: null,
  });
}

// 1) Agregar conceptos extra fijos
for (const ex of extraConcepts) {
  const val = parseArNumber(pick(ex.re, 1));
  if (val == null) continue;
  conceptos.push({
    cantidad: 1,
    descripcion: ex.label,
    precioUnitario: null,
    bonifPorc: null,
    ivaPorc, // ✅ agregado
    importe: val,
  });
}

// 2) Agregar sellados detectados dinámicamente (Prov. X Sellado ...)
const sellados = detectSellados(t);
for (const s of sellados) {
  conceptos.push({
    cantidad: 1,
    descripcion: s.label, // ej: "Prov. Sta. Fe Sellado"
    precioUnitario: null,
    bonifPorc: null,
    ivaPorc,              // ✅ agregado
    importe: s.importe,   // ej: 682.64
  });
}

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

    comprobante,        // 0022-00469965 (string completo)
    puntoVenta,         // 0022
    numeroComprobante,  // 00469965 (solo número)

    fecha,
    vencimiento,

    emisorNombre,       // albacaucion
    emisorCUIT,         // normalizado

    clienteNombre,      // MKS S.R.L. si aparece
    clienteCUIT,

    condicionIVA,

    cae,
    vencCae,

    ivaPorc,            // ✅ NUEVO

    bonificacion,
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
