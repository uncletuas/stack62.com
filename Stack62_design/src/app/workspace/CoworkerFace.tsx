import { useEffect, useState } from "react";

/**
 * Animated Coworker face — replaces the static Bot icon.
 *
 * Mouth opens/closes at a quick rhythm while `speaking` is true,
 * giving the illusion of the bot vocalising. Eyes blink on a longer
 * cadence so the face never looks completely still even when idle.
 *
 * This is the foundation for the "talking, lively robot face" the
 * user is asking for. When we add live audio + multimodal vision,
 * the same component will receive a `level` prop and modulate mouth
 * height by audio amplitude.
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
  // Mouth animation: when speaking, the mouth height oscillates so it
  // visually "talks". Pure CSS animation; no requestAnimationFrame.
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      setBlink(true);
      window.setTimeout(() => setBlink(false), 140);
    }, 3800);
    return () => window.clearInterval(id);
  }, []);

  // Mouth curve y2 — bigger value = more open.
  const mouthCurve =
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
      {/* Head */}
      <circle cx="14" cy="14" r="13" fill="currentColor" opacity="0.0" />
      {/* Eyes */}
      <g>
        <ellipse
          cx="10"
          cy="12"
          rx="1.6"
          ry={blink ? "0.2" : "1.8"}
          fill="white"
          style={{ transition: "ry 0.12s ease" }}
        />
        <ellipse
          cx="18"
          cy="12"
          rx="1.6"
          ry={blink ? "0.2" : "1.8"}
          fill="white"
          style={{ transition: "ry 0.12s ease" }}
        />
      </g>
      {/* Mouth — speaking mode pulses an open mouth */}
      {speaking ? (
        <ellipse
          cx="14"
          cy="19"
          rx="3.4"
          ry="2.6"
          fill="white"
          style={{
            animation:
              "stack62-mouth-talk 0.32s ease-in-out infinite alternate",
            transformOrigin: "14px 19px",
          }}
        />
      ) : thinking ? (
        <g>
          <circle cx="11" cy="19" r="0.9" fill="white">
            <animate
              attributeName="opacity"
              values="0.3;1;0.3"
              dur="1.2s"
              repeatCount="indefinite"
              begin="0s"
            />
          </circle>
          <circle cx="14" cy="19" r="0.9" fill="white">
            <animate
              attributeName="opacity"
              values="0.3;1;0.3"
              dur="1.2s"
              repeatCount="indefinite"
              begin="0.2s"
            />
          </circle>
          <circle cx="17" cy="19" r="0.9" fill="white">
            <animate
              attributeName="opacity"
              values="0.3;1;0.3"
              dur="1.2s"
              repeatCount="indefinite"
              begin="0.4s"
            />
          </circle>
        </g>
      ) : (
        <path
          d={mouthCurve}
          stroke="white"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
          style={{ transition: "d 0.2s ease" }}
        />
      )}

      <style>
        {`@keyframes stack62-mouth-talk {
            0%   { ry: 1; }
            100% { ry: 2.8; }
          }
          @keyframes stack62-mouth-talk-fallback {
            0%   { transform: scaleY(0.4); }
            100% { transform: scaleY(1); }
          }`}
      </style>
    </svg>
  );
}
