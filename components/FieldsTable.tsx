import type { InvoiceField } from "@/lib/types";

interface FieldsTableProps {
  fields: InvoiceField[];
}

function badgeColor(type: InvoiceField["type"]) {
  if (type === "number") return "bg-blue-500/15 text-blue-400 border-blue-500/40";
  if (type === "date") return "bg-green-500/15 text-green-400 border-green-500/40";
  if (type === "array") return "bg-orange-500/15 text-orange-400 border-orange-500/40";
  return "bg-gray-500/15 text-gray-300 border-gray-500/40";
}

export function FieldsTable({ fields }: FieldsTableProps) {
  if (!fields.length) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-800/60 text-gray-300">
          <tr>
            <th className="px-4 py-3">Campo</th>
            <th className="px-4 py-3">Etiqueta</th>
            <th className="px-4 py-3">Valor Detectado</th>
            <th className="px-4 py-3">Tipo</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.field} className="border-t border-gray-800 text-gray-200">
              <td className="px-4 py-3 font-mono text-xs">{field.field}</td>
              <td className="px-4 py-3">{field.label}</td>
              <td className="px-4 py-3 font-mono text-xs text-gray-300">{field.detectedValue || "-"}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full border px-2 py-1 text-xs ${badgeColor(field.type)}`}>
                  {field.type}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
