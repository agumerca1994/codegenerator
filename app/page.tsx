"use client";

import { useEffect, useMemo, useState } from "react";
import { CodeOutput } from "@/components/CodeOutput";
import { FieldsTable } from "@/components/FieldsTable";
import { PdfUploader } from "@/components/PdfUploader";
import { StepIndicator } from "@/components/StepIndicator";
import { TemplateEditor } from "@/components/TemplateEditor";
import { TextInput } from "@/components/TextInput";
import type { GeneratedCode, InputMode } from "@/lib/types";

const EXAMPLE_TEXT = `AV. BELGRANO 875 PB
(1092) CAPITAL FEDERAL
Tel / Fax: 0810 220 9411
www.albacaucion.com.ar
I.V.A.: Responsable Inscripto
C.U.I.T.: 33-50005703-9
Factura
0022-00486444
Fecha Emisión: 01/03/2026
Plazo Pago: CONTADO
TOMADOR
MKS S.R.L.
AVDA. LA CORDILLERA N3610, CORDOBA
CUIT: 30711867240 I.V.A.: IVA Responsable Inscripto
Prima 29.955,00
Cargo Suscrip. Riesgo 10.200,00
Subtotal 40.155,00
I.V.A. (21,00%) 8.432,55
TOTAL en PESOS 49.470,97
CAE: 86095793967455 Fecha de Vencimiento: 11/03/2026`;

const GENERATING_MESSAGES = ["Analizando factura con IA...", "Generando código JavaScript..."];

export default function HomePage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [inputMode, setInputMode] = useState<InputMode>("pdf");
  const [extractedText, setExtractedText] = useState("");
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<GeneratedCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  useEffect(() => {
    if (!isGenerating) {
      setLoadingMessageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % GENERATING_MESSAGES.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [isGenerating]);

  const canGenerate = useMemo(() => {
    return extractedText.trim().length >= 50 && !isGenerating && !isExtracting;
  }, [extractedText, isGenerating, isExtracting]);

  const handleGenerate = async () => {
    if (!canGenerate) return;

    setError(null);
    setWarning(null);
    setStep(2);
    setIsGenerating(true);

    try {
      const response = await fetch("/api/generate-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: extractedText, fileName: sourceFileName })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "No se pudo generar el código. Intenta nuevamente.");
      }

      const data = (await response.json()) as GeneratedCode;
      setGeneratedCode(data);
      setStep(3);

      if (data.confidence < 50) {
        const details = data.quality?.issues?.length ? ` ${data.quality.issues.slice(0, 2).join(" | ")}` : "";
        setWarning(`Baja confianza en el parsing, revisa el código generado.${details}`);
      }
    } catch (generateError) {
      setStep(1);
      setGeneratedCode(null);
      setError(generateError instanceof Error ? generateError.message : "Error inesperado generando código.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleTextExtracted = (text: string, fileName?: string) => {
    setExtractedText(text);
    setSourceFileName(fileName ?? null);
    setError(null);
    setWarning(null);
    setGeneratedCode(null);
    setStep(1);
  };

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-lg border border-blue-500/40 bg-blue-500/15 px-2 py-1 text-blue-300">{"</>"}</div>
            <h1 className="text-2xl font-semibold">Invoice Parser Generator</h1>
            <span className="ml-auto rounded-full border border-blue-500/40 bg-blue-500/15 px-3 py-1 text-xs text-blue-300">
              Powered by GPT-5.3 Codex
            </span>
          </div>
          <p className="text-sm text-gray-400">Genera código JavaScript para n8n a partir de facturas PDF</p>
        </header>

        {inputMode !== "templates" && <StepIndicator currentStep={step} />}

        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
        {warning && (
          <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">{warning}</div>
        )}

        <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setInputMode("pdf")}
              className={`rounded-lg px-3 py-2 text-sm ${
                inputMode === "pdf" ? "bg-blue-500 text-white" : "bg-gray-800 text-gray-300"
              }`}
            >
              Subir PDF
            </button>
            <button
              type="button"
              onClick={() => setInputMode("text")}
              className={`rounded-lg px-3 py-2 text-sm ${
                inputMode === "text" ? "bg-blue-500 text-white" : "bg-gray-800 text-gray-300"
              }`}
            >
              Pegar Texto
            </button>
            <button
              type="button"
              onClick={() => {
                setInputMode("templates");
                setGeneratedCode(null);
                setError(null);
                setWarning(null);
              }}
              className={`rounded-lg px-3 py-2 text-sm ${
                inputMode === "templates" ? "bg-blue-500 text-white" : "bg-gray-800 text-gray-300"
              }`}
            >
              Plantillas
            </button>
            <button
              type="button"
              onClick={() => {
                setInputMode("text");
                setGeneratedCode(null);
                setError(null);
                setWarning(null);
                handleTextExtracted(EXAMPLE_TEXT);
              }}
              className="ml-auto rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:border-gray-500"
            >
              Cargar ejemplo
            </button>
          </div>

          {inputMode === "templates" ? (
            <TemplateEditor />
          ) : inputMode === "pdf" ? (
            <PdfUploader
              onTextExtracted={(text, fileName) => handleTextExtracted(text, fileName)}
              isLoading={isExtracting}
              setIsLoading={setIsExtracting}
            />
          ) : (
            <TextInput value={extractedText} onChange={(text) => handleTextExtracted(text)} />
          )}
          {inputMode !== "templates" && (
            <div className="mt-6 border-t border-gray-800 pt-4">
              <button
                type="button"
                disabled={!canGenerate}
                onClick={handleGenerate}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {GENERATING_MESSAGES[loadingMessageIndex]}
                  </>
                ) : (
                  "Generar Código"
                )}
              </button>
              <p className="mt-2 text-xs text-gray-500">Se requieren al menos 50 caracteres de texto para generar.</p>
            </div>
          )}
        </section>

        {inputMode !== "templates" && generatedCode && (
          <section className="space-y-4">
            <FieldsTable fields={generatedCode.fields} />
            <CodeOutput generatedCode={generatedCode} />
          </section>
        )}
      </div>
    </main>
  );
}

