import fs from "node:fs";
import path from "node:path";
import { Script, createContext } from "node:vm";
import pdfParse from "pdf-parse";

const ROOT = process.cwd();
const CONTEXT_DIR = path.join(ROOT, "context");
const CODES_DIR = path.join(CONTEXT_DIR, "CodigosEjemplo");
const INPUT_EXAMPLE = path.join(CONTEXT_DIR, "Input", "EntradaEjemplo.json");
const OUTPUT_EXAMPLE = path.join(CONTEXT_DIR, "Output", "salida.json");
const PDF_DIR = path.join(CONTEXT_DIR, "FacturasProveedores");

const REQUIRED_KEYS = [
  "tipoComprobante",
  "comprobante",
  "puntoVenta",
  "numeroComprobante",
  "fecha",
  "emisorCUIT",
  "clienteCUIT",
  "cae",
  "netoGravado",
  "iva21",
  "total",
  "conceptos",
  "invoiceKey"
];

function normalizeText(raw) {
  return String(raw ?? "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

function isPresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && value !== undefined;
}

function computeCoverage(payload) {
  const missing = REQUIRED_KEYS.filter((key) => !isPresent(payload?.[key]));
  const score = Math.round(((REQUIRED_KEYS.length - missing.length) / REQUIRED_KEYS.length) * 100);
  return { score, missing };
}

function executeN8nCode(code, text) {
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
  const result = script.runInContext(sandbox, { timeout: 1500 });
  if (result && typeof result === "object" && result.json && typeof result.json === "object") {
    return result.json;
  }
  if (result && typeof result === "object") {
    return result;
  }
  throw new Error("Parser did not return an object");
}

function loadExampleFixture() {
  const input = JSON.parse(fs.readFileSync(INPUT_EXAMPLE, "utf8"));
  const expected = JSON.parse(fs.readFileSync(OUTPUT_EXAMPLE, "utf8"));
  const text = normalizeText(input?.[0]?.text ?? "");
  return {
    name: "EntradaEjemplo.json",
    text,
    expected: expected?.[0] ?? null
  };
}

async function loadPdfFixtures() {
  const fixtures = [];
  const files = fs
    .readdirSync(PDF_DIR)
    .filter((file) => file.toLowerCase().endsWith(".pdf"))
    .sort();

  for (const file of files) {
    const fullPath = path.join(PDF_DIR, file);
    const buffer = fs.readFileSync(fullPath);
    const parsed = await pdfParse(buffer);
    fixtures.push({
      name: file,
      text: normalizeText(parsed?.text ?? ""),
      expected: null
    });
  }

  return fixtures;
}

function compareExpected(actual, expected) {
  if (!expected) return { matched: null, total: null };

  let total = 0;
  let matched = 0;

  for (const key of REQUIRED_KEYS) {
    total += 1;
    const a = actual?.[key];
    const e = expected?.[key];
    if (Array.isArray(e)) {
      if (Array.isArray(a) && a.length > 0) matched += 1;
      continue;
    }
    if (typeof e === "number") {
      if (typeof a === "number" && Number.isFinite(a)) {
        const diff = Math.abs(a - e);
        if (diff < 0.01) matched += 1;
      }
      continue;
    }
    if (typeof e === "string") {
      if (typeof a === "string" && a.trim().length > 0) {
        if (a.trim() === e.trim()) matched += 1;
      }
      continue;
    }
    if ((a ?? null) === (e ?? null)) matched += 1;
  }

  return { matched, total };
}

async function main() {
  const parsers = fs
    .readdirSync(CODES_DIR)
    .filter((file) => file.endsWith(".js"))
    .sort();

  const fixtures = [loadExampleFixture(), ...(await loadPdfFixtures())];

  console.log(`Parsers: ${parsers.length}`);
  console.log(`Fixtures: ${fixtures.length}`);

  const rows = [];

  for (const parserName of parsers) {
    const parserCode = fs.readFileSync(path.join(CODES_DIR, parserName), "utf8");

    for (const fixture of fixtures) {
      try {
        const output = executeN8nCode(parserCode, fixture.text);
        const coverage = computeCoverage(output);
        const expectedMatch = compareExpected(output, fixture.expected);

        rows.push({
          parser: parserName,
          fixture: fixture.name,
          ok: true,
          coverage: coverage.score,
          missing: coverage.missing.join(","),
          expectedMatch:
            expectedMatch.total === null ? "n/a" : `${expectedMatch.matched}/${expectedMatch.total}`
        });
      } catch (error) {
        rows.push({
          parser: parserName,
          fixture: fixture.name,
          ok: false,
          coverage: 0,
          missing: "execution_error",
          expectedMatch: "n/a",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  const okRows = rows.filter((row) => row.ok);
  const avgCoverage =
    okRows.length > 0
      ? Math.round(okRows.reduce((sum, row) => sum + row.coverage, 0) / okRows.length)
      : 0;

  console.log(`\nAverage coverage on successful runs: ${avgCoverage}%`);

  const failed = rows.filter((row) => !row.ok);
  if (failed.length > 0) {
    console.log(`Failed executions: ${failed.length}`);
  }

  console.log("\nDetailed results:");
  for (const row of rows) {
    const base = `${row.ok ? "OK" : "ERR"} | ${row.parser} | ${row.fixture} | coverage=${row.coverage}% | expected=${row.expectedMatch}`;
    if (row.ok) {
      console.log(base + (row.missing ? ` | missing=${row.missing}` : ""));
    } else {
      console.log(base + ` | ${row.error}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
