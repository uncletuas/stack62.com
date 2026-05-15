import { useEffect, useRef, useState } from "react";
import { CoworkerFace, type CoworkerMood } from "./CoworkerFace";
import { Loader2, Mic, MicOff, RefreshCw, Video, VideoOff, X } from "lucide-react";

/**
 * Full-screen call surface for Live mode. Theme-aware: the canvas
 * stays dark (camera video looks best on black regardless of OS
 * theme — Zoom, Meet, Teams all do this), but every chrome surface
 * uses app theme tokens so the call view doesn't look like a
 * different product when the user is on light mode.
 */
export function CoworkerCallView({
  stream,
  speaking,
  listening,
  thinking,
  micOn,
  starting,
  error,
  onRetry,
  onToggleMic,
  onEndCall,
  mouthPulse = 0,
  visionLive = false,
  mood = "neutral",
}: {
  stream: MediaStream | null;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  micOn: boolean;
  starting?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onToggleMic: () => void;
  onEndCall: () => void;
  mouthPulse?: number;
  /** True when realtime is shipping live frames to OpenAI. */
  visionLive?: boolean;
  mood?: CoworkerMood;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const cameraOff = !stream;

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => undefined);
    }
  }, [stream]);

  useEffect(() => {
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const mm = Math.floor(elapsed / 60)
    .toString()
    .padStart(2, "0");
  const ss = (elapsed % 60).toString().padStart(2, "0");

  const statusLabel = speaking
    ? "Coworker is speaking"
    : thinking
      ? "Thinking…"
      : listening
        ? "Listening"
        : "On call";

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
      {/* Top bar — theme-aware translucent chrome */}
      <div className="flex items-center justify-between border-b border-white/10 bg-black/50 px-4 py-2 text-xs backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-300">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
            LIVE
          </span>
          {visionLive && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300"
              title="Coworker is receiving live camera frames"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              SEEING
            </span>
          )}
          <span className="text-white/70">
            {mm}:{ss}
          </span>
          <span className="text-white/40">·</span>
          <span className="text-white/70">{statusLabel}</span>
        </div>
        <button
          type="button"
          onClick={onEndCall}
          className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
          title="End call"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Main stage: user's video */}
      <div className="relative flex-1 overflow-hidden bg-black">
        {error ? (
          <div className="grid h-full place-items-center bg-black/80 text-center text-white">
            <div className="max-w-md space-y-3 px-6">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-500/15 text-rose-400">
                <VideoOff className="h-5 w-5" />
              </div>
              <p className="text-base font-semibold">{error}</p>
              <p className="text-xs text-white/60">
                If you don't see a prompt, check your browser's site
                settings → Permissions → Camera.
              </p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mx-auto mt-2 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white"
                  style={{ backgroundColor: "var(--app-accent)" }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try again
                </button>
              )}
            </div>
          </div>
        ) : starting && !stream ? (
          <div className="grid h-full place-items-center bg-black/80 text-center text-white">
            <div className="space-y-3">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-white/70" />
              <p className="text-sm text-white/80">Starting camera…</p>
              <p className="text-xs text-white/40">
                Allow camera access in the browser prompt to begin.
              </p>
            </div>
          </div>
        ) : cameraOff ? (
          <div className="grid h-full place-items-center text-white/40">
            <div className="text-center">
              <VideoOff className="mx-auto h-10 w-10" />
              <p className="mt-2 text-sm">Camera is off</p>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ transform: "scaleX(-1)" }}
            className="h-full w-full object-cover"
          />
        )}

        {/* Coworker face — floating pill bottom-right */}
        <div className="absolute bottom-5 right-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/60 px-4 py-3 shadow-2xl backdrop-blur">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center rounded-full"
            style={{ backgroundColor: "var(--app-accent)" }}
          >
            <CoworkerFace
              size={44}
              speaking={speaking}
              thinking={thinking}
              mood={mood}
              mouthPulse={mouthPulse}
            />
          </div>
          <div>
            <p className="text-sm font-medium">Coworker</p>
            <p className="text-[11px] text-white/60">
              {speaking
                ? "speaking…"
                : thinking
                  ? "thinking…"
                  : listening
                    ? "listening"
                    : "idle"}
            </p>
          </div>
        </div>

        {/* Live indicator pulse over the video */}
        {speaking && (
          <div className="pointer-events-none absolute inset-0 ring-4 ring-accent/30" />
        )}
      </div>

      {/* Controls bar */}
      <div className="flex items-center justify-center gap-3 border-t border-white/10 bg-black/50 py-3 backdrop-blur">
        <button
          type="button"
          onClick={onToggleMic}
          className={`grid h-11 w-11 place-items-center rounded-full transition ${
            micOn
              ? "bg-white/10 text-white hover:bg-white/20"
              : "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
          }`}
          title={micOn ? "Mute mic" : "Unmute mic"}
        >
          {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </button>
        <button
          type="button"
          disabled
          className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white"
          title="Camera (always on while live)"
        >
          <Video className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onEndCall}
          className="grid h-11 w-11 place-items-center rounded-full bg-rose-600 text-white hover:bg-rose-700"
          title="End call"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
