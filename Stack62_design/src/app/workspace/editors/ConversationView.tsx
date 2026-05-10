import { useEffect, useRef } from "react";
import { Bot, Loader2, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useWorkspace,
  type ConversationIntent,
  type EditorTab,
} from "../workspace-context";

interface Props {
  tab: EditorTab;
  intent: ConversationIntent;
  title: string;
  icon: LucideIcon;
}

export function ConversationView({ tab, intent, title, icon: Icon }: Props) {
  const { conversations } = useWorkspace();
  const conv = conversations[tab.id];
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [conv?.messages.length, conv?.thinking]);

  return (
    <div className="flex h-full flex-col bg-app text-app">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-app px-4">
        <Icon className="h-4 w-4 text-indigo-400" />
        <h1 className="truncate text-sm font-semibold">{title}</h1>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-app-faint">
          {intent}
        </span>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {!conv ? (
            <div className="grid place-items-center py-12 text-sm text-app-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            conv.messages.map((m, i) => (
              <Bubble key={i} role={m.role} text={m.text} />
            ))
          )}
          {conv?.thinking && (
            <div className="flex items-center gap-2 text-xs text-app-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
          isUser
            ? "bg-indigo-500/20 text-indigo-300"
            : "bg-app-elevated text-app-muted"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-indigo-500/15 text-white"
            : "bg-app-surface text-app"
        }`}
      >
        {text}
      </div>
    </div>
  );
}
