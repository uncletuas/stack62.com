import { useEffect, useState } from "react";

/**
 * Animated Coworker face — replaces the static Bot icon.
 *
 * Mouth motion:
 *   - When `speaking` is true: oscillates open/closed every ~110 ms
 *     to mimic vocalisation. Eight frames cycle with random
 *     amplitude jitter so it doesn't look mechanical. The parent
 *     drives `speaking` from the SpeechSynthesisUtterance lifecycle
 *     (onstart → true, onend → false). If the parent also forwards
 *     `mouthPulse` (incremented on each `boundary` event from the
 *     utterance), we re-trigger an extra-wide frame on that pulse
 *     so the mouth visibly punches on each spoken word.
 *   - When `thinking` is true: three pulsing dots, capped to that
 *     state only — used while we're waiting on the LLM, never while
 *     audio is actually playing.
 *   - Otherwise: a resting curve based on `mood`.
 *
 * Eyes blink on a 4 s cycle so the face stays alive even at rest.
 *
 * When the parent supplies an `autonomous` flag, the eyes briefly
 * "glow" green every few seconds and the face background style is
 * controlled by the parent (we just colour the eyes).
 */
export function CoworkerFace({
  speaking = false,
  thinking = false,
  size = 28,
  mood = "neutral",
  mouthPulse = 0,
  autonomous = false,
}: {
  speaking?: boolean;
  thinking?: boolean;
  size?: number;
  mood?: "neutral" | "happy" | "listening";
  /** Increment to punch the mouth open (driven by speech boundary events). */
  mouthPulse?: number;
  /** When true, the eyes get an emerald tint to signal autonomous mode. */
  autonomous?: boolean;
}) {
  const [blink, setBlink] = useState(false);
  // 0 = closed (thin line), 1 = small open, 2 = medium, 3 = wide.
  const [mouthFrame, setMouthFrame] = useState(0);
  // Bigger one-shot opening when a boundary pulse arrives.
  const [punching, setPunching] = useState(false);

  // Blink loop — slightly randomized so it doesn't look like a metronome.
  useEffect(() => {
    let cancelled = false;
    const schedule = (): number =>
      window.setTimeout(
        () => {
          if (cancelled) return;
          setBlink(true);
          window.setTimeout(() => {
            if (cancelled) return;
            setBlink(false);
            handle = schedule();
          }, 130);
        },
        2800 + Math.random() * 2200,
      );
    let handle = schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, []);

  // Mouth talk loop — only while speaking. Cycle through 4 frames with
  // slight jitter so the mouth doesn't open the same amount every tick.
  useEffect(() => {
    if (!speaking) {
      setMouthFrame(0);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      // Random walk through {1, 2, 3} so we always open the mouth a
      // visible amount but the pattern feels organic.
      setMouthFrame(1 + Math.floor(Math.random() * 3));
    };
    tick();
    const id = window.setInterval(tick, 110);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [speaking]);

  // Word-boundary punch: when the parent increments mouthPulse, do a
  // brief over-open to visibly mark the word.
  useEffect(() => {
    if (!mouthPulse) return;
    setPunching(true);
    const id = window.setTimeout(() => setPunching(false), 100);
    return () => window.clearTimeout(id);
  }, [mouthPulse]);

  const restingCurve =
    mood === "happy"
      ? "M 7 18 Q 14 22 21 18"
      : mood === "listening"
        ? "M 7 18 Q 14 20 21 18"
        : "M 7 18 Q 14 19 21 18";

  // Frame → (rx, ry) sizing. Wider + taller than the prior version
  // so the mouth motion is obvious. Punch state opens it even more.
  const mouthRx = punching ? 5.0 : mouthFrame === 1 ? 3.0 : mouthFrame === 2 ? 3.8 : 4.4;
  const mouthRy = punching ? 3.6 : mouthFrame === 1 ? 1.4 : mouthFrame === 2 ? 2.2 : 3.0;

  const eyeColor = autonomous ? "#a7f3d0" : "white"; // emerald-200 vs white
  const eyeRy = blink ? 0.2 : 2.0;

  return (
    <svg
      viewBox="0 0 28 28"
      width={size}
      height={size}
      className="select-none"
      aria-hidden
    >
      {/* Eyes */}
      <ellipse
        cx="10"
        cy="12"
        rx="1.7"
        ry={eyeRy}
        fill={eyeColor}
        style={{ transition: "ry 0.1s ease, fill 0.3s ease" }}
      />
      <ellipse
        cx="18"
        cy="12"
        rx="1.7"
        ry={eyeRy}
        fill={eyeColor}
        style={{ transition: "ry 0.1s ease, fill 0.3s ease" }}
      />

      {/* Autonomous-mode eye glow */}
      {autonomous && !blink && (
        <>
          <circle cx="10" cy="12" r="2.6" fill="#10b981" opacity="0.25">
            <animate
              attributeName="opacity"
              values="0.1;0.35;0.1"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="18" cy="12" r="2.6" fill="#10b981" opacity="0.25">
            <animate
              attributeName="opacity"
              values="0.35;0.1;0.35"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </circle>
        </>
      )}

      {/* Mouth */}
      {thinking ? (
        <g>
          {[10.5, 14, 17.5].map((cx, i) => (
            <circle key={cx} cx={cx} cy="19.5" r="0.9" fill="white">
              <animate
                attributeName="opacity"
                values="0.3;1;0.3"
                dur="1.2s"
                repeatCount="indefinite"
                begin={`${i * 0.2}s`}
              />
            </circle>
          ))}
        </g>
      ) : speaking ? (
        <ellipse
          cx="14"
          cy="19.5"
          rx={mouthRx}
          ry={mouthRy}
          fill="white"
          style={{ transition: "rx 0.08s ease-out, ry 0.08s ease-out" }}
        />
      ) : (
        <path
          d={restingCurve}
          stroke="white"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          style={{ transition: "d 0.2s ease" }}
        />
      )}
    </svg>
  );
}
