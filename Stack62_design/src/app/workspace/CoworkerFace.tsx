import { useEffect, useState } from "react";

/**
 * Animated Coworker face with real emotion.
 *
 * Mouth motion follows a `mood` prop that drives both the *resting*
 * shape and the *animation curve* when speaking:
 *
 *   - neutral   — slight curve, no expression
 *   - happy     — upturned smile, widens sideways during speech
 *   - excited   — open-grin smile, bouncier vertical motion
 *   - sad       — gentle frown, mouth opens narrowly
 *   - anxious   — wavy line, asymmetric jitter, smaller opening
 *   - listening — soft smile, mouth doesn't open (we're listening, not talking)
 *
 * When `speaking` is true we interpolate between the resting shape
 * and the mood's "open" pose ~10 times/second. `mouthPulse`
 * increments on word/transcript boundaries — each pulse punches a
 * wider opening for ~100ms so the face actually punches along with
 * words, the way a human mouth does.
 *
 * Eyes track mood too: happy/excited squint slightly, sad droops,
 * anxious blinks faster, listening makes the pupils dilate.
 */

export type CoworkerMood =
  | "neutral"
  | "happy"
  | "excited"
  | "sad"
  | "anxious"
  | "listening";

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
  mood?: CoworkerMood;
  mouthPulse?: number;
  autonomous?: boolean;
}) {
  const [blink, setBlink] = useState(false);
  // Speak frame oscillates 0..1; we drive the mouth opening from it.
  const [speakPhase, setSpeakPhase] = useState(0);
  const [punching, setPunching] = useState(false);

  // ── Blink loop ─────────────────────────────────────────────────
  // Anxious blinks faster, sad blinks slower, otherwise normal.
  useEffect(() => {
    let cancelled = false;
    const blinkBase =
      mood === "anxious" ? 1700 : mood === "sad" ? 3800 : 2800;
    const schedule = (): number =>
      window.setTimeout(
        () => {
          if (cancelled) return;
          setBlink(true);
          window.setTimeout(() => {
            if (cancelled) return;
            setBlink(false);
            handle = schedule();
          }, mood === "anxious" ? 80 : 130);
        },
        blinkBase + Math.random() * 1800,
      );
    let handle = schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [mood]);

  // ── Speak loop ─────────────────────────────────────────────────
  // Phase oscillates so the mouth opens and closes smoothly. Excited
  // is faster + larger amplitude, sad is slower + narrower.
  useEffect(() => {
    if (!speaking) {
      setSpeakPhase(0);
      return;
    }
    let cancelled = false;
    const tickMs =
      mood === "excited" ? 70 : mood === "sad" ? 140 : 100;
    const tick = () => {
      if (cancelled) return;
      // Random-ish phase between 0.3..1.0 so the mouth always moves
      // visibly but doesn't look mechanical.
      setSpeakPhase(0.3 + Math.random() * 0.7);
    };
    tick();
    const id = window.setInterval(tick, tickMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [speaking, mood]);

  // ── Word-boundary punch ────────────────────────────────────────
  useEffect(() => {
    if (!mouthPulse) return;
    setPunching(true);
    const id = window.setTimeout(() => setPunching(false), 110);
    return () => window.clearTimeout(id);
  }, [mouthPulse]);

  // ── Mouth path generation ──────────────────────────────────────
  // SVG path is generated per-frame so we can morph smoothly between
  // resting and open shapes for each mood. Coordinate system is
  // 28×28, the mouth lives around y=18..22 and x=6..22 (centre 14).
  const openness = speaking ? (punching ? 1.0 : speakPhase) : 0;
  const mouthPath = getMouthPath(mood, openness);

  // ── Eyes ───────────────────────────────────────────────────────
  const eyeColor = autonomous ? "#a7f3d0" : "white";
  const eyeRyBase =
    mood === "happy" || mood === "excited"
      ? 1.6 // slight squint when smiling
      : mood === "sad"
        ? 1.4 // droopy
        : 2.0;
  const eyeRy = blink ? 0.2 : eyeRyBase;
  // Sad eyes are slightly lower on the face; excited eyes are wide.
  const eyeY = mood === "sad" ? 13 : mood === "excited" ? 11 : 12;
  // Anxious eyebrows: subtle worried angle baked into a separate path.
  const showAnxiousBrows = mood === "anxious";

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
        cy={eyeY}
        rx="1.7"
        ry={eyeRy}
        fill={eyeColor}
        style={{ transition: "ry 0.1s ease, cy 0.3s ease, fill 0.3s ease" }}
      />
      <ellipse
        cx="18"
        cy={eyeY}
        rx="1.7"
        ry={eyeRy}
        fill={eyeColor}
        style={{ transition: "ry 0.1s ease, cy 0.3s ease, fill 0.3s ease" }}
      />

      {/* Anxious brows — short slanted lines above each eye */}
      {showAnxiousBrows && !blink && (
        <>
          <path
            d="M 8 9 L 12 8"
            stroke={eyeColor}
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.75"
          />
          <path
            d="M 16 8 L 20 9"
            stroke={eyeColor}
            strokeWidth="1"
            strokeLinecap="round"
            opacity="0.75"
          />
        </>
      )}

      {/* Autonomous-mode eye glow */}
      {autonomous && !blink && (
        <>
          <circle cx="10" cy={eyeY} r="2.6" fill="#10b981" opacity="0.25">
            <animate
              attributeName="opacity"
              values="0.1;0.35;0.1"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="18" cy={eyeY} r="2.6" fill="#10b981" opacity="0.25">
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
      ) : (
        <path
          d={mouthPath}
          stroke="white"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={openness > 0.4 ? "rgba(255,255,255,0.85)" : "none"}
          style={{
            transition:
              "d 0.12s ease-out, fill 0.2s ease-out, stroke-width 0.2s ease-out",
          }}
        />
      )}
    </svg>
  );
}

/**
 * Build an SVG path for the mouth at a given mood + openness.
 * Openness is 0 (resting) to 1 (max open) and is the lerp factor
 * between the rest and open shapes for that mood.
 *
 * Coordinate notes: the face is 28×28. The mouth's natural centre
 * is (14, 19.5). x ∈ [6, 22] gives a wide-enough corner-to-corner.
 */
function getMouthPath(mood: CoworkerMood, openness: number): string {
  const t = Math.max(0, Math.min(1, openness));

  switch (mood) {
    case "happy": {
      // Resting: upturned curve. Open: ellipse-like with cheeks
      // pulled wide. Width grows with openness — that's the "smile
      // expanding sideways" the user asked for.
      const left = 6 - t * 0.5; // pulls corner out a touch
      const right = 22 + t * 0.5;
      const cyDip = 21 + t * 1.5; // mouth bottom drops as it opens
      if (t < 0.05) {
        // Pure resting smile — single curve, no fill.
        return `M ${left} 18 Q 14 ${cyDip} ${right} 18`;
      }
      // Open smile: top is the smile arc, bottom is a deeper arc.
      return `M ${left} 18 Q 14 ${cyDip} ${right} 18 Q 14 ${cyDip + 1 + t * 1.2} ${left} 18 Z`;
    }
    case "excited": {
      // Big grin: wider than happy, bounces vertically harder.
      const left = 5.5 - t * 0.6;
      const right = 22.5 + t * 0.6;
      const dip = 21.5 + t * 2.5;
      if (t < 0.05) {
        return `M ${left} 17.8 Q 14 ${dip} ${right} 17.8`;
      }
      return `M ${left} 17.8 Q 14 ${dip} ${right} 17.8 Q 14 ${dip + 1.5 + t * 1.6} ${left} 17.8 Z`;
    }
    case "sad": {
      // Frown: corners pulled down. Opens narrowly — sad mouths
      // barely move when talking.
      const cornerY = 20 + t * 0.3;
      const peakY = 17.5 - t * 0.2; // tiny upward arc at the centre
      const openDip = 19 + t * 1.0;
      if (t < 0.05) {
        return `M 7 ${cornerY} Q 14 ${peakY} 21 ${cornerY}`;
      }
      return `M 7 ${cornerY} Q 14 ${peakY} 21 ${cornerY} Q 14 ${openDip + t * 0.8} 7 ${cornerY} Z`;
    }
    case "anxious": {
      // Wavy worried line that opens asymmetrically.
      const offset = t * 1.0;
      // Two-bump wavy mouth — left up, right down — gives that
      // unsettled "I'm trying to smile but I'm not okay" look.
      if (t < 0.05) {
        return `M 7 19 Q 10 17.5 13 19 Q 16 20.5 19 19 Q 20.5 18.5 21 19`;
      }
      return `M 7 19 Q 10 ${17.5 - offset} 13 19 Q 16 ${20.5 + offset} 19 19 Q 20.5 ${18.5 - offset * 0.4} 21 19 Q 14 ${20 + offset} 7 19 Z`;
    }
    case "listening": {
      // Soft smile, never opens — the Coworker is listening, not
      // talking. We ignore openness here.
      return `M 7 18.5 Q 14 20 21 18.5`;
    }
    case "neutral":
    default: {
      // Slight, almost-flat curve. Opens to a small "O".
      const dip = 19 + t * 1.0;
      if (t < 0.05) {
        return `M 8 19 Q 14 ${dip} 20 19`;
      }
      const rx = 3 + t * 1.6;
      const ry = 0.8 + t * 1.8;
      return ellipsePath(14, 19.5, rx, ry);
    }
  }
}

/** Approximate an ellipse as a closed SVG path so we can use `d`
 *  transitions cleanly. */
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
}
