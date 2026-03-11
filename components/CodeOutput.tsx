"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { GeneratedCode } from "@/lib/types";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false
});

interface CodeOutputProps {
  generatedCode: GeneratedCode;
}

export function CodeOutput({ generatedCode }: CodeOutputProps) {
  const [copied, setCopied] = useState(false);

  const confidenceClass = useMemo(() => {
    if (generatedCode.confidence > 80) return "bg-green-500/15 text-green-400 border-green-500/40";
    if (generatedCode.confidence >= 50) return "bg-yellow-500/15 text-yellow-400 border-yellow-500/40";
    return "bg-red-500/15 text-red-400 border-red-500/40";
  }, [generatedCode.confidence]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedCode.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const safeName = generatedCode.provider.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const blob = new Blob([generatedCode.code], { type: "application/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeName || "invoice-parser"}.js`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-blue-500/40 bg-blue-500/15 px-3 py-1 text-xs text-blue-300">
            {generatedCode.provider}
          </span>
          <span className={`rounded-full border px-3 py-1 text-xs ${confidenceClass}`}>
            Confianza: {generatedCode.confidence}%
          </span>
          {generatedCode.quality?.profile && (
            <span className="rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-300">
              Perfil: {generatedCode.quality.profile}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 hover:border-gray-500"
          >
            {copied ? "¡Copiado!" : "Copiar código"}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm text-blue-300 hover:border-blue-400"
          >
            Descargar .js
          </button>
        </div>
      </div>

      {generatedCode.quality && (
        <div className="mb-4 rounded-lg border border-gray-800 bg-gray-950/70 p-3 text-xs text-gray-300">
          <div className="mb-2 flex flex-wrap gap-2">
            {generatedCode.quality.selectedSource && <span>Fuente: {generatedCode.quality.selectedSource}</span>}
            <span>Modelo: {generatedCode.quality.modelScore}</span>
            {typeof generatedCode.quality.familyScore === "number" && <span>Familia: {generatedCode.quality.familyScore}</span>}
            {typeof generatedCode.quality.extractionQuality === "number" && (
              <span>Extracción: {generatedCode.quality.extractionQuality}</span>
            )}
            <span>Estructura: {generatedCode.quality.structureScore}</span>
            <span>Cobertura: {generatedCode.quality.coverageScore}</span>
            {typeof generatedCode.quality.valueScore === "number" && <span>Valores: {generatedCode.quality.valueScore}</span>}
            {typeof generatedCode.quality.robustnessScore === "number" && (
              <span>Robustez: {generatedCode.quality.robustnessScore}</span>
            )}
            {generatedCode.quality.profileStatus && <span>Estado perfil: {generatedCode.quality.profileStatus}</span>}
          </div>
          {generatedCode.quality.issues.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-yellow-300">
              {generatedCode.quality.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <MonacoEditor
        language="javascript"
        theme="vs-dark"
        height="500px"
        value={generatedCode.code}
        options={{
          readOnly: false,
          minimap: { enabled: false },
          fontSize: 13
        }}
      />
    </section>
  );
}
