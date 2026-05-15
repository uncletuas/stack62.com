/**
 * In-app replacement for `window.alert`, `window.confirm`, and
 * `window.prompt`. The native browser dialogs are intrusive, block the
 * thread, can't be styled, and (in PWAs and Electron wrappers) look
 * out-of-place. Use this instead.
 *
 *   await appDialog.alert({ title: "Done", description: "File saved." });
 *
 *   const ok = await appDialog.confirm({
 *     title: "Delete 4 files?",
 *     description: "This cannot be undone.",
 *     confirmLabel: "Delete",
 *     destructive: true,
 *   });
 *
 *   const name = await appDialog.prompt({
 *     title: "Rename file",
 *     placeholder: "untitled.txt",
 *     initialValue: "report.pdf",
 *   });
 *
 * `prompt` resolves to the string the user typed, or `null` if they
 * cancelled. `confirm` resolves to a boolean. `alert` resolves once
 * the dialog is dismissed.
 *
 * The <AppDialogHost /> component must be mounted once at the app
 * root for the API to work. If it isn't mounted, the calls reject
 * loudly so dev catches it.
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Tone = "default" | "destructive" | "success" | "info";

interface AlertSpec {
  kind: "alert";
  title: string;
  description?: string;
  okLabel?: string;
  tone?: Tone;
}

interface ConfirmSpec {
  kind: "confirm";
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  tone?: Tone;
}

interface PromptSpec {
  kind: "prompt";
  title: string;
  description?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputType?: "text" | "email" | "url" | "number";
  validate?: (value: string) => string | null;
}

type Spec = AlertSpec | ConfirmSpec | PromptSpec;
type Resolver = (value: unknown) => void;

interface QueueItem {
  id: number;
  spec: Spec;
  resolve: Resolver;
}

// ── Singleton state ───────────────────────────────────────────────
let nextId = 1;
let listener: ((items: QueueItem[]) => void) | null = null;
let queue: QueueItem[] = [];

function emit() {
  listener?.(queue.slice());
}

function enqueue<T>(spec: Spec): Promise<T> {
  if (!listener) {
    // Surface the missing host loudly — silent fallback to native
    // dialogs defeats the purpose of this module.
    return Promise.reject(
      new Error(
        "AppDialogHost is not mounted. Add <AppDialogHost /> once at the workspace root.",
      ),
    );
  }
  return new Promise<T>((resolve) => {
    queue.push({
      id: nextId++,
      spec,
      resolve: resolve as Resolver,
    });
    emit();
  });
}

export const appDialog = {
  alert(opts: Omit<AlertSpec, "kind">): Promise<void> {
    return enqueue<void>({ kind: "alert", ...opts });
  },
  confirm(opts: Omit<ConfirmSpec, "kind">): Promise<boolean> {
    return enqueue<boolean>({ kind: "confirm", ...opts });
  },
  prompt(opts: Omit<PromptSpec, "kind">): Promise<string | null> {
    return enqueue<string | null>({ kind: "prompt", ...opts });
  },
};

// ── Host component ─────────────────────────────────────────────────

export function AppDialogHost() {
  const [items, setItems] = useState<QueueItem[]>([]);

  useEffect(() => {
    listener = (next) => setItems(next);
    emit();
    return () => {
      listener = null;
    };
  }, []);

  const current = items[0] ?? null;

  const close = (value: unknown) => {
    if (!current) return;
    current.resolve(value);
    queue = queue.filter((q) => q.id !== current.id);
    emit();
  };

  if (!current) return null;

  return (
    <Dialog
      key={current.id}
      open
      onOpenChange={(open) => {
        if (open) return;
        // Treat overlay click / Esc as cancel — for alert that's just
        // dismiss; for confirm it's false; for prompt it's null.
        if (current.spec.kind === "confirm") close(false);
        else if (current.spec.kind === "prompt") close(null);
        else close(undefined);
      }}
    >
      <DialogContent className="border-app bg-app-surface text-app sm:max-w-md">
        {current.spec.kind === "alert" ? (
          <AlertBody spec={current.spec} onClose={() => close(undefined)} />
        ) : current.spec.kind === "confirm" ? (
          <ConfirmBody
            spec={current.spec}
            onResolve={(value) => close(value)}
          />
        ) : (
          <PromptBody
            spec={current.spec}
            onResolve={(value) => close(value)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ToneIcon({ tone }: { tone: Tone | undefined }) {
  if (tone === "destructive")
    return <AlertTriangle className="h-5 w-5 text-rose-500" />;
  if (tone === "success")
    return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (tone === "info") return <Info className="h-5 w-5 text-sky-500" />;
  return null;
}

function AlertBody({
  spec,
  onClose,
}: {
  spec: AlertSpec;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <ToneIcon tone={spec.tone} />
          <DialogTitle>{spec.title}</DialogTitle>
        </div>
        {spec.description && (
          <DialogDescription className="text-app-muted">
            {spec.description}
          </DialogDescription>
        )}
      </DialogHeader>
      <DialogFooter>
        <Button onClick={onClose} autoFocus>
          {spec.okLabel ?? "OK"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ConfirmBody({
  spec,
  onResolve,
}: {
  spec: ConfirmSpec;
  onResolve: (value: boolean) => void;
}) {
  const tone: Tone = spec.tone ?? (spec.destructive ? "destructive" : "default");
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <ToneIcon tone={tone} />
          <DialogTitle>{spec.title}</DialogTitle>
        </div>
        {spec.description && (
          <DialogDescription className="text-app-muted">
            {spec.description}
          </DialogDescription>
        )}
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={() => onResolve(false)}>
          {spec.cancelLabel ?? "Cancel"}
        </Button>
        <Button
          autoFocus
          onClick={() => onResolve(true)}
          variant={spec.destructive ? "destructive" : "default"}
        >
          {spec.confirmLabel ?? (spec.destructive ? "Delete" : "Confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}

function PromptBody({
  spec,
  onResolve,
}: {
  spec: PromptSpec;
  onResolve: (value: string | null) => void;
}) {
  const [value, setValue] = useState(spec.initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = () => {
    const trimmed = value;
    const v = spec.validate ? spec.validate(trimmed) : null;
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    onResolve(trimmed);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{spec.title}</DialogTitle>
        {spec.description && (
          <DialogDescription className="text-app-muted">
            {spec.description}
          </DialogDescription>
        )}
      </DialogHeader>
      <div className="mt-3">
        <Input
          autoFocus
          type={spec.inputType ?? "text"}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder={spec.placeholder}
          className="border-app bg-app"
        />
        {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
      </div>
      <DialogFooter className="mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => onResolve(null)}
          disabled={submitting}
        >
          {spec.cancelLabel ?? "Cancel"}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {spec.confirmLabel ?? "OK"}
        </Button>
      </DialogFooter>
    </form>
  );
}
