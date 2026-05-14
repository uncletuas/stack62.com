import { useEffect, useState } from "react";

/**
 * Animated Coworker face — replaces the static Bot icon.
 *
 * Mouth open/close while `speaking` is driven by React state instead
 * of CSS keyframes on SVG `ry` (which has spotty browser support).
 * The mouth toggles between "closed" and "open" every ~140ms, giving
 * a clear talking effect even on Firefox.
 *
 * Eyes blink on a longer cadence so the face never looks completely
 * still. `thinking` swaps the mouth for three pulsing dots.
 *
 * This is the foundation for the "talking, lively robot face" the
 * user is asking for. When we wire real audio amplitude in (Web
 * Audio API on the speech synth output), the same component will
 * receive a `level` prop and modulate the mouth height by volume.
 */
export function CoworkerFace({
  speaking = false,
  thinking = false,
  size = 28,
  mood = "neutral",
}: {
  speaking?: boolean;
  thinking?: boolean;
  size?: number;
  /** "neutral" | "happy" | "listening" — different mouth curve. */
  mood?: "neutral" | "happy" | "listening";
}) {
  const [blink, setBlink] = useState(false);
  // 0 = closed (line), 1 = small open, 2 = wide open. Cycles while speaking.
  const [mouthFrame, setMouthFrame] = useState(0);

  // Blink loop
  useEffect(() => {
    const id = window.setInterval(() => {
      setBlink(true);
      window.setTimeout(() => setBlink(false), 140);
    }, 3800);
    return () => window.clearInterval(id);
  }, []);

  // Mouth talk loop — React-state driven so we don't rely on CSS attr animation.
  useEffect(() => {
    if (!speaking) {
      setMouthFrame(0);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setMouthFrame((f) => {
        // Cycle 0 → 2 → 1 → 2 → 0 → 1 … irregular enough to feel alive
        const next = (f + 1) % 3;
        return next;
      });
    };
    const id = window.setInterval(tick, 140);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [speaking]);

  // Resting (not speaking, not thinking) curve depends on mood
  const restingCurve =
    mood === "happy"
      ? "M 8 18 Q 14 22 20 18"
      : mood === "listening"
        ? "M 8 18 Q 14 20 20 18"
        : "M 8 18 Q 14 19 20 18";

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
        rx="1.6"
        ry={blink ? 0.2 : 1.8}
        fill="white"
        style={{ transition: "ry 0.1s ease" }}
      />
      <ellipse
        cx="18"
        cy="12"
        rx="1.6"
        ry={blink ? 0.2 : 1.8}
        fill="white"
        style={{ transition: "ry 0.1s ease" }}
      />

      {/* Mouth */}
      {thinking ? (
        <g>
          {[11, 14, 17].map((cx, i) => (
            <circle key={cx} cx={cx} cy="19" r="0.9" fill="white">
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
          cy="19"
          rx={mouthFrame === 0 ? 2.4 : mouthFrame === 1 ? 3.2 : 4.0}
          ry={mouthFrame === 0 ? 0.6 : mouthFrame === 1 ? 1.6 : 2.6}
          fill="white"
          style={{ transition: "rx 0.08s ease, ry 0.08s ease" }}
        />
      ) : (
        <path
          d={restingCurve}
          stroke="white"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
          style={{ transition: "d 0.2s ease" }}
        />
      )}
    </svg>
  );
}
