interface StepIndicatorProps {
  currentStep: 1 | 2 | 3;
}

const steps = [
  { id: 1, label: "1. Input", icon: "📝" },
  { id: 2, label: "2. Analizando", icon: "🧠" },
  { id: 3, label: "3. Código", icon: "</>" }
] as const;

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
      {steps.map((step, index) => {
        const completed = step.id < currentStep;
        const active = step.id === currentStep;

        return (
          <div key={step.id} className="flex flex-1 items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${
                completed
                  ? "border-green-500 bg-green-500/20 text-green-400"
                  : active
                    ? "border-blue-500 bg-blue-500/20 text-blue-400"
                    : "border-gray-700 bg-gray-800 text-gray-400"
              }`}
            >
              {completed ? "✓" : step.icon}
            </div>
            <span
              className={`text-sm ${
                active ? "text-blue-400" : completed ? "text-green-400" : "text-gray-400"
              }`}
            >
              {step.label}
            </span>
            {index < steps.length - 1 && <div className="h-px flex-1 bg-gray-800" />}
          </div>
        );
      })}
    </div>
  );
}
