import { useEffect, useState } from "react";
import { Hash, Loader2, Mail, MessageSquare, Sparkles, Users, X } from "lucide-react";
import {
  fetchWhatsAppConversations,
  sendIntegrationWhatsAppMedia,
  type WhatsAppConversation,
} from "../lib/resources";
import { roomsApi, type RoomDto } from "../lib/dms-resources";

type Target = "whatsapp" | "rooms" | "email";

/**
 * Send the selected Stack62 file(s) straight to a messaging destination —
 * a WhatsApp chat, a team room, or a new email — without leaving the Files
 * page. Files are referenced by id, so nothing is re-uploaded.
 */
export function ShareToPicker({
  organizationId,
  workspaceId,
  files,
  onClose,
  onDone,
}: {
  organizationId: string;
  workspaceId?: string | null;
  files: Array<{ id: string; filename: string }>;
  onClose: () => void;
  onDone?: (message: string) => void;
}) {
  const [target, setTarget] = useState<Target>("whatsapp");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = (message: string) => {
    onDone?.(message);
    onClose();
  };

  const sendToWhatsApp = async (c: WhatsAppConversation) => {
    setBusy(true);
    setError(null);
    try {
      for (const f of files) {
        await sendIntegrationWhatsAppMedia({
          organizationId,
          workspaceId: workspaceId ?? undefined,
          to: c.contactPhone,
          fileId: f.id,
        });
      }
      finish(`Sent ${files.length} file(s) to ${c.contactName ?? c.contactPhone}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send on WhatsApp.");
      setBusy(false);
    }
  };

  const sendToRoom = async (room: RoomDto) => {
    setBusy(true);
    setError(null);
    try {
      await roomsApi.post(room.id, {
        body: "",
        attachments: files.map((f) => ({
          kind: "file" as const,
          id: f.id,
          label: f.filename,
        })),
      });
      finish(`Shared ${files.length} file(s) to ${room.name ?? "room"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post to the room.");
      setBusy(false);
    }
  };

  const sendToEmail = () => {
    window.dispatchEvent(
      new CustomEvent("stack62:open-email", {
        detail: {
          subject:
            files.length === 1 ? `Sharing: ${files[0].filename}` : "Files for you",
          body: `Please find ${files.length} attached file${
            files.length === 1 ? "" : "s"
          }.`,
          attachmentFileIds: files.map((f) => f.id),
        },
      }),
    );
    finish("Opened a new email with your file(s) attached.");
  };

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[26rem] w-full max-w-sm flex-col overflow-hidden rounded-xl border border-app bg-app-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-app px-3 py-2">
          <span className="text-sm font-semibold text-app">
            Send {files.length} file{files.length === 1 ? "" : "s"} to…
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-app-muted hover:bg-app-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-0.5 border-b border-app p-1.5">
          <TargetTab
            active={target === "whatsapp"}
            onClick={() => setTarget("whatsapp")}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            label="WhatsApp"
          />
          <TargetTab
            active={target === "rooms"}
            onClick={() => setTarget("rooms")}
            icon={<Users className="h-3.5 w-3.5" />}
            label="Rooms"
          />
          <TargetTab
            active={target === "email"}
            onClick={() => setTarget("email")}
            icon={<Mail className="h-3.5 w-3.5" />}
            label="Email"
          />
        </div>

        {error && (
          <p className="mx-3 mt-2 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            {error}
          </p>
        )}

        <div className="relative min-h-0 flex-1 overflow-auto">
          {busy && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-app-elevated/70">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
          )}
          {target === "whatsapp" && (
            <WhatsAppTargets
              organizationId={organizationId}
              workspaceId={workspaceId}
              onPick={(c) => void sendToWhatsApp(c)}
            />
          )}
          {target === "rooms" && (
            <RoomTargets
              organizationId={organizationId}
              onPick={(r) => void sendToRoom(r)}
            />
          )}
          {target === "email" && (
            <div className="grid h-full place-items-center p-4 text-center">
              <div>
                <Mail className="mx-auto mb-2 h-7 w-7 text-app-muted" />
                <button
                  type="button"
                  onClick={sendToEmail}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover"
                >
                  Compose email with attachments
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TargetTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${
        active
          ? "bg-accent text-accent-fg shadow-sm"
          : "text-app-muted hover:bg-app-hover hover:text-app"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function WhatsAppTargets({
  organizationId,
  workspaceId,
  onPick,
}: {
  organizationId: string;
  workspaceId?: string | null;
  onPick: (c: WhatsAppConversation) => void;
}) {
  const [items, setItems] = useState<WhatsAppConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWhatsAppConversations(organizationId, workspaceId ?? undefined)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [organizationId, workspaceId]);

  if (loading)
    return <p className="px-3 py-3 text-[11px] text-app-subtle">Loading…</p>;
  if (items.length === 0)
    return (
      <p className="px-3 py-3 text-[11px] text-app-subtle">
        No WhatsApp chats yet.
      </p>
    );
  return (
    <div className="p-1">
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-app-hover"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-emerald-500/15 text-[11px] font-semibold text-emerald-300">
            {c.contactAvatarUrl ? (
              <img
                src={c.contactAvatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              (c.contactName ?? c.contactPhone).slice(0, 1).toUpperCase()
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs">
            {c.contactName ?? `+${c.contactPhone}`}
          </span>
        </button>
      ))}
    </div>
  );
}

function RoomTargets({
  organizationId,
  onPick,
}: {
  organizationId: string;
  onPick: (r: RoomDto) => void;
}) {
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    roomsApi
      .list(organizationId)
      .then(setRooms)
      .catch(() => setRooms([]))
      .finally(() => setLoading(false));
  }, [organizationId]);

  if (loading)
    return <p className="px-3 py-3 text-[11px] text-app-subtle">Loading…</p>;
  if (rooms.length === 0)
    return (
      <p className="px-3 py-3 text-[11px] text-app-subtle">No rooms yet.</p>
    );
  return (
    <div className="p-1">
      {rooms.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onPick(r)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-app-hover"
        >
          {r.kind === "channel" ? (
            <Hash className="h-3.5 w-3.5 text-app-subtle" />
          ) : r.kind === "coworker_private" ? (
            <Sparkles className="h-3.5 w-3.5 text-accent" />
          ) : (
            <Users className="h-3.5 w-3.5 text-app-subtle" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs">
            {r.name ?? "Untitled room"}
          </span>
        </button>
      ))}
    </div>
  );
}
