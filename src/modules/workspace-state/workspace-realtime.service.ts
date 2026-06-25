import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  Hocuspocus,
  Server,
  type onAuthenticatePayload,
  type onLoadDocumentPayload,
  type onStoreDocumentPayload,
} from '@hocuspocus/server';
import * as Y from 'yjs';
import { WebSocketServer } from 'ws';
import type { Server as HttpServer } from 'node:http';
import { WorkspaceStateService } from './workspace-state.service';

/**
 * Hocuspocus realtime server for workspace docs.
 *
 * Hocuspocus is a Yjs-aware websocket server. It accepts client
 * connections, ships incremental Yjs updates between them, and calls
 * our hooks for auth, load, and persistence. Three contracts we own:
 *
 *   1. Auth. The browser's HocuspocusProvider passes our JWT in the
 *      `token` field of the connect frame. `onAuthenticate` verifies
 *      it with the same JwtService the rest of Stack62 uses; rejection
 *      drops the socket.
 *
 *   2. Load. On first connect for a given docName, `onLoadDocument`
 *      pulls the stored Yjs binary from Postgres and applies it to
 *      the in-memory Y.Doc.
 *
 *   3. Store. After every burst of edits (Hocuspocus debounces for
 *      us), `onStoreDocument` writes the merged Y.Doc back to
 *      Postgres. This is the only write path Hocuspocus uses; AI
 *      action dispatch writes through `WorkspaceStateService` and
 *      then the next `onStoreDocument` picks up the new state for
 *      anyone connected.
 *
 * Mounting: we don't run a separate process. `attach(httpServer)`
 * binds Hocuspocus to the existing Nest HTTP server at path
 * `/v1/realtime/workspace` so all of Stack62 sits behind one origin.
 * The frontend connects with:
 *
 *     new HocuspocusProvider({
 *       url: 'wss://stack62.com/v1/realtime/workspace',
 *       name: docId,
 *       token: jwt,
 *       document: ydoc,
 *     });
 */
@Injectable()
export class WorkspaceRealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceRealtimeService.name);
  private server: Hocuspocus | null = null;
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly state: WorkspaceStateService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Wire Hocuspocus onto the running Nest HTTP server. Called from
   * `main.ts` after `app.listen()` returns. We can't construct the
   * server in the module's constructor because the HTTP listener
   * isn't available yet — Nest's lifecycle gives us
   * `getHttpAdapter().getInstance()` only after listen.
   */
  attach(httpServer: HttpServer): void {
    if (this.server) return;
    this.server = Server.configure({
      name: 'stack62-workspace',

      // Auth — verifies the JWT the provider sent in the connect frame.
      onAuthenticate: async (data: onAuthenticatePayload) => {
        const token = data.token?.trim();
        if (!token) {
          throw new Error('Realtime requires an auth token.');
        }
        try {
          const payload = this.jwt.verify<{
            sub?: string;
            userId?: string;
            email?: string;
          }>(token);
          const userId = payload.userId ?? payload.sub;
          if (!userId) throw new Error('Token missing userId.');
          // Returned context lands in subsequent hooks as `data.context`.
          // The actor's read/write is re-checked against the doc on
          // load + store; this is just identity establishment.
          return { userId, email: payload.email ?? null };
        } catch (err) {
          this.logger.warn(
            `Realtime auth rejected: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          throw new Error('Invalid auth token.');
        }
      },

      // Load existing state from Postgres into the Y.Doc.
      onLoadDocument: async (data: onLoadDocumentPayload) => {
        const docId = data.documentName;
        const ctx = data.context as { userId?: string };
        if (!ctx?.userId) throw new Error('Connection has no userId.');
        try {
          const { bytes } = await this.state.readBinaryState(docId, ctx.userId);
          const ydoc = new Y.Doc();
          if (bytes && bytes.length > 0) {
            Y.applyUpdate(ydoc, new Uint8Array(bytes));
          }
          return ydoc;
        } catch (err) {
          this.logger.warn(
            `Realtime load failed for ${docId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          throw err;
        }
      },

      // Persist after edits (Hocuspocus debounces; default ~2s).
      onStoreDocument: async (data: onStoreDocumentPayload) => {
        const docId = data.documentName;
        const ctx = data.context as { userId?: string };
        if (!ctx?.userId) return;
        const bytes = Y.encodeStateAsUpdate(data.document);
        try {
          await this.state.persistBinaryState(docId, bytes, ctx.userId);
        } catch (err) {
          this.logger.warn(
            `Realtime store failed for ${docId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      },
    });

    // Hocuspocus's `handleConnection` expects an *already upgraded*
    // `ws` WebSocket — not the raw TCP socket the HTTP `upgrade` event
    // hands us. Passing the raw socket skips the handshake entirely:
    // the browser never receives a 101 Switching Protocols (so the
    // editor sits on "connecting") and Hocuspocus crashes the process
    // when it tries to drive a net.Socket as if it were a WebSocket.
    //
    // Run the handshake ourselves with a `noServer` WebSocketServer,
    // then forward the upgraded socket to Hocuspocus. We still hook the
    // existing HTTP server's `upgrade` event so the websocket lives on
    // the same port + origin as the REST API, path-scoped to
    // `/v1/realtime/workspace` so other paths stay free.
    this.wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (request, socket, head) => {
      if (!request.url) return;
      // Match exactly /v1/realtime/workspace plus optional trailing slash.
      const url = new URL(request.url, 'http://placeholder');
      if (
        url.pathname !== '/v1/realtime/workspace' &&
        url.pathname !== '/v1/realtime/workspace/'
      ) {
        // Not ours — leave the socket for any other upgrade handler.
        return;
      }
      this.wss?.handleUpgrade(request, socket, head, (ws) => {
        this.server?.handleConnection(ws, request, {});
      });
    });

    this.logger.log('Hocuspocus attached at /v1/realtime/workspace');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      await this.server.destroy().catch(() => undefined);
      this.server = null;
    }
  }
}
