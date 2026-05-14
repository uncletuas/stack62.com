import { useEffect, useRef, useState } from "react";
import { CoworkerFace } from "./CoworkerFace";
import { Mic, MicOff, Video, VideoOff, X } from "lucide-react";

/**
 * Full-screen call surface for Live mode. Mimics a Zoom/Meet
 * one-on-one: user's webcam fills the canvas, Coworker avatar is
 * a floating pill in the corner.
 *
 * The component itself doesn't run the audio loop or the snapshot
 * pipeline — those live in CoworkerRail. Here we just present:
 *   - the local video stream as a <video> tag
 *   - the animated Coworker face (mouth moves when speaking, eyes blink)
 *   - controls: mute mic, stop camera, end call
 *   - status pill (Listening / Speaking / Thinking)
 *   - call timer
 *
 * Honest about scope: this is *not* a true real-time multimodal
 * stream like Gemini Live or OpenAI Advanced Voice. OpenRouter
 * doesn't proxy those realtime APIs today. What we deliver here is:
 *   - real-time audio in (Web Speech Recognition)
 *   - real-time audio out (Speech Synthesis)
 *   - periodic video frame capture (every 6s) sent as image
 *     attachments to the next message
 * It feels like a call. To upgrade to true frame-by-frame realtime
 * we'd need an OpenAI Realtime API key (separate from OpenRouter).
 */
export function CoworkerCallView({
  stream,
  speaking,
  listening,
  thinking,
  micOn,
  onToggleMic,
  onEndCall,
}: {
  stream: MediaStream | null;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  micOn: boolean;
  onToggleMic: () => void;
  onEndCall: () => void;
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

  // Call timer — ticks every second while the surface is mounted.
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
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-950 text-white">
      {/* Top: status + close */}
      <div className="flex items-center justify-between border-b border-white/10 bg-slate-900/60 px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-300">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
            LIVE
          </span>
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
        {cameraOff ? (
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
        <div className="absolute bottom-5 right-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/85 px-4 py-3 shadow-2xl backdrop-blur">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center rounded-full"
            style={{ backgroundColor: "var(--app-accent)" }}
          >
            <CoworkerFace
              size={44}
              speaking={speaking}
              thinking={thinking}
              mood={listening ? "listening" : "happy"}
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
      <div className="flex items-center justify-center gap-3 border-t border-white/10 bg-slate-900/60 py-3">
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
