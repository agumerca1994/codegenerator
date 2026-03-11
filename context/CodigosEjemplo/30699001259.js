// n8n Code node (Run once for each item)
// Parser para factura "DEL METAL" (formato: FACTURA Nº 0007-00062684, C.AE, Fecha Vto., Base Cálculo, etc.)

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

// Parser numérico flexible (AR/US):
// - AR: 615.080,25
// - US: 615,080.25  (tu factura usa este)
function parseFlexNumber(s) {
  if (!s) return null;
  let x = s.replace(/\$/g, "").replace(/\s/g, "");

  const lastComma = x.lastIndexOf(",");
  const lastDot = x.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    // El decimal es el separador más a la derecha
    if (lastDot > lastComma) {
      // US: 615,080.25
      x = x.replace(/,/g, "");
    } else {
      // AR: 615.080,25
      x = x.replace(/\./g, "").replace(",", ".");
    }
  } else if (lastComma !== -1) {
    // Solo coma: si termina con ,dd => decimal AR; si no, miles US
    if (/,(\d{2})$/.test(x)) x = x.replace(/\./g, "").replace(",", ".");
    else x = x.replace(/,/g, "");
  } else {
    // Solo punto o ninguno
    const dots = (x.match(/\./g) || []).length;
    if (dots > 1) x = x.replace(/\./g, "");
  }

  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

// ================= CABECERA =================
const tipoComprobante = "FACTURA";

// Tipo factura (A/B/C/M): aparece como línea sola "A" antes de "IVA RESPONSABLE INSCRIPTO"
const tipoFactura =
  pick(/(?:^|\n)\s*([ABCM])\s*\n\s*IVA\s+RESPONSABLE\s+INSCRIPTO\b/i, 1) ||
  pick(/(?:^|\n)\s*([ABCM])\s*(?:\n|$)/i, 1);

// Comprobante: "FACTURA Nº 0007-00062684"
const comprobante = pick(/\bFACTURA\s*N[º°o]?\s*[: ]\s*(\d{4}-\d{8})\b/i, 1);
const puntoVenta = comprobante ? comprobante.split("-")[0] : null;
const numeroComprobante = comprobante ? comprobante.split("-")[1] : null;

// Fecha: suele ser la que aparece cerca de "FRB_FactElectA..." (15/12/25)
const fecha =
  pick(/\bFECHA:\s*\n?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i, 1) ||
  pick(/\bFECHA:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i, 1) ||
  pick(/(?:^|\n)(\d{1,2}\/\d{1,2}\/\d{2,4})\nFRB_FactElectA_/i, 1) ||
  (() => {
    const all = [...t.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g)].map(m => m[1]);
    // Evitar inicio actividad
    const filtered = all.filter(f => f !== "01/03/1999");
    return filtered[0] ?? all[0] ?? null;
  })();

// Vencimiento (del comprobante): "Fecha Vto.: 25/12/25"
const vencimiento = pick(/\bFecha\s*Vto\.?:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i, 1);

// ================= EMISOR =================
// Emisor nombre: línea exacta "DEL METAL SA" (normalizamos a "DEL METAL S.A.")
let emisorNombre =
  pick(/CORDOBA\s*-\n(DEL METAL SA)\n/i, 1) ||
  pick(/(?:^|\n)(DEL METAL SA)\n/i, 1) ||
  pick(/(?:^|\n)(DEL METAL S\.?A\.?)\n/i, 1);

if (emisorNombre) {
  const up = emisorNombre.toUpperCase().replace(/\s+/g, " ").trim();
  if (up === "DEL METAL SA" || up === "DEL METAL S.A." || up === "DEL METAL S A") {
    emisorNombre = "DEL METAL S.A.";
  } else {
    emisorNombre = emisorNombre.replace(/\s+/g, " ").trim();
  }
}

// Emisor CUIT: "C.UIT: 30-69900125-9"
const emisorCUIT =
  normalizeCuit(pick(/\bC\.?U\.?IT:\s*(\d{2}-\d{8}-\d|\d{11})\b/i, 1)) ||
  normalizeCuit(pick(/\bING\.?\s*BRUTOS:\s*(\d{2}-\d{8}-\d|\d{11})\b/i, 1)) ||
  normalizeCuit(pick(/\b30-\d{8}-\d\b/i, 0));

// ================= CLIENTE =================
// Cliente CUIT: "30-71186724-0 280457523 RESPONSABLE INSCRIPTO"
const clienteCUIT =
  normalizeCuit(pick(/\n(30-\d{8}-\d)\s+\d+\s*RESPONSABLE\s+INSCRIPTO/i, 1)) ||
  normalizeCuit(pick(/\n(30-\d{8}-\d)\b/i, 1));

// Cliente nombre: "MKS SRL (02403)" => "MKS S.R.L."
let clienteNombre = null;
if (pick(/\nMKS\s+SRL\s*\([0-9]+\)\n/i, 0)) {
  clienteNombre = "MKS S.R.L.";
} else {
  const n = pick(/\n([A-ZÁÉÍÓÚÑ0-9 .]+?)\s*\([0-9]+\)\n/i, 1);
  if (n && /MKS/i.test(n)) clienteNombre = "MKS S.R.L.";
}

// Condición IVA (si querés, dejala fija cuando aparece)
const condicionIVA = pick(/\bIVA\s+RESPONSABLE\s+INSCRIPTO\b/i, 0) ? "Responsable Inscripto" : null;

// ================= CAE =================
// CAE: "C.AE: 75509849139045"
const cae = pick(/\bC\.?A\.?E\.?:\s*(\d{10,20})\b/i, 1);

// En este formato no viene vencimiento de CAE explícito (no confundir con Fecha Vto. del comprobante)
const vencCae = null;

// ================= TOTALES / IVA =================

// Neto gravado: "615,080.25\nBase Cálculo"
const netoGravado =
  parseFlexNumber(pick(/\n([\d\.,]+)\nBase C[aá]lculo\b/i, 1)) ||
  parseFlexNumber(pick(/\bBase C[aá]lculo\b\s*\n?\s*([\d\.,]+)\b/i, 1));

// IVA 21%: en el bloque "21.00%" suele figurar el IVA (129,166.85)
let iva21 = null;
const ivaBlock = t.match(/21\.00%\s*[\s\S]{0,250}/i);
if (ivaBlock) {
  const nums = [...ivaBlock[0].matchAll(/([\d\.,]+\.\d{2}|[\d\.,]+,\d{2})/g)].map(m => m[1]);
  const vals = nums.map(parseFlexNumber).filter(v => typeof v === "number");

  if (vals.length >= 2) {
    // heurística: buscar diff entre el mayor "total c/iva" y el neto
    const neto = (netoGravado != null) ? netoGravado : vals[0];
    const totalciva = Math.max(...vals);
    const diff = totalciva - neto;

    // elegir el número más cercano al diff
    let best = null, bestD = Infinity;
    for (const v of vals) {
      const d = Math.abs(v - diff);
      if (d < bestD) { bestD = d; best = v; }
    }
    iva21 = best;
  }
}

// Total: si no está claro en "Total :" usamos neto + iva21, sino mayor monto del texto
const total =
  parseFlexNumber(pick(/\bTotal\s*:\s*\n?\s*([\d\.,]+)\b/i, 1)) ||
  parseFlexNumber(pick(/\bTotal\s*:\s*([\d\.,]+)\b/i, 1)) ||
  ((netoGravado != null && iva21 != null) ? (netoGravado + iva21) : null) ||
  (() => {
    const nums = [...t.matchAll(/\b(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})|\d+[.,]\d{2})\b/g)]
      .map(m => parseFlexNumber(m[1]))
      .filter(v => typeof v === "number");
    return nums.length ? Math.max(...nums) : null;
  })();

// IVA restantes (no aparecen en este layout; dejarlos en null)
const iva27 = null;
const iva105 = null;
const iva5 = null;
const iva25 = null;
const iva0 = null;

const bonificacion = null;

// ================= CONCEPTOS (best-effort + impuestos/percepciones) =================
// 1) Item principal (como ya lo hacías)
const conceptos = [];
const desc1 = pick(/\b(CHAPA PLOMO[^\n]+)\b/i, 1) || pick(/\bUN\s+([A-Z].+?)\n/i, 1);
if (desc1) {
  const qty = parseFlexNumber(pick(/\bUnidades\s*:\s*(\d+)\b/i, 1)) || null;

  conceptos.push({
    cantidad: qty,
    descripcion: desc1.trim(),
    precioUnitario: null,
    bonifPorc: null,
    ivaPorc: 21,
    importe: total ?? null,
  });
}

// 2) Impuestos / Tasas / Percepciones (formato pegado: "15,377.01Percep Percepcion II BB CBA")
const taxRegex = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\s*(Percep[^\n]+?)(?=\n|$)/gi;

// Si querés ampliar a otras etiquetas, reemplazá por esto:
// const taxRegex = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\s*((?:Percep|Perc|Ret|Tasa|Imp|Impuesto)[^\n]+?)(?=\n|$)/gi;

for (const m of t.matchAll(taxRegex)) {
  const importe = parseFlexNumber(m[1]);
  const descripcion = (m[2] || "").replace(/\s+/g, " ").trim();

  if (importe != null && descripcion) {
    conceptos.push({
      cantidad: 1,
      descripcion,
      precioUnitario: null,
      bonifPorc: null,
      ivaPorc: null,       // no aplica IVA directo a percepciones
      importe,
      tipo: "impuesto",    // opcional, útil para distinguir
    });
  }
}

// 3) Deduplicar por (descripcion+importe) por si el PDF repite el bloque
const seen = new Set();
const conceptosFinal = [];
for (const c of conceptos) {
  const key = `${(c.descripcion || "").toUpperCase()}|${c.importe}`;
  if (!seen.has(key)) {
    seen.add(key);
    conceptosFinal.push(c);
  }
}

// Usar el array final deduplicado
conceptos.length = 0;
conceptos.push(...conceptosFinal);

// ================= KEY =================
const invoiceKey = [
  emisorCUIT ?? "",
  tipoComprobante ?? "",
  tipoFactura ?? "",
  comprobante ?? "",
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
