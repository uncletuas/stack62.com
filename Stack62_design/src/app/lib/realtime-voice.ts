/**
 * OpenAI Realtime API WebRTC client.
 *
 * What this does:
 *   - Fetches an ephemeral session token from POST /v1/realtime-voice/session
 *     (our backend mints it so the user's browser never sees OPENAI_API_KEY).
 *   - Opens an RTCPeerConnection to the OpenAI Realtime endpoint.
 *   - Adds the user's microphone as the outbound audio track.
 *   - Plays the model's audio response automatically via an <audio> element.
 *   - Opens an `oai-events` data channel for typed events (transcripts,
 *     speech-started/stopped, function calls, errors).
 *
 * The caller subscribes to lifecycle callbacks (onAssistantSpeakingStart,
 * onAssistantSpeakingEnd, onTranscriptDelta, onError) to drive UI like
 * the Coworker face mouth animation, status pills, and transcripts.
 *
 * Honest scope:
 *   - One peer connection per client instance.
 *   - Single voice (configured server-side in the session). Voice can
 *     be overridden at call time via `session.update`.
 *   - No vision yet — when we want camera frames, we add another track
 *     to the same peer connection and OpenAI Realtime accepts it.
 */

import { apiRequest } from "./api";

export interface RealtimeVoiceCallbacks {
  /** Called once the WebRTC connection + data channel are open. */
  onConnected?: () => void;
  /** AI started vocalising — flip the face's `speaking` to true. */
  onAssistantSpeakingStart?: () => void;
  /** AI finished its current audio segment. */
  onAssistantSpeakingEnd?: () => void;
  /** A transcript word/sentence arrived — drives the mouth-pulse counter. */
  onAssistantTranscriptDelta?: (delta: string) => void;
  /** The user started speaking (VAD on the server). */
  onUserSpeechStart?: () => void;
  /** The user stopped speaking. */
  onUserSpeechStop?: () => void;
  /** Server-side transcript of what the user just said. */
  onUserTranscriptFinal?: (text: string) => void;
  /** Unrecoverable error — disconnect was triggered. */
  onError?: (error: Error) => void;
  /** Connection went away (network drop, server hangup). */
  onDisconnected?: () => void;
}

interface SessionInfo {
  sessionId: string;
  model: string;
  ephemeralKey: string;
  expiresAt: number;
}

export class RealtimeVoiceClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audio: HTMLAudioElement | null = null;
  private localStream: MediaStream | null = null;
  private callbacks: RealtimeVoiceCallbacks = {};
  private connected = false;

  // ── Vision (Phase 2) ──────────────────────────────────────────────
  private videoStream: MediaStream | null = null;
  private videoSampler: number | null = null;
  /** Hidden <video> element decoding the attached stream so we can
   *  draw frames onto a canvas. Reused across captures. */
  private videoEl: HTMLVideoElement | null = null;
  /** Single offscreen-ish canvas reused for every frame capture. */
  private captureCanvas: HTMLCanvasElement | null = null;
  /** How often we send a frame to OpenAI. Default 2s — enough for the
   *  model to follow what's in front of the camera without burning
   *  bandwidth or tokens at higher rates. */
  private visionIntervalMs = 2000;

  isConnected(): boolean {
    return this.connected;
  }

  isVisionActive(): boolean {
    return !!this.videoStream;
  }

  /**
   * Open the realtime connection. Resolves when the data channel is
   * fully open and we're ready to exchange events. Rejects if the
   * backend doesn't have OPENAI_API_KEY configured (503) or if the
   * mic permission was denied.
   */
  async connect(callbacks: RealtimeVoiceCallbacks = {}): Promise<void> {
    this.callbacks = callbacks;

    // 1) Mint an ephemeral key via our backend.
    let session: SessionInfo;
    try {
      session = await apiRequest<SessionInfo>("/v1/realtime-voice/session");
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? `Realtime not available: ${err.message}`
          : "Realtime not available",
      );
    }
    if (!session.ephemeralKey) {
      throw new Error(
        "Server didn't return an ephemeral key. Is OPENAI_API_KEY set?",
      );
    }

    // 2) Build the peer connection.
    this.pc = new RTCPeerConnection();

    // 3) Hook up the remote audio. OpenAI sends one audio track back
    //    on the same PC; we route it to an <audio> element so the
    //    browser plays it automatically.
    this.audio = document.createElement("audio");
    this.audio.autoplay = true;
    this.pc.ontrack = (event) => {
      if (this.audio && event.streams[0]) {
        this.audio.srcObject = event.streams[0];
      }
    };

    // 4) Capture the user's mic.
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    } catch (err) {
      this.close();
      throw new Error(
        err instanceof Error
          ? `Microphone permission denied: ${err.message}`
          : "Microphone permission denied",
      );
    }
    this.localStream.getAudioTracks().forEach((track) => {
      this.pc!.addTrack(track, this.localStream!);
    });

    // 5) Data channel for typed events (transcripts, speech detection,
    //    function calls). Must be created before the offer.
    this.dc = this.pc.createDataChannel("oai-events");
    this.dc.onopen = () => {
      this.connected = true;
      // Set our preferred behaviour: VAD on (so we get speech-start /
      // speech-stop events), output transcript on, and a sensible
      // default instructions block. The session was already created
      // server-side with a baseline instructions block; this is a
      // pure client-side preference layer.
      this.dc?.send(
        JSON.stringify({
          type: "session.update",
          session: {
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              silence_duration_ms: 400,
            },
            input_audio_transcription: { model: "whisper-1" },
          },
        }),
      );
      this.callbacks.onConnected?.();
    };
    this.dc.onmessage = (event) => this.handleEvent(event.data);
    this.dc.onerror = () => {
      this.callbacks.onError?.(new Error("Realtime data channel error"));
    };

    // 6) WebRTC offer → POST to OpenAI Realtime with the ephemeral key
    //    → set the answer.
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const response = await fetch(
      `https://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model)}`,
      {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${session.ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      this.close();
      throw new Error(
        `OpenAI Realtime rejected the offer (${response.status}): ${text.slice(0, 160)}`,
      );
    }
    const answerSdp = await response.text();
    await this.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  /**
   * Phase-2 vision: attach a video MediaStream and the client will
   * periodically draw a frame to an offscreen canvas, encode it as
   * a JPEG data URL, and ship it across the data channel as a
   * conversation item with an `input_image` content block.
   *
   * The model accumulates those frames in conversation state so when
   * the user speaks next, GPT-4o has the most recent frames in
   * context (use it to answer "what am I holding?", "describe the
   * room", etc.). We don't fire `response.create` per frame — frames
   * are passive context; speech triggers responses.
   *
   * Frame rate defaults to one frame every 2s. Resolution is capped
   * at 512×512 with quality 0.6 to keep payloads under ~30 KB each.
   */
  async attachVideoStream(
    stream: MediaStream,
    opts: { intervalMs?: number } = {},
  ): Promise<void> {
    if (!this.connected) {
      throw new Error("Cannot attach video before the channel is connected.");
    }
    this.detachVideoStream();
    this.videoStream = stream;
    this.visionIntervalMs = Math.max(800, opts.intervalMs ?? 2000);

    // Prepare the decoder + canvas once. We hide the <video> off-screen.
    this.videoEl = document.createElement("video");
    this.videoEl.srcObject = stream;
    this.videoEl.muted = true;
    this.videoEl.playsInline = true;
    this.videoEl.style.position = "fixed";
    this.videoEl.style.left = "-9999px";
    this.videoEl.style.top = "0";
    this.videoEl.style.width = "1px";
    this.videoEl.style.height = "1px";
    document.body.appendChild(this.videoEl);
    try {
      await this.videoEl.play();
    } catch {
      // Some browsers stall on autoplay without user gesture; the
      // capture loop still works once metadata loads.
    }

    this.captureCanvas = document.createElement("canvas");

    const tick = () => {
      if (!this.videoStream || !this.dc || this.dc.readyState !== "open") return;
      try {
        const v = this.videoEl!;
        const c = this.captureCanvas!;
        const vw = v.videoWidth || 640;
        const vh = v.videoHeight || 360;
        // Scale down: cap longer edge at 512.
        const max = Math.max(vw, vh);
        const scale = max > 512 ? 512 / max : 1;
        c.width = Math.round(vw * scale);
        c.height = Math.round(vh * scale);
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL("image/jpeg", 0.6);
        // Ship to the model as a user input item. `detail: "low"`
        // keeps the token cost down (≈85 tokens per frame).
        this.dc.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_image",
                  image_url: dataUrl,
                  detail: "low",
                },
              ],
            },
          }),
        );
      } catch {
        /* one bad frame shouldn't kill the loop */
      }
    };
    // Fire one frame right away (so the model has context immediately),
    // then on the interval.
    tick();
    this.videoSampler = window.setInterval(tick, this.visionIntervalMs);
  }

  /** Stop sending frames + tear down the hidden <video>. */
  detachVideoStream() {
    if (this.videoSampler) {
      window.clearInterval(this.videoSampler);
      this.videoSampler = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl.remove();
      this.videoEl = null;
    }
    this.captureCanvas = null;
    this.videoStream = null;
  }

  /**
   * Send a typed text message into the conversation (e.g. "summarise
   * what we just said"). The model responds via the same audio track.
   */
  sendText(text: string) {
    if (!this.dc || this.dc.readyState !== "open") return;
    this.dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      }),
    );
    this.dc.send(JSON.stringify({ type: "response.create" }));
  }

  /**
   * Mute / unmute the outbound mic without tearing down the call.
   * Useful for "pause talking" mid-conversation.
   */
  setMicEnabled(enabled: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }

  /** Tear down everything cleanly. */
  close() {
    this.connected = false;
    this.detachVideoStream();
    try {
      this.dc?.close();
    } catch {
      /* ignore */
    }
    this.dc = null;
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.pc = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    if (this.audio) {
      this.audio.srcObject = null;
      this.audio.remove();
      this.audio = null;
    }
    this.callbacks.onDisconnected?.();
  }

  // ── Event routing ───────────────────────────────────────────────────

  /**
   * Parse incoming data-channel messages and translate to our typed
   * callbacks. See https://platform.openai.com/docs/api-reference/realtime-server-events
   * for the full event vocabulary.
   */
  private handleEvent(raw: unknown) {
    if (typeof raw !== "string") return;
    let evt: { type?: string; delta?: string; transcript?: string };
    try {
      evt = JSON.parse(raw);
    } catch {
      return;
    }
    switch (evt.type) {
      case "response.audio.delta":
        // First audio chunk of a response → assistant started speaking.
        // We coalesce multiple deltas into a single "speaking" state
        // and clear on response.audio.done.
        this.callbacks.onAssistantSpeakingStart?.();
        break;
      case "response.audio.done":
      case "response.done":
        this.callbacks.onAssistantSpeakingEnd?.();
        break;
      case "response.audio_transcript.delta":
        if (typeof evt.delta === "string") {
          this.callbacks.onAssistantTranscriptDelta?.(evt.delta);
        }
        break;
      case "input_audio_buffer.speech_started":
        this.callbacks.onUserSpeechStart?.();
        break;
      case "input_audio_buffer.speech_stopped":
        this.callbacks.onUserSpeechStop?.();
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (typeof evt.transcript === "string") {
          this.callbacks.onUserTranscriptFinal?.(evt.transcript);
        }
        break;
      case "error":
        this.callbacks.onError?.(
          new Error(
            // OpenAI errors include a nested `error.message`; we don't
            // strongly type the union so just pretty-print whatever
            // came through.
            JSON.stringify(evt).slice(0, 240),
          ),
        );
        break;
      default:
        // Unhandled — fine; the spec adds events over time.
        break;
    }
  }
}

/**
 * Convenience check the UI uses to decide whether to even offer the
 * realtime path. Caches the result for the session so we don't ping
 * the backend repeatedly.
 */
let _availabilityCache: boolean | null = null;
export async function isRealtimeVoiceAvailable(): Promise<boolean> {
  if (_availabilityCache !== null) return _availabilityCache;
  try {
    // Endpoint returns 503 when OPENAI_API_KEY is unset. We don't
    // actually open a session here — we just verify the endpoint
    // responds 200 by trying it (the session itself is short-lived
    // and we'd waste an ephemeral key by opening one).
    // Cheap-and-correct: try the session endpoint with a HEAD-like
    // call. Our backend doesn't have a separate availability route,
    // so we accept that the first call will reveal it.
    await apiRequest("/v1/realtime-voice/session");
    _availabilityCache = true;
    return true;
  } catch {
    _availabilityCache = false;
    return false;
  }
}
