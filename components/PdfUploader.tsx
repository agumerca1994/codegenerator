"use client";

import { useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";

interface ExtractResult {
  text: string;
  fileName: string;
  pages: number;
}

interface PdfUploaderProps {
  onTextExtracted: (text: string, fileName: string) => void;
  isLoading: boolean;
  setIsLoading: (value: boolean) => void;
}

export function PdfUploader({ onTextExtracted, isLoading, setIsLoading }: PdfUploaderProps) {
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      if (file.type !== "application/pdf") {
        setError("Solo se aceptan archivos PDF.");
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setError("El archivo supera el máximo de 10MB.");
        return;
      }

      setError(null);
      setIsLoading(true);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/extract-pdf", {
          method: "POST",
          body: formData
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || "No se pudo extraer el texto del PDF.");
        }

        const data = (await response.json()) as ExtractResult;
        setResult(data);
        onTextExtracted(data.text, data.fileName);
      } catch (extractError) {
        setError(extractError instanceof Error ? extractError.message : "Error desconocido extrayendo PDF.");
      } finally {
        setIsLoading(false);
      }
    },
    [onTextExtracted, setIsLoading]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: false,
    maxFiles: 1,
    disabled: isLoading
  });

  const preview = useMemo(() => result?.text.slice(0, 500) ?? "", [result]);

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${
          isDragActive ? "border-blue-500 bg-blue-500/10" : "border-gray-700 bg-gray-900"
        }`}
      >
        <input {...getInputProps()} />
        {isLoading ? (
          <div className="space-y-2">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <p className="text-sm text-gray-300">Extrayendo texto del PDF...</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-100">Arrastra un PDF aquí o haz click para seleccionar</p>
            <p className="text-xs text-gray-400">Solo .pdf, máximo 10MB</p>
          </div>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      {result && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm">
          <p className="font-medium text-gray-100">{result.fileName}</p>
          <p className="text-gray-400">{result.pages} páginas detectadas</p>
          <p className="mt-3 text-xs uppercase tracking-wider text-gray-500">Preview</p>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-950 p-3 text-xs text-gray-300">
            {preview}
          </pre>
        </div>
      )}
    </div>
  );
}
