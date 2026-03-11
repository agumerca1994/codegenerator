export type InputMode = "pdf" | "text" | "templates";

export type InvoiceFieldType = "string" | "number" | "date" | "array";

export interface InvoiceField {
  field: string;
  label: string;
  detectedValue: string;
  type: InvoiceFieldType;
}

export interface TemplateRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TemplateField {
  name: string;
  type: InvoiceFieldType;
  rect: TemplateRect;
  label?: string | null;
  valuePattern?: string | null;
  sampleValue?: string | null;
}

export interface Template {
  id: string;
  provider: string;
  providerCuit?: string | null;
  createdAt: string;
  updatedAt?: string;
  sourceFileName?: string | null;
  pageSize?: { width: number; height: number } | null;
  fields: TemplateField[];
}

export interface QualityBreakdown {
  profile: string;
  profileStatus?: "stable" | "draft";
  selectedSource?: string;
  modelScore: number;
  familyScore: number;
  extractionQuality: number;
  structureScore: number;
  coverageScore: number;
  valueScore: number;
  robustnessScore?: number;
  issues: string[];
}

export interface GeneratedCode {
  provider: string;
  confidence: number;
  fields: InvoiceField[];
  code: string;
  quality?: QualityBreakdown;
}
