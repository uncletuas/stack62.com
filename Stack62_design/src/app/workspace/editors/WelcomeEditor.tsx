import { ArrowRight, Files as FilesIcon, MessageSquare, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppContext } from "../../context/app-context";
import { useWorkspace } from "../workspace-context";

/**
 * Welcome — minimal home for an empty workspace. One greeting,
 * three quick actions, nothing else. Anything you'd previously want
 * to surface here (recent activity, pending plans, tasks) lives on
 * the relevant left-rail entry; this surface is meant as a calm
 * "where do I start?" landing.
 */
export function WelcomeEditor() {
  const { user, currentOrganization } = useAppContext();
  const { navigate, setActivity, setSidebarOpen } = useWorkspace();

  const firstName =
    user?.firstName?.trim() || user?.email?.split("@")[0] || "there";
  const greeting = timeGreeting();

  const openCoworker = () => {
    // CoworkerRail listens for this event to expand its panel.
    window.dispatchEvent(new CustomEvent("stack62:open-coworker"));
  };

  const openStreamingDoc = () => {
    navigate({ kind: "streaming-doc", title: "Generate document" });
  };

  const openFiles = () => {
    setActivity("files");
    setSidebarOpen(false);
    navigate({ kind: "files-explorer", title: "Files" });
  };

  return (
    <div className="h-full overflow-auto bg-app">
      <div className="mx-auto max-w-3xl px-8 py-16">
        {/* Greeting */}
        <header className="mb-12">
          <h1 className="text-3xl font-semibold tracking-tight text-app">
            {greeting}, {firstName}.
          </h1>
          {currentOrganization && (
            <p className="mt-2 text-base text-app-muted">
              You're in{" "}
              <span className="font-medium text-app">
                {currentOrganization.name}
              </span>
              . What would you like to do?
            </p>
          )}
        </header>

        {/* Quick actions */}
        <div className="grid gap-4 sm:grid-cols-3">
          <QuickAction
            icon={MessageSquare}
            title="Talk to Coworker"
            description="Ask anything. Hand off a task. Connect it to your tools."
            onClick={openCoworker}
          />
          <QuickAction
            icon={Sparkles}
            title="Generate a document"
            description="Watch the Coworker write it in real time."
            onClick={openStreamingDoc}
          />
          <QuickAction
            icon={FilesIcon}
            title="Browse your files"
            description="Open the workspace library — docs, sheets, more."
            onClick={openFiles}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Quick action card. Big, single click target, hover lifts the
 * card slightly and reveals an arrow. Visual weight intentionally
 * low so the page feels light, not crowded.
 */
function QuickAction({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full flex-col items-start gap-3 rounded-xl border border-app bg-app-elevated p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent">
        <Icon className="h-4 w-4" />
      </span>
      <span className="block text-sm font-semibold text-app">{title}</span>
      <span className="block flex-1 text-sm leading-relaxed text-app-muted">
        {description}
      </span>
      <span className="flex items-center gap-1 text-xs font-medium text-app-faint group-hover:text-accent">
        Open
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Working late";
}
