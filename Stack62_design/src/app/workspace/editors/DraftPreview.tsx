import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
}

export function DraftPreview({ icon: Icon, title, subtitle }: Props) {
  return (
    <div className="grid h-full place-items-center bg-app text-app">
      <div className="max-w-md text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500/15 text-indigo-300">
          <Icon className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-app-subtle">
          {subtitle ??
            "Describe it in the assistant on the left. The result will open here."}
        </p>
      </div>
    </div>
  );
}
