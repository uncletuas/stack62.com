import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
  hint?: string;
  separatorAbove?: boolean;
}

interface Props {
  trigger: ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
}

export function Menu({ trigger, items, align = "start" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) {
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex h-7 items-center gap-1 rounded px-2 text-xs ${
          open
            ? "bg-white/10 text-white"
            : "text-app-muted hover:bg-white/10 hover:text-white"
        }`}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={`absolute top-8 z-40 min-w-[200px] rounded-md border border-app-strong bg-app-surface py-1 shadow-2xl ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div key={idx}>
                {item.separatorAbove && (
                  <div className="my-1 border-t border-app" />
                )}
                <button
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpen(false);
                    item.onSelect();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-app hover:bg-white/5 disabled:cursor-not-allowed disabled:text-app-faint"
                >
                  {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && (
                    <kbd className="text-[10px] text-app-faint">
                      {item.shortcut}
                    </kbd>
                  )}
                </button>
                {item.hint && !item.disabled && (
                  <p className="px-3 pb-1 text-[10px] text-app-faint">
                    {item.hint}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
