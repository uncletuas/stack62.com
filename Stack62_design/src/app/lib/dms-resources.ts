/**
 * Typed client functions for the new DMS / OCR / semantic-search /
 * rooms / streaming-generation endpoints. Thin wrapper around
 * apiRequest() so we keep the rest of the app free of string URLs.
 */
import { apiRequest, getApiBaseUrl, getStoredToken } from "./api";

// ── Folders ────────────────────────────────────────────────────────────

export interface FolderDto {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  parentId: string | null;
  name: string;
  path: string;
  isRoot: boolean;
  ownerUserId: string;
  isPersonal: boolean;
  createdAt: string;
}

export interface FolderAclDto {
  id: string;
  folderId: string;
  subjectType: "user" | "role" | "org_everyone" | "workspace_everyone";
  userId: string | null;
  role: string | null;
  permission: "read" | "comment" | "write" | "share" | "admin";
  grantedByUserId: string;
  expiresAt: string | null;
  createdAt: string;
}

export const foldersApi = {
  list(organizationId: string, parentId?: string) {
    return apiRequest<FolderDto[]>("/folders", {
      query: { organizationId, parentId: parentId ?? "" },
    });
  },
  create(payload: {
    organizationId: string;
    workspaceId?: string;
    parentId?: string;
    name: string;
    isPersonal?: boolean;
  }) {
    return apiRequest<FolderDto>("/folders", { method: "POST", body: payload });
  },
  rename(id: string, name: string) {
    return apiRequest<FolderDto>(`/folders/${id}`, {
      method: "PATCH",
      body: { name },
    });
  },
  acls(id: string) {
    return apiRequest<FolderAclDto[]>(`/folders/${id}/acls`);
  },
  grant(
    id: string,
    body: {
      subjectType: FolderAclDto["subjectType"];
      userId?: string;
      role?: string;
      permission: FolderAclDto["permission"];
      expiresAt?: string;
    },
  ) {
    return apiRequest<FolderAclDto>(`/folders/${id}/acls`, {
      method: "POST",
      body,
    });
  },
  revoke(aclId: string) {
    return apiRequest<void>(`/folders/acls/${aclId}`, { method: "DELETE" });
  },
};

// ── Document extraction ────────────────────────────────────────────────

export interface DocumentExtractionDto {
  id: string;
  fileId: string;
  status: "pending" | "extracting" | "completed" | "failed";
  documentType: string;
  extractedFields: Record<string, unknown> | null;
  rawText: string | null;
  confidence: number | null;
  modelUsed: string | null;
  extractedAt: string | null;
  errorMessage: string | null;
}

export const extractionApi = {
  get(fileId: string) {
    return apiRequest<DocumentExtractionDto | null>(
      `/document-extraction/files/${fileId}`,
    );
  },
  extract(fileId: string, options?: { force?: boolean; hint?: string }) {
    return apiRequest<DocumentExtractionDto>(
      `/document-extraction/files/${fileId}/extract`,
      { method: "POST", body: options ?? {} },
    );
  },
};

// ── Semantic search ───────────────────────────────────────────────────

export interface SemanticHitDto {
  fileId: string;
  ordinal: number;
  text: string;
  score: number;
  filename?: string;
  folderId?: string | null;
}

export const searchApi = {
  search(organizationId: string, q: string, opts?: { limit?: number; folderId?: string }) {
    return apiRequest<SemanticHitDto[]>("/semantic-search/search", {
      query: {
        organizationId,
        q,
        limit: opts?.limit ?? 8,
        folderId: opts?.folderId ?? "",
      },
    });
  },
  index(fileId: string) {
    return apiRequest<{ chunks: number }>(
      `/semantic-search/index/${fileId}`,
      { method: "POST" },
    );
  },
};

// ── Rooms ──────────────────────────────────────────────────────────────

export interface RoomDto {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  systemId: string | null;
  kind: "channel" | "group" | "dm" | "coworker_private";
  visibility: "public" | "private";
  name: string | null;
  topic: string | null;
  coworkerEnabled: boolean;
  lastActivityAt: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface RoomMemberDto {
  id: string;
  roomId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  lastReadAt: string | null;
  muted: boolean;
  createdAt: string;
}

export interface RoomMessageDto {
  id: string;
  roomId: string;
  authorKind: "user" | "coworker" | "system";
  authorUserId: string | null;
  body: string;
  parentMessageId: string | null;
  attachments: Array<{
    kind: "file" | "record" | "tool_call" | "plan";
    id: string;
    label?: string;
  }> | null;
  mentions: string[] | null;
  createdAt: string;
  editedAt: string | null;
}

export const roomsApi = {
  list(organizationId: string) {
    return apiRequest<RoomDto[]>("/rooms", { query: { organizationId } });
  },
  channels(organizationId: string) {
    return apiRequest<RoomDto[]>("/rooms/channels", {
      query: { organizationId },
    });
  },
  openPrivate(organizationId: string) {
    return apiRequest<RoomDto>("/rooms/coworker-private", {
      method: "POST",
      body: { organizationId },
    });
  },
  create(body: {
    organizationId: string;
    workspaceId?: string;
    systemId?: string;
    kind: RoomDto["kind"];
    name?: string;
    topic?: string;
    memberUserIds?: string[];
    coworkerEnabled?: boolean;
  }) {
    return apiRequest<RoomDto>("/rooms", { method: "POST", body });
  },
  members(roomId: string) {
    return apiRequest<RoomMemberDto[]>(`/rooms/${roomId}/members`);
  },
  messages(roomId: string, opts?: { limit?: number; before?: string }) {
    return apiRequest<RoomMessageDto[]>(`/rooms/${roomId}/messages`, {
      query: {
        limit: opts?.limit ?? 50,
        before: opts?.before ?? "",
      },
    });
  },
  post(
    roomId: string,
    body: {
      body: string;
      parentMessageId?: string;
      mentions?: string[];
      attachments?: RoomMessageDto["attachments"];
    },
  ) {
    return apiRequest<RoomMessageDto>(`/rooms/${roomId}/messages`, {
      method: "POST",
      body,
    });
  },
  read(roomId: string) {
    return apiRequest<{ ok: true }>(`/rooms/${roomId}/read`, { method: "POST" });
  },
  addMember(roomId: string, userId: string) {
    return apiRequest<RoomMemberDto>(`/rooms/${roomId}/members/${userId}`, {
      method: "POST",
    });
  },
  removeMember(roomId: string, userId: string) {
    return apiRequest<{ ok: true }>(
      `/rooms/${roomId}/members/${userId}`,
      { method: "DELETE" },
    );
  },
};

// ── Streaming generation (SSE) ─────────────────────────────────────────

export type StreamGenerationEvent =
  | { type: "started"; outputKind: string }
  | { type: "delta"; text: string }
  | { type: "completed"; fullText: string; tokens: number }
  | { type: "error"; message: string };

export interface StreamGenerationOptions {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  prompt: string;
  outputKind: "text" | "markdown" | "csv" | "json" | "code";
  language?: string;
  priorContent?: string;
  signal?: AbortSignal;
  onEvent: (event: StreamGenerationEvent) => void;
}

/**
 * Open an SSE stream against /streaming-generation. Wired to call
 * `onEvent` for every delta as the LLM types — UI uses this to render
 * the typing animation. Returns when the stream completes or aborts.
 */
export async function streamGeneration(opts: StreamGenerationOptions) {
  const response = await fetch(`${getApiBaseUrl()}/streaming-generation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getStoredToken() ?? ""}`,
    },
    body: JSON.stringify({
      organizationId: opts.organizationId,
      workspaceId: opts.workspaceId,
      systemId: opts.systemId,
      prompt: opts.prompt,
      outputKind: opts.outputKind,
      language: opts.language,
      priorContent: opts.priorContent,
    }),
    signal: opts.signal,
  });
  if (!response.ok || !response.body) {
    opts.onEvent({
      type: "error",
      message: `Stream open failed: ${response.status}`,
    });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE blocks are separated by blank lines.
    let blockEnd;
    while ((blockEnd = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, blockEnd);
      buffer = buffer.slice(blockEnd + 2);
      const dataLine = block
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as StreamGenerationEvent;
        opts.onEvent(event);
      } catch {
        /* ignore malformed */
      }
    }
  }
}
