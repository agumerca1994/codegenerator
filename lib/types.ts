export type InputMode = "pdf" | "text";

export type InvoiceFieldType = "string" | "number" | "date" | "array";

export interface InvoiceField {
  field: string;
  label: string;
  detectedValue: string;
  type: InvoiceFieldType;
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
