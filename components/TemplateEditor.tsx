"use client";

import { type ChangeEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GeneratedCode,
  InvoiceField,
  InvoiceFieldType,
  Template,
  TemplateField,
  TemplateRect
} from "@/lib/types";
import { FieldsTable } from "@/components/FieldsTable";
import { CodeOutput } from "@/components/CodeOutput";

interface TextItemInfo {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageInfo {
  width: number;
  height: number;
}

interface PendingRect {
  rect: TemplateRect;
  sampleValue: string;
  label: string | null;
}

interface TemplateSummary {
  id: string;
  provider: string;
  providerCuit: string | null;
  createdAt: string;
  updatedAt: string | null;
}

const DEFAULT_FIELDS: Array<{ name: string; label: string; type: InvoiceFieldType }> = [
  { name: "tipoFactura", label: "Tipo Factura", type: "string" },
  { name: "fecha", label: "Fecha Emision", type: "date" },
  { name: "emisorCUIT", label: "CUIT Emisor", type: "string" },
  { name: "clienteCUIT", label: "CUIT Cliente", type: "string" },
  { name: "comprobante", label: "Comprobante", type: "string" },
  { name: "puntoVenta", label: "Punto de Venta", type: "string" },
  { name: "numeroComprobante", label: "Numero Comprobante", type: "string" },
  { name: "cae", label: "CAE", type: "string" },
  { name: "vencCae", label: "Vencimiento CAE", type: "date" },
  { name: "total", label: "Total", type: "number" },
  { name: "netoGravado", label: "Neto Gravado", type: "number" },
  { name: "iva21", label: "IVA 21", type: "number" },
  { name: "ivaPorc", label: "IVA %", type: "number" },
  { name: "conceptos", label: "Conceptos", type: "array" }
];

const FIELD_OPTIONS = [
  ...DEFAULT_FIELDS.map((field) => ({
    value: field.name,
    label: `${field.label} (${field.name})`
  })),
  { value: "custom", label: "Campo personalizado" }
];

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractTextFromRect(items: TextItemInfo[], rect: { x: number; y: number; w: number; h: number }) {
  const selected = items.filter((item) => {
    const xOverlap = item.x + item.width >= rect.x && item.x <= rect.x + rect.w;
    const yOverlap = item.y + item.height >= rect.y && item.y <= rect.y + rect.h;
    return xOverlap && yOverlap;
  });

  if (!selected.length) return "";

  const sorted = [...selected].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const lines: TextItemInfo[][] = [];
  const lineThreshold = 6;
  sorted.forEach((item) => {
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      lines.push([item]);
      return;
    }
    const lastY = lastLine[0].y;
    if (Math.abs(item.y - lastY) <= lineThreshold) {
      lastLine.push(item);
    } else {
      lines.push([item]);
    }
  });

  const text = lines
    .map((line) => line.sort((a, b) => a.x - b.x).map((item) => item.str).join(" "))
    .join("\n");

  return cleanText(text);
}

function detectLabel(items: TextItemInfo[], rect: { x: number; y: number; w: number; h: number }) {
  const midY = rect.y + rect.h / 2;
  const lineThreshold = 6;
  const sameLine = items.filter((item) => Math.abs(item.y - midY) <= lineThreshold);
  const leftItems = sameLine.filter((item) => item.x + item.width <= rect.x);

  if (leftItems.length) {
    const last = leftItems.sort((a, b) => b.x - a.x)[0];
    const label = cleanText(last.str).replace(/[:\-]+$/, "");
    return label || null;
  }

  const aboveItems = items.filter((item) => {
    const overlapsX = item.x <= rect.x + rect.w && item.x + item.width >= rect.x;
    return overlapsX && item.y + item.height <= rect.y;
  });

  if (aboveItems.length) {
    const nearest = aboveItems.sort((a, b) => b.y - a.y)[0];
    const label = cleanText(nearest.str).replace(/[:\-]+$/, "");
    return label || null;
  }

  return null;
}

function buildValuePattern(type: InvoiceFieldType) {
  if (type === "string") {
    return "[^\\n]+";
  }

  switch (type) {
    case "date":
      return "\\b\\d{2}[\\/\\.-]\\d{2}[\\/\\.-]\\d{2,4}\\b";
    case "number":
      return "\\b\\d{1,3}(?:[\\.\\s]\\d{3})*(?:,\\d{2})\\b|\\b\\d+(?:[\\.,]\\d+)?\\b";
    default:
      return "[^\\n]+";
  }
}

function buildFieldValuePattern(type: InvoiceFieldType, fieldName: string) {
  if (fieldName.toLowerCase().includes("cuit")) {
    return "\\b\\d{2}-?\\d{8}-?\\d\\b|\\b\\d{11}\\b";
  }
  return buildValuePattern(type);
}

function normalizeDateValue(value: string): string | null {
  const match = value.match(/\b(\d{2})[\/\.-](\d{2})[\/\.-](\d{2}|\d{4})\b/);
  if (!match) return null;
  const [, dd, mm, yy] = match;
  if (yy.length === 4) return `${dd}/${mm}/${yy}`;
  const twoDigits = Number(yy);
  const yyyy = twoDigits <= 79 ? 2000 + twoDigits : 1900 + twoDigits;
  return `${dd}/${mm}/${yyyy}`;
}

function parseNumberMixed(value: string): number | null {
  let clean = value.replace(/\$/g, "").replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  if (!clean) return null;

  const hasDot = clean.includes(".");
  const hasComma = clean.includes(",");

  if (hasDot && hasComma) {
    const lastDot = clean.lastIndexOf(".");
    const lastComma = clean.lastIndexOf(",");
    const decimalIsComma = lastComma > lastDot;
    if (decimalIsComma) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      clean = clean.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else {
    clean = clean.replace(/,/g, "");
  }

  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCuitValue(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

function normalizeSampleValue(value: string, type: InvoiceFieldType, fieldName = ""): string {
  const clean = cleanText(value);
  if (!clean) return "";

  if (fieldName.toLowerCase().includes("cuit")) {
    return normalizeCuitValue(clean) ?? clean;
  }

  switch (type) {
    case "date":
      return normalizeDateValue(clean) ?? clean;
    case "number": {
      const parsed = parseNumberMixed(clean);
      return parsed === null ? clean : String(parsed);
    }
    default:
      return clean;
  }
}

function buildInvoiceFields(fields: TemplateField[], extracted: Record<string, string | null>): InvoiceField[] {
  return fields.map((field) => ({
    field: field.name,
    label: field.label || field.name,
    detectedValue: extracted[field.name] || "",
    type: field.type
  }));
}

function useTemplatesList(enabled: boolean, onUnauthorized: () => void) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setTemplates([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/templates");
      if (response.status === 401) {
        setTemplates([]);
        onUnauthorized();
        return;
      }
      if (!response.ok) {
        throw new Error("No se pudo obtener plantillas.");
      }
      const data = await response.json();
      setTemplates(data.templates || []);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, onUnauthorized]);

  useEffect(() => {
    if (enabled) {
      refresh();
    } else {
      setTemplates([]);
      setLoading(false);
    }
  }, [enabled, refresh]);

  return { templates, loading, refresh };
}

function PdfZoneSelector({
  file,
  rects,
  readOnly,
  onNewRect,
  onTextItems
}: {
  file: File | null;
  rects: TemplateField[];
  readOnly?: boolean;
  onNewRect?: (pending: PendingRect) => void;
  onTextItems?: (items: TextItemInfo[], page: PageInfo) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [textItems, setTextItems] = useState<TextItemInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentRect, setCurrentRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const onTextItemsRef = useRef(onTextItems);

  const getPointerPosition = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!overlayRef.current || !pageInfo) return null;
      const bounds = overlayRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(pageInfo.width, event.clientX - bounds.left));
      const y = Math.max(0, Math.min(pageInfo.height, event.clientY - bounds.top));
      return { x, y };
    },
    [pageInfo]
  );

  useEffect(() => {
    onTextItemsRef.current = onTextItems;
  }, [onTextItems]);

  useEffect(() => {
    if (!scrollRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (!entries.length) return;
      const nextWidth = entries[0].contentRect.width;
      setContainerWidth((prev) => (Math.abs(prev - nextWidth) < 2 ? prev : nextWidth));
    });
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!file || containerWidth <= 0) return;
    let cancelled = false;

    const loadPdf = async () => {
      setLoading(true);
      setError(null);
      try {
        const pdfjsLib = await import("pdfjs-dist");
        // Preferimos worker local para evitar fallas de CDN/cors en Docker+WSL.
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/api/pdf-worker";

        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = containerWidth ? Math.min(2, containerWidth / baseViewport.width) : 1.5;
        const viewport = page.getViewport({ scale });
        const nextPageInfo = { width: viewport.width, height: viewport.height };

        if (cancelled) return;

        // Primero publicamos dimensiones para que se monte el canvas en el DOM.
        setPageInfo(nextPageInfo);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error("Canvas no disponible para renderizar PDF.");
        }
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Contexto 2D no disponible para renderizar PDF.");
        }
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: context, viewport }).promise;

        const content = await page.getTextContent();
        const mappedItems = (content.items || [])
          .filter((item: any) => item.str)
          .map((item: any) => {
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const x = tx[4];
            const y = tx[5];
            const height = Math.hypot(tx[2], tx[3]);
            const width = item.width * viewport.scale;
            return {
              str: item.str,
              x,
              y: y - height,
              width,
              height
            } as TextItemInfo;
          });

        if (cancelled) return;

        setPageInfo(nextPageInfo);
        setTextItems(mappedItems);
        onTextItemsRef.current?.(mappedItems, nextPageInfo);
      } catch (error) {
        console.error("Error renderizando PDF en plantillas:", error);
        if (!cancelled) {
          setError("No se pudo renderizar el PDF.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
    };
  }, [file, containerWidth]);

  const handlePointerDown = (event: MouseEvent<HTMLDivElement>) => {
    if (readOnly || !pageInfo) return;
    const position = getPointerPosition(event);
    if (!position) return;
    const { x, y } = position;
    setDrawStart({ x, y });
    setCurrentRect({ x, y, w: 0, h: 0 });
  };

  const handlePointerMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!drawStart || !pageInfo) return;
    const position = getPointerPosition(event);
    if (!position) return;
    const { x, y } = position;
    const rect = {
      x: Math.min(drawStart.x, x),
      y: Math.min(drawStart.y, y),
      w: Math.abs(drawStart.x - x),
      h: Math.abs(drawStart.y - y)
    };
    setCurrentRect(rect);
  };

  const handlePointerUp = () => {
    if (!drawStart || !currentRect || !pageInfo) {
      setDrawStart(null);
      setCurrentRect(null);
      return;
    }

    setDrawStart(null);

    if (currentRect.w < 8 || currentRect.h < 8) {
      setCurrentRect(null);
      return;
    }

    const normalized: TemplateRect = {
      page: 1,
      x: currentRect.x / pageInfo.width,
      y: currentRect.y / pageInfo.height,
      w: currentRect.w / pageInfo.width,
      h: currentRect.h / pageInfo.height
    };

    const sampleValue = extractTextFromRect(textItems, currentRect);
    const label = detectLabel(textItems, currentRect);

    onNewRect?.({ rect: normalized, sampleValue, label });
    setCurrentRect(null);
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
      {loading && <p className="text-xs text-gray-400">Cargando PDF...</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div ref={scrollRef} className="mt-2 max-h-[540px] overflow-auto">
        {pageInfo && (
          <div className="relative" style={{ width: pageInfo.width, height: pageInfo.height }}>
            <canvas ref={canvasRef} className="absolute left-0 top-0" />
            <div
              ref={overlayRef}
              className={`absolute left-0 top-0 ${readOnly ? "" : "cursor-crosshair"}`}
              style={{ width: pageInfo.width, height: pageInfo.height }}
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onMouseLeave={handlePointerUp}
            >
              {rects.map((field, index) => {
                if (!pageInfo) return null;
                const rect = field.rect;
                const x = rect.x * pageInfo.width;
                const y = rect.y * pageInfo.height;
                const w = rect.w * pageInfo.width;
                const h = rect.h * pageInfo.height;
                return (
                  <div
                    key={`${field.name}-${index}`}
                    className="absolute border-2 border-emerald-400/80 bg-emerald-400/10 text-[10px] text-emerald-200"
                    style={{ left: x, top: y, width: w, height: h }}
                  >
                    <span className="absolute left-1 top-1 rounded bg-emerald-900/70 px-1">
                      {field.name}
                    </span>
                  </div>
                );
              })}
              {currentRect && (
                <div
                  className="absolute border-2 border-blue-400/80 bg-blue-400/10"
                  style={{
                    left: currentRect.x,
                    top: currentRect.y,
                    width: currentRect.w,
                    height: currentRect.h
                  }}
                />
              )}
            </div>
          </div>
        )}
        {!loading && !error && !pageInfo && file && <p className="text-xs text-gray-500">Preparando visor del PDF...</p>}
      </div>
    </div>
  );
}

export function TemplateEditor() {
  const [activeTab, setActiveTab] = useState<"create" | "apply">("create");
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionUsername, setSessionUsername] = useState("");
  const [loginUsername, setLoginUsername] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const handleUnauthorized = useCallback(() => {
    setIsAuthenticated(false);
    setSessionUsername("");
    setAuthError("Sesión expirada o inválida. Inicia sesión nuevamente.");
  }, []);

  const { templates, loading: loadingTemplates, refresh } = useTemplatesList(isAuthenticated, handleUnauthorized);

  const [provider, setProvider] = useState("");
  const [providerCuit, setProviderCuit] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [createFields, setCreateFields] = useState<TemplateField[]>([]);
  const [pendingRect, setPendingRect] = useState<PendingRect | null>(null);
  const [selectedField, setSelectedField] = useState<string>(FIELD_OPTIONS[0].value);
  const [customFieldName, setCustomFieldName] = useState("");
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldType, setFieldType] = useState<InvoiceFieldType>("string");
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string>("");
  const [loadingEditTemplate, setLoadingEditTemplate] = useState(false);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [applyFile, setApplyFile] = useState<File | null>(null);
  const [applyPageInfo, setApplyPageInfo] = useState<PageInfo | null>(null);
  const [applyTextItems, setApplyTextItems] = useState<TextItemInfo[]>([]);
  const [extractedFields, setExtractedFields] = useState<InvoiceField[]>([]);
  const [generatedCode, setGeneratedCode] = useState<GeneratedCode | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session");
      if (!response.ok) throw new Error("No se pudo validar sesión.");
      const data = (await response.json()) as { authenticated?: boolean; username?: string };
      if (data.authenticated) {
        setIsAuthenticated(true);
        setSessionUsername(String(data.username || ""));
        setAuthError(null);
      } else {
        setIsAuthenticated(false);
        setSessionUsername("");
      }
    } catch {
      setIsAuthenticated(false);
      setSessionUsername("");
    } finally {
      setAuthChecked(true);
    }
  }, []);

  const handleLogin = async () => {
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "No se pudo iniciar sesión.");
      }
      setLoginPassword("");
      await loadSession();
      await refresh();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Error iniciando sesión.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setAuthSubmitting(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    } finally {
      setAuthSubmitting(false);
      setIsAuthenticated(false);
      setSessionUsername("");
      setAuthError(null);
    }
  };

  const canSaveTemplate = useMemo(() => provider.trim().length > 0 && createFields.length > 0, [provider, createFields]);
  const isEditingTemplate = Boolean(editingTemplateId);

  const resetCreateForm = useCallback(() => {
    setEditingTemplateId("");
    setProvider("");
    setProviderCuit("");
    setPdfFile(null);
    setCreateFields([]);
    setPendingRect(null);
    setFieldLabel("");
    setPageInfo(null);
    setSaveMessage(null);
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    const match = DEFAULT_FIELDS.find((field) => field.name === selectedField);
    if (match) setFieldType(match.type);
  }, [selectedField]);

  const handlePdfUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setPdfFile(file);
    if (!isEditingTemplate) {
      setCreateFields([]);
    }
    setPendingRect(null);
    setFieldLabel("");
    setSaveMessage(null);
    setPageInfo(null);
  };

  const handleSelectTemplateForEdit = async (templateId: string) => {
    if (!templateId) {
      resetCreateForm();
      return;
    }

    setLoadingEditTemplate(true);
    setSaveMessage(null);
    try {
      const response = await fetch(`/api/templates/${templateId}`);
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudo cargar la plantilla.");

      const template = data.template as Template;
      setEditingTemplateId(template.id);
      setProvider(template.provider || "");
      setProviderCuit(template.providerCuit || "");
      setCreateFields(Array.isArray(template.fields) ? template.fields : []);
      setPageInfo(template.pageSize || null);
      setPendingRect(null);
      setPdfFile(null);
      setFieldLabel("");
      try {
        const sourcePdfResponse = await fetch(`/api/templates/${template.id}/source-pdf`);
        if (sourcePdfResponse.status === 401) {
          handleUnauthorized();
          return;
        }
        if (sourcePdfResponse.ok) {
          const blob = await sourcePdfResponse.blob();
          const fileName = template.sourceFileName?.trim() || `${template.provider || "plantilla"}.pdf`;
          const file = new File([blob], fileName, { type: "application/pdf" });
          setPdfFile(file);
          setSaveMessage("Plantilla cargada para edición con su PDF base.");
        } else {
          setSaveMessage("Plantilla cargada para edición. Sube un PDF para ajustar zonas.");
        }
      } catch {
        setSaveMessage("Plantilla cargada para edición. Sube un PDF para ajustar zonas.");
      }
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Error cargando plantilla para edición.");
    } finally {
      setLoadingEditTemplate(false);
    }
  };

  const handleApplyUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setApplyFile(file);
    setGeneratedCode(null);
    setExtractedFields([]);
    setApplyTextItems([]);
    setApplyPageInfo(null);
    setApplyError(null);
  };

  const handleNewRect = (rect: PendingRect) => {
    setPendingRect(rect);
    setFieldLabel(rect.label || "");
    setSaveMessage(null);
  };

  const handleAddField = () => {
    if (!pendingRect) return;
    const fieldName = selectedField === "custom" ? customFieldName.trim() : selectedField;
    if (!fieldName) return;
    const normalizedSampleValue = normalizeSampleValue(pendingRect.sampleValue, fieldType, fieldName);
    const normalizedLabel = fieldLabel.trim() || null;

    const newField: TemplateField = {
      name: fieldName,
      type: fieldType,
      rect: pendingRect.rect,
      label: normalizedLabel,
      sampleValue: normalizedSampleValue,
      valuePattern: buildFieldValuePattern(fieldType, fieldName)
    };

    setCreateFields((prev) => [...prev, newField]);
    setPendingRect(null);
    setCustomFieldName("");
    setFieldLabel("");
  };

  const handleRemoveField = (index: number) => {
    setCreateFields((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveTemplate = async () => {
    if (!canSaveTemplate) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const endpoint = isEditingTemplate ? `/api/templates/${editingTemplateId}` : "/api/templates";
      const method = isEditingTemplate ? "PUT" : "POST";
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.trim(),
          providerCuit: providerCuit.trim() || null,
          fields: createFields,
          sourceFileName: pdfFile?.name ?? null,
          pageSize: pageInfo
        })
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "No se pudo guardar la plantilla.");
      }

      const template = data?.template as Template | undefined;
      let pdfUploadIssue: string | null = null;

      if (template?.id && pdfFile) {
        const formData = new FormData();
        formData.append("file", pdfFile);
        const uploadResponse = await fetch(`/api/templates/${template.id}/source-pdf`, {
          method: "POST",
          body: formData
        });
        if (uploadResponse.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!uploadResponse.ok) {
          const uploadData = await uploadResponse.json().catch(() => null);
          pdfUploadIssue = uploadData?.error || "No se pudo guardar el PDF base.";
        }
      }

      if (isEditingTemplate) {
        setSaveMessage(pdfUploadIssue ? `Plantilla actualizada. ${pdfUploadIssue}` : "Plantilla actualizada.");
        if (template) {
          setEditingTemplateId(template.id);
          setProvider(template.provider || "");
          setProviderCuit(template.providerCuit || "");
          setCreateFields(Array.isArray(template.fields) ? template.fields : []);
          setPageInfo(template.pageSize || null);
        }
      } else {
        setSaveMessage(pdfUploadIssue ? `Plantilla guardada. ${pdfUploadIssue}` : "Plantilla guardada.");
        setProvider("");
        setProviderCuit("");
        setPdfFile(null);
        setCreateFields([]);
        setPendingRect(null);
        setPageInfo(null);
      }
      await refresh();
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Error guardando plantilla.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!selectedTemplateId) {
      setSelectedTemplate(null);
      return;
    }
    const loadTemplate = async () => {
      try {
        const response = await fetch(`/api/templates/${selectedTemplateId}`);
        if (response.status === 401) {
          handleUnauthorized();
          return;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "No se pudo cargar la plantilla.");
        setSelectedTemplate(data.template);
      } catch (error) {
        setApplyError(error instanceof Error ? error.message : "Error cargando plantilla.");
      }
    };
    loadTemplate();
  }, [handleUnauthorized, selectedTemplateId]);

  useEffect(() => {
    if (!selectedTemplate || !applyTextItems.length || !applyPageInfo) return;
    const extracted: Record<string, string | null> = {};

    selectedTemplate.fields.forEach((field) => {
      const rect = {
        x: field.rect.x * applyPageInfo.width,
        y: field.rect.y * applyPageInfo.height,
        w: field.rect.w * applyPageInfo.width,
        h: field.rect.h * applyPageInfo.height
      };
      const value = extractTextFromRect(applyTextItems, rect);
      const normalizedValue = normalizeSampleValue(value, field.type, field.name);
      extracted[field.name] = normalizedValue || null;
    });

    setExtractedFields(buildInvoiceFields(selectedTemplate.fields, extracted));
  }, [applyPageInfo, applyTextItems, selectedTemplate]);

  const handleGenerateCode = async () => {
    if (!selectedTemplateId) return;
    setApplyError(null);
    setGeneratedCode(null);
    try {
      const response = await fetch("/api/generate-code-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: selectedTemplateId })
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudo generar el codigo.");
      setGeneratedCode(data as GeneratedCode);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : "Error generando codigo.");
    }
  };

  if (!authChecked) {
    return (
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-300">
        Validando sesión...
      </section>
    );
  }

  if (!isAuthenticated) {
    return (
      <section className="max-w-md space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="text-sm font-medium text-gray-100">Iniciar sesión en Plantillas</h3>
        <div className="space-y-2">
          <label className="text-xs text-gray-400">Usuario</label>
          <input
            value={loginUsername}
            onChange={(event) => setLoginUsername(event.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
            placeholder="admin"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs text-gray-400">Clave</label>
          <input
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            type="password"
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
            placeholder="••••••"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleLogin();
              }
            }}
          />
        </div>
        <button
          type="button"
          onClick={handleLogin}
          disabled={authSubmitting || !loginUsername.trim() || !loginPassword}
          className="w-full rounded-lg bg-blue-500 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {authSubmitting ? "Ingresando..." : "Ingresar"}
        </button>
        {authError && <p className="text-xs text-red-300">{authError}</p>}
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-300">
        <span>Sesión activa: {sessionUsername || "admin"}</span>
        <button
          type="button"
          onClick={handleLogout}
          disabled={authSubmitting}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-gray-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {authSubmitting ? "Saliendo..." : "Cerrar sesión"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("create")}
          className={`rounded-lg px-3 py-2 text-sm ${activeTab === "create" ? "bg-blue-500 text-white" : "bg-gray-800 text-gray-300"}`}
        >
          Crear plantilla
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("apply")}
          className={`rounded-lg px-3 py-2 text-sm ${activeTab === "apply" ? "bg-blue-500 text-white" : "bg-gray-800 text-gray-300"}`}
        >
          Aplicar plantilla
        </button>
        <button
          type="button"
          onClick={handleLogout}
          disabled={authSubmitting}
          className="ml-auto rounded-lg border border-red-500/50 bg-red-500/15 px-3 py-2 text-sm text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {authSubmitting ? "Saliendo..." : "Cerrar sesión"}
        </button>
      </div>

      {activeTab === "create" && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
              <div className="space-y-2">
                <label className="text-xs text-gray-400">Editar plantilla existente (opcional)</label>
                <select
                  value={editingTemplateId}
                  onChange={(event) => handleSelectTemplateForEdit(event.target.value)}
                  disabled={loadingEditTemplate || saving}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">Crear nueva plantilla</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.provider} {template.providerCuit ? `(${template.providerCuit})` : ""}
                    </option>
                  ))}
                </select>
                {loadingEditTemplate && <p className="text-xs text-gray-500">Cargando plantilla para edición...</p>}
                {isEditingTemplate && !loadingEditTemplate && (
                  <button
                    type="button"
                    onClick={resetCreateForm}
                    className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-gray-200"
                  >
                    Salir de edición
                  </button>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-400">Proveedor</label>
                <input
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                  placeholder="Ej: Alba Seguros"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-400">CUIT proveedor (opcional)</label>
                <input
                  value={providerCuit}
                  onChange={(event) => setProviderCuit(event.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                  placeholder="30-00000000-0"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-400">PDF base</label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handlePdfUpload}
                  onClick={(event) => {
                    event.currentTarget.value = "";
                  }}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 file:mr-3 file:rounded file:border-0 file:bg-blue-500/20 file:px-2 file:py-1 file:text-xs file:text-blue-200"
                />
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 text-xs text-gray-400">
                {isEditingTemplate
                  ? "Modo edición activo. Ajusta proveedor/campos y guarda cambios en la plantilla existente."
                  : "Dibuje un rectangulo sobre el PDF y asigne el campo."}
              </div>
              {isEditingTemplate && !pdfFile && (
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                  No hay PDF cargado para esta edición. Selecciona un PDF base para poder dibujar nuevas zonas.
                </div>
              )}
            </div>

            <div className="flex flex-col rounded-xl border border-gray-800 bg-gray-900 p-4 md:h-[540px]">
              <p className="text-sm font-medium text-gray-200">Campos seleccionados</p>
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
                {createFields.length === 0 ? (
                  <p className="text-xs text-gray-500">Aun no hay zonas definidas.</p>
                ) : (
                  <div className="space-y-2">
                    {createFields.map((field, index) => (
                      <div
                        key={`${field.name}-${index}`}
                        className="flex items-start justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 text-xs text-gray-300"
                      >
                        <div>
                          <p className="font-mono text-[11px] text-gray-200">{field.name}</p>
                          <p className="text-gray-500">{field.label || "Sin etiqueta"}</p>
                          <p className="text-gray-500">Tipo: {field.type}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveField(index)}
                          className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300"
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-3 border-t border-gray-800 pt-3">
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={!canSaveTemplate || saving}
                  className="w-full rounded-lg bg-blue-500 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? (isEditingTemplate ? "Actualizando..." : "Guardando...") : isEditingTemplate ? "Guardar cambios" : "Guardar plantilla"}
                </button>
                {saveMessage && <p className="mt-2 text-xs text-gray-400">{saveMessage}</p>}
              </div>
            </div>
          </div>

          {pdfFile && (
            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <PdfZoneSelector
                file={pdfFile}
                rects={createFields}
                onNewRect={handleNewRect}
                onTextItems={(_, page) => setPageInfo(page)}
              />

              <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
                <p className="text-sm font-medium text-gray-200">Asignar campo</p>
                {!pendingRect && (
                  <p className="text-xs text-gray-500">Dibuje una zona en el PDF para habilitar.</p>
                )}
                {pendingRect && (
                  <>
                    <div className="space-y-2 text-xs text-gray-300">
                      <p>
                        Valor detectado: <span className="font-mono text-gray-100">{pendingRect.sampleValue || "-"}</span>
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400">Etiqueta (editable)</label>
                      <input
                        value={fieldLabel}
                        onChange={(event) => setFieldLabel(event.target.value)}
                        className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                        placeholder="Etiqueta del campo"
                      />
                      <p className="text-[11px] text-gray-500">
                        Sugerida: <span className="font-mono text-gray-400">{pendingRect.label || "-"}</span>
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400">Campo</label>
                      <select
                        value={selectedField}
                        onChange={(event) => setSelectedField(event.target.value)}
                        className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                      >
                        {FIELD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {selectedField === "custom" && (
                        <input
                          value={customFieldName}
                          onChange={(event) => setCustomFieldName(event.target.value)}
                          className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                          placeholder="Nombre de campo"
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-gray-400">Tipo</label>
                      <select
                        value={fieldType}
                        onChange={(event) => setFieldType(event.target.value as InvoiceFieldType)}
                        className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                      >
                        <option value="string">string</option>
                        <option value="number">number</option>
                        <option value="date">date</option>
                        <option value="array">array</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddField}
                      className="w-full rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm text-blue-200"
                    >
                      Agregar campo
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {!pdfFile && isEditingTemplate && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-xs text-gray-400">
              Para agregar campos nuevos por dibujo, primero carga un PDF en "PDF base".
            </div>
          )}
        </div>
      )}

      {activeTab === "apply" && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
              <label className="text-xs text-gray-400">Plantilla</label>
              <select
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
              >
                <option value="">Selecciona una plantilla</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.provider} {template.providerCuit ? `(${template.providerCuit})` : ""}
                  </option>
                ))}
              </select>
              {loadingTemplates && <p className="text-xs text-gray-500">Cargando plantillas...</p>}
              <div className="space-y-2">
                <label className="text-xs text-gray-400">PDF a procesar</label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleApplyUpload}
                  disabled={!selectedTemplateId}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 text-xs text-gray-400">
                Se extraen valores usando las zonas de la plantilla seleccionada.
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
              <p className="text-sm font-medium text-gray-200">Acciones</p>
              <button
                type="button"
                onClick={handleGenerateCode}
                disabled={!selectedTemplateId}
                className="w-full rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm text-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Generar codigo desde plantilla
              </button>
              {applyError && <p className="text-xs text-red-400">{applyError}</p>}
            </div>
          </div>

          {selectedTemplate && applyFile && (
            <PdfZoneSelector
              file={applyFile}
              rects={selectedTemplate.fields}
              readOnly
              onTextItems={(items, page) => {
                setApplyTextItems(items);
                setApplyPageInfo(page);
              }}
            />
          )}

          {extractedFields.length > 0 && <FieldsTable fields={extractedFields} />}
          {generatedCode && <CodeOutput generatedCode={generatedCode} />}
        </div>
      )}
    </section>
  );
}
