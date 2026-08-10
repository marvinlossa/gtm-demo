import type { ReactNode } from "react";
import { inputClass } from "@/lib/ui";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-normal text-stone-300">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Pill({
  children,
  tone = "cyan",
}: {
  children: ReactNode;
  tone?: "cyan" | "amber" | "stone";
}) {
  const colors =
    tone === "amber"
      ? "bg-amber-300/15 text-amber-100"
      : tone === "stone"
        ? "bg-white/10 text-stone-200"
        : "bg-cyan-300/15 text-cyan-100";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${colors}`}>
      {children}
    </span>
  );
}

export function TextEdit({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <Field label={label}>
      <input
        type={type}
        className={inputClass()}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function SelectEdit({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <Field label={label}>
      <select
        className={inputClass()}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

const technologies = [
  {
    name: "Next.js",
    path: "M18.665 21.978C16.758 23.255 14.465 24 12 24 5.377 24 0 18.623 0 12S5.377 0 12 0s12 5.377 12 12c0 3.583-1.574 6.801-4.067 9.001L9.219 7.2H7.2v9.596h1.615V9.251l9.85 12.727Zm-3.332-8.533 1.6 2.061V7.2h-1.6v6.245Z",
  },
  {
    name: "n8n",
    // Simplified mark: rounded workflow node pair (distinct from provider logos).
    path: "M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 1.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zM18 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 1.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zM8.5 11.4h7v1.2h-7zM12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 1.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zM11.4 8h1.2v2.2h-1.2zM12 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 1.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zM11.4 13.8h1.2V16h-1.2z",
  },
  {
    name: "Perplexity",
    path: "M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z",
  },
  {
    name: "OpenRouter",
    path: "M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z",
  },
] as const;

export function TechnologyMarks() {
  return (
    <div className="flex items-center gap-2">
      {technologies.map((technology) => (
        <span
          key={technology.name}
          aria-label={technology.name}
          aria-describedby={`technology-${technology.name.toLowerCase().replaceAll(".", "-")}`}
          tabIndex={0}
          className="group relative grid size-9 place-items-center rounded-full border border-white/15 bg-white/[0.07] text-white outline-none transition hover:border-amber-300/50 hover:bg-white/15 focus-visible:border-amber-300/60 focus-visible:ring-2 focus-visible:ring-amber-300/35"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-4 fill-current"
          >
            <path d={technology.path} />
          </svg>
          <span
            id={`technology-${technology.name.toLowerCase().replaceAll(".", "-")}`}
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/15 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-stone-100 opacity-0 shadow-xl transition group-hover:opacity-100 group-focus:opacity-100"
          >
            {technology.name}
          </span>
        </span>
      ))}
    </div>
  );
}
