import fs from "node:fs";
import path from "node:path";
import pdfParse from "pdf-parse";

const API_URL = process.env.BENCH_API_URL ?? "http://localhost:3000";
const ROOT = process.cwd();
const CONTEXT_DIR = path.join(ROOT, "context");
const INPUT_EXAMPLE = path.join(CONTEXT_DIR, "Input", "EntradaEjemplo.json");
const PDF_DIR = path.join(CONTEXT_DIR, "FacturasProveedores");

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

function loadExampleText() {
  const input = JSON.parse(fs.readFileSync(INPUT_EXAMPLE, "utf8"));
  return {
    name: "EntradaEjemplo.json",
    text: normalizeText(input?.[0]?.text ?? "")
  };
}

async function loadPdfFixtures() {
  const files = fs
    .readdirSync(PDF_DIR)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .sort();

  const fixtures = [];
  for (const file of files) {
    const fullPath = path.join(PDF_DIR, file);
    const buffer = fs.readFileSync(fullPath);
    const parsed = await pdfParse(buffer);
    fixtures.push({
      name: file,
      text: normalizeText(parsed?.text ?? "")
    });
  }

  return fixtures;
}

function basicValidate(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") errors.push("response_no_object");
  if (!payload.provider) errors.push("missing_provider");
  if (typeof payload.confidence !== "number") errors.push("missing_confidence");
  if (!Array.isArray(payload.fields)) errors.push("missing_fields");
  if (typeof payload.code !== "string" || payload.code.length < 80) errors.push("missing_code");
  if (!payload.quality || typeof payload.quality !== "object") errors.push("missing_quality");
  return errors;
}

async function benchmarkFixture(fixture) {
  const response = await fetch(`${API_URL}/api/generate-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text: fixture.text })
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      fixture: fixture.name,
      status: response.status,
      error: json?.error ?? "unknown_error"
    };
  }

  const errors = basicValidate(json);
  return {
    ok: errors.length === 0,
    fixture: fixture.name,
    status: response.status,
    confidence: json?.confidence ?? null,
    profile: json?.quality?.profile ?? "n/a",
    source: json?.quality?.selectedSource ?? "n/a",
    issues: Array.isArray(json?.quality?.issues) ? json.quality.issues.slice(0, 3).join(" | ") : "",
    errors
  };
}

async function main() {
  const fixtures = [loadExampleText(), ...(await loadPdfFixtures())];
  console.log(`Benchmark API against ${API_URL}`);
  console.log(`Fixtures: ${fixtures.length}`);

  const results = [];
  for (const fixture of fixtures) {
    results.push(await benchmarkFixture(fixture));
  }

  const okCount = results.filter((row) => row.ok).length;
  console.log(`\nPassed: ${okCount}/${results.length}`);

  for (const row of results) {
    if (row.ok) {
      console.log(`OK  | ${row.fixture} | confidence=${row.confidence} | profile=${row.profile} | source=${row.source}`);
      if (row.issues) console.log(`     issues=${row.issues}`);
    } else {
      const msg = row.error ?? row.errors?.join(",") ?? "failed";
      console.log(`ERR | ${row.fixture} | status=${row.status} | ${msg}`);
    }
  }

  if (okCount !== results.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
