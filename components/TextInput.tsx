interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function TextInput({ value, onChange }: TextInputProps) {
  return (
    <div className="space-y-3">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Pega aquí el campo 'text' extraído del PDF..."
        className="min-h-[300px] w-full rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
      />
      <div className="flex items-center justify-between text-xs text-gray-400">
        <div>
          {value.trim().length > 0 && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="rounded-md border border-gray-700 px-2 py-1 hover:border-gray-500"
            >
              Limpiar
            </button>
          )}
        </div>
        <span>{value.length.toLocaleString()} caracteres</span>
      </div>
    </div>
  );
}
