import { useCallback, useEffect, useRef, useState } from "react";
import {
  Hash,
  Link2,
  MessageSquare,
  Plus,
  Send,
  Slack,
  Sparkles,
  Users,
} from "lucide-react";
import {
  roomsApi,
  slackApi,
  type RoomDto,
  type RoomMessageDto,
  type SlackChannelDto,
  type SlackMappingDto,
  type SlackStatusDto,
} from "../../lib/dms-resources";
import { useAppContext } from "../../context/app-context";

/**
 * Coworker Rooms surface.
 *
 * Left rail: list of rooms the user is in + a "Private Coworker" toggle
 * that opens (or creates) their personal 1:1 thread with the AI.
 *
 * Middle pane: thread of messages for the active room.
 *
 * The Coworker is summoned with @stack62 inside any room. In the
 * private room it speaks first when there are no messages.
 */
export function RoomEditor() {
  const { currentOrganization } = useAppContext();
  const orgId = currentOrganization?.id ?? "";

  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RoomMessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slackStatus, setSlackStatus] = useState<SlackStatusDto | null>(null);
  const [slackPanelOpen, setSlackPanelOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadRooms = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const list = await roomsApi.list(orgId);
      setRooms(list);
      if (!activeRoomId && list.length > 0) {
        setActiveRoomId(list[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [orgId, activeRoomId]);

  const loadMessages = useCallback(async (roomId: string) => {
    const msgs = await roomsApi.messages(roomId);
    setMessages(msgs);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, []);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    if (!orgId) return;
    slackApi.status(orgId).then(setSlackStatus).catch(() => undefined);
  }, [orgId]);

  const connectSlack = async () => {
    if (!orgId) return;
    const { url } = await slackApi.installUrl(orgId);
    window.location.href = url;
  };

  useEffect(() => {
    if (activeRoomId) {
      loadMessages(activeRoomId);
    } else {
      setMessages([]);
    }
  }, [activeRoomId, loadMessages]);

  const openPrivateCoworker = async () => {
    if (!orgId) return;
    const room = await roomsApi.openPrivate(orgId);
    setRooms((prev) =>
      prev.some((r) => r.id === room.id) ? prev : [room, ...prev],
    );
    setActiveRoomId(room.id);
  };

  const createChannel = async () => {
    const name = window.prompt("Channel name (e.g. design, engineering)");
    if (!name?.trim() || !orgId) return;
    const room = await roomsApi.create({
      organizationId: orgId,
      kind: "channel",
      name: name.trim(),
      coworkerEnabled: true,
    });
    setRooms((prev) => [room, ...prev]);
    setActiveRoomId(room.id);
  };

  const sendMessage = async () => {
    if (!draft.trim() || !activeRoomId) return;
    setPosting(true);
    try {
      const message = await roomsApi.post(activeRoomId, {
        body: draft.trim(),
      });
      setMessages((prev) => [...prev, message]);
      setDraft("");
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      });
    } finally {
      setPosting(false);
    }
  };

  const activeRoom = rooms.find((r) => r.id === activeRoomId) || null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Rooms rail */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-app bg-app-surface">
        <div className="border-b border-app px-3 py-3">
          <button
            onClick={openPrivateCoworker}
            className="flex w-full items-center gap-2 rounded-md bg-accent/10 px-2 py-2 text-sm text-accent hover:bg-accent/20"
          >
            <Sparkles className="size-4" />
            <span className="flex-1 text-left">Private Coworker</span>
          </button>
        </div>
        <div className="flex items-center justify-between px-3 pt-3 pb-1.5 text-xs font-semibold uppercase text-app-faint">
          <span>Rooms</span>
          <button
            onClick={createChannel}
            className="rounded p-1 hover:bg-app-hover"
            title="New channel"
          >
            <Plus className="size-3" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-2 pb-3">
          {loading ? (
            <div className="px-3 text-xs text-app-faint">Loading…</div>
          ) : rooms.length === 0 ? (
            <div className="px-3 text-xs text-app-faint">
              No rooms yet. Use the buttons above to start one.
            </div>
          ) : (
            rooms.map((room) => (
              <RoomRow
                key={room.id}
                room={room}
                active={room.id === activeRoomId}
                onClick={() => setActiveRoomId(room.id)}
              />
            ))
          )}
        </div>

        {/* Slack section */}
        <div className="border-t border-app px-3 py-3">
          {slackStatus?.connected ? (
            <button
              onClick={() => setSlackPanelOpen(true)}
              className="flex w-full items-center gap-2 rounded-md border border-app px-2 py-1.5 text-xs text-app-faint hover:bg-app-hover"
            >
              <Slack className="size-3.5" />
              <span className="flex-1 truncate text-left">
                {slackStatus.teamName || "Slack"} • Bridge…
              </span>
            </button>
          ) : (
            <button
              onClick={connectSlack}
              className="flex w-full items-center gap-2 rounded-md border border-app px-2 py-1.5 text-xs hover:bg-app-hover"
            >
              <Slack className="size-3.5" />
              Add to Slack
            </button>
          )}
        </div>
      </aside>

      {slackPanelOpen && (
        <SlackBridgePanel
          orgId={orgId}
          rooms={rooms}
          activeRoomId={activeRoomId}
          onClose={() => setSlackPanelOpen(false)}
        />
      )}

      {/* Thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        {activeRoom ? (
          <>
            <div className="flex items-center gap-2 border-b border-app px-4 py-3">
              <RoomIcon kind={activeRoom.kind} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {roomDisplayName(activeRoom)}
                </div>
                {activeRoom.topic && (
                  <div className="truncate text-xs text-app-faint">
                    {activeRoom.topic}
                  </div>
                )}
              </div>
              <div className="text-xs text-app-faint">
                {activeRoom.coworkerEnabled ? "Coworker on" : "Coworker off"}
              </div>
            </div>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 space-y-3 overflow-auto p-4"
            >
              {messages.length === 0 ? (
                <EmptyState room={activeRoom} />
              ) : (
                messages.map((msg) => <MessageRow key={msg.id} msg={msg} />)
              )}
            </div>

            <div className="border-t border-app bg-app-surface px-3 py-3">
              <div className="flex gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder={
                    activeRoom.coworkerEnabled
                      ? "Message — use @stack62 to summon the Coworker"
                      : "Message…"
                  }
                  rows={2}
                  className="min-h-9 flex-1 resize-none rounded-md border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  onClick={sendMessage}
                  disabled={posting || !draft.trim()}
                  className="rounded-md bg-accent px-3 text-accent-fg hover:opacity-90 disabled:opacity-50"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="grid h-full place-items-center text-sm text-app-faint">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-2 size-6 text-app-faint" />
              <p>Open a room to start chatting.</p>
              <p className="mt-1 text-xs">
                Click <strong>Private Coworker</strong> for a 1:1 thread, or
                start a channel for your team.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RoomRow({
  room,
  active,
  onClick,
}: {
  room: RoomDto;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-app-hover ${
        active ? "bg-app-hover font-semibold" : ""
      }`}
    >
      <RoomIcon kind={room.kind} />
      <span className="truncate">{roomDisplayName(room)}</span>
    </button>
  );
}

function RoomIcon({ kind }: { kind: RoomDto["kind"] }) {
  if (kind === "coworker_private") return <Sparkles className="size-4 text-accent" />;
  if (kind === "channel") return <Hash className="size-4 text-app-faint" />;
  if (kind === "dm") return <MessageSquare className="size-4 text-app-faint" />;
  return <Users className="size-4 text-app-faint" />;
}

function MessageRow({ msg }: { msg: RoomMessageDto }) {
  const isCoworker = msg.authorKind === "coworker";
  return (
    <div className="flex gap-3">
      <div
        className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
          isCoworker
            ? "bg-accent/15 text-accent"
            : "bg-app-hover text-app-faint"
        }`}
      >
        {isCoworker ? <Sparkles className="size-3.5" /> : "U"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">
            {isCoworker ? "Coworker" : "You"}
          </span>
          <span className="text-xs text-app-faint">
            {new Date(msg.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="mt-0.5 whitespace-pre-wrap break-words text-sm">
          {msg.body}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ room }: { room: RoomDto }) {
  if (room.kind === "coworker_private") {
    return (
      <div className="grid h-full place-items-center">
        <div className="text-center text-sm text-app-faint">
          <Sparkles className="mx-auto mb-2 size-6 text-accent" />
          <p>
            Your private 1:1 with the Coworker. Anything you type here is only
            seen by you.
          </p>
          <p className="mt-1 text-xs">
            Ask it to find a doc, draft an email, or plan a change.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full place-items-center">
      <div className="text-center text-sm text-app-faint">
        <p>This room is empty.</p>
        <p className="mt-1 text-xs">
          Type a message to start the conversation. Summon the Coworker with{" "}
          <code className="rounded bg-app px-1 py-0.5">@stack62</code>.
        </p>
      </div>
    </div>
  );
}

function SlackBridgePanel({
  orgId,
  rooms,
  activeRoomId,
  onClose,
}: {
  orgId: string;
  rooms: RoomDto[];
  activeRoomId: string | null;
  onClose: () => void;
}) {
  const [channels, setChannels] = useState<SlackChannelDto[]>([]);
  const [mappings, setMappings] = useState<SlackMappingDto[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string>(activeRoomId || "");
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      slackApi.channels(orgId).catch(() => []),
      slackApi.mappings(orgId).catch(() => []),
    ]).then(([c, m]) => {
      setChannels(c);
      setMappings(m);
    });
  }, [orgId]);

  const createMapping = async () => {
    if (!selectedRoom || !selectedChannel) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const channel = channels.find((c) => c.id === selectedChannel);
      await slackApi.createMapping({
        organizationId: orgId,
        roomId: selectedRoom,
        slackChannelId: selectedChannel,
        slackChannelName: channel?.name,
      });
      const refreshed = await slackApi.mappings(orgId);
      setMappings(refreshed);
      setFeedback("Bridge created — messages will now sync both ways.");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async (id: string) => {
    await slackApi.deleteMapping(id);
    const refreshed = await slackApi.mappings(orgId);
    setMappings(refreshed);
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-app bg-app-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-app-faint" />
            <h3 className="text-sm font-semibold">Bridge to Slack</h3>
          </div>
          <button onClick={onClose} className="text-app-faint hover:text-app">
            ×
          </button>
        </div>

        <div className="space-y-4 p-4 text-sm">
          <p className="text-xs text-app-faint">
            Pick a Stack62 room and a Slack channel. Messages flow both ways
            while the bridge is active.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-app-faint">
                Stack62 room
              </label>
              <select
                value={selectedRoom}
                onChange={(e) => setSelectedRoom(e.target.value)}
                className="w-full rounded-md border border-app bg-app px-2 py-1.5 text-sm"
              >
                <option value="">Pick a room…</option>
                {rooms
                  .filter((r) => r.kind !== "coworker_private")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || `(${r.kind})`}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-app-faint">
                Slack channel
              </label>
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="w-full rounded-md border border-app bg-app px-2 py-1.5 text-sm"
              >
                <option value="">Pick a channel…</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={createMapping}
            disabled={submitting || !selectedRoom || !selectedChannel}
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Linking…" : "Create bridge"}
          </button>

          {feedback && (
            <p className="text-xs text-app-faint">{feedback}</p>
          )}

          {mappings.length > 0 && (
            <section>
              <h4 className="mb-1.5 text-xs font-semibold uppercase text-app-faint">
                Active bridges ({mappings.length})
              </h4>
              <ul className="space-y-1.5 rounded-md border border-app bg-app p-2 text-xs">
                {mappings.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">
                      {rooms.find((r) => r.id === m.roomId)?.name || "Room"}{" "}
                      ↔ #{m.slackChannelName || m.slackChannelId}
                    </span>
                    <button
                      onClick={() => revoke(m.id)}
                      className="text-app-faint hover:text-red-500"
                    >
                      Unlink
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function roomDisplayName(room: RoomDto): string {
  if (room.name) return room.name;
  if (room.kind === "coworker_private") return "Private Coworker";
  if (room.kind === "dm") return "Direct message";
  return "Untitled room";
}
