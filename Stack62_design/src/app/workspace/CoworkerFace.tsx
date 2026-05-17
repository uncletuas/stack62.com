import { useEffect, useRef, useState } from "react";

/**
 * Living Coworker face — modelled after Maui's tattoo in Moana.
 *
 * The face is never frozen. Even at rest it blinks, glances, twitches
 * its eyebrows, and breathes. When it speaks, the mouth cycles through
 * phoneme-like shapes (M / A / E / O / closed) instead of just opening
 * and closing in place. When it's thinking, the eyes drift up-right,
 * one brow lifts, and the mouth purses — no spinners, no dots.
 *
 * Drives:
 *   - mood          → resting expression baseline (eyes, brows, mouth curve)
 *   - speaking      → run the phoneme cycle
 *   - thinking      → pull a pondering pose (look-away + raised brow)
 *   - mouthPulse    → punch the next phoneme harder on a word boundary
 *   - autonomous    → emerald eye glow
 */

export type CoworkerMood =
  | "neutral"
  | "happy"
  | "excited"
  | "sad"
  | "anxious"
  | "listening";

type Phoneme = "closed" | "M" | "A" | "E" | "O" | "I";

const PHONEME_CYCLE: Phoneme[] = ["A", "M", "E", "O", "I", "M", "A", "closed"];

interface BrowState {
  /** Vertical offset in svg units; negative = raised. */
  lift: number;
  /** Inner-end angle in degrees, negative = pulled down (worried). */
  angle: number;
}

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
  const [phonemeIdx, setPhonemeIdx] = useState(0);
  const [punching, setPunching] = useState(false);
  /** Subtle gaze drift, in svg units relative to centred eyes. */
  const [gaze, setGaze] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  /** Brow micro-twitch — distinct from mood baseline. */
  const [browTwitch, setBrowTwitch] = useState<BrowState>({ lift: 0, angle: 0 });
  /** Tiny head bob/tilt in degrees. */
  const [tilt, setTilt] = useState(0);
  /** Subtle breathing scale (0.97..1.03). */
  const [breath, setBreath] = useState(1);

  const phonemeTimer = useRef<number | null>(null);

  // ── Blink loop ────────────────────────────────────────────────────
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
            // Occasional double-blink for life
            if (Math.random() < 0.18) {
              window.setTimeout(() => {
                if (cancelled) return;
                setBlink(true);
                window.setTimeout(() => {
                  if (cancelled) return;
                  setBlink(false);
                  handle = schedule();
                }, 110);
              }, 130);
            } else {
              handle = schedule();
            }
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

  // ── Gaze drift ────────────────────────────────────────────────────
  // Eyes never sit perfectly still — small saccades every 1.5-4s give
  // the face an "I'm looking around, taking things in" quality.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (thinking) {
        // Pondering: look up-right, sustained.
        setGaze({ x: 0.8, y: -0.7 });
      } else {
        // Wander randomly within ±0.8 svg units
        const x = (Math.random() - 0.5) * 1.6;
        const y = (Math.random() - 0.5) * 1.2;
        setGaze({ x, y });
      }
      const next = thinking ? 1800 : 1400 + Math.random() * 2400;
      handle = window.setTimeout(tick, next);
    };
    let handle = window.setTimeout(tick, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [thinking]);

  // ── Brow micro-twitches ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (thinking) {
        // Ponder: one brow up, the other flat. Asymmetry sells it.
        setBrowTwitch({ lift: -1.4, angle: -8 });
      } else if (mood === "anxious") {
        setBrowTwitch({ lift: -0.3, angle: -14 });
      } else if (mood === "excited") {
        setBrowTwitch({ lift: -1.0, angle: 6 });
      } else if (mood === "happy") {
        setBrowTwitch({ lift: -0.4, angle: 4 });
      } else if (mood === "sad") {
        setBrowTwitch({ lift: 0.5, angle: -10 });
      } else {
        // Neutral / listening — occasional small lift to feel alive
        setBrowTwitch({
          lift: Math.random() < 0.4 ? -0.4 : 0,
          angle: (Math.random() - 0.5) * 4,
        });
      }
      const next = thinking ? 1400 : 2200 + Math.random() * 2600;
      handle = window.setTimeout(tick, next);
    };
    let handle = window.setTimeout(tick, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [mood, thinking]);

  // ── Head tilt / bob ───────────────────────────────────────────────
  // Tiny rotation that drifts. Faster + larger when excited; subtle
  // when sad or neutral. Stops while thinking (held pose).
  useEffect(() => {
    if (thinking) {
      setTilt(-3);
      return;
    }
    let cancelled = false;
    const amplitude =
      mood === "excited" ? 6 : mood === "happy" ? 4 : mood === "sad" ? 1.5 : 2.5;
    const period = mood === "excited" ? 800 : 1600;
    let t0 = performance.now();
    const step = (t: number) => {
      if (cancelled) return;
      const elapsed = t - t0;
      const v = Math.sin(elapsed / period) * amplitude;
      setTilt(v);
      raf = requestAnimationFrame(step);
    };
    let raf = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [mood, thinking]);

  // ── Breathing ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const start = performance.now();
    const step = (t: number) => {
      if (cancelled) return;
      const phase = (t - start) / 1800; // ~1.8s per breath
      setBreath(1 + Math.sin(phase * Math.PI * 2) * 0.025);
      raf = requestAnimationFrame(step);
    };
    let raf = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  // ── Phoneme cycle when speaking ───────────────────────────────────
  useEffect(() => {
    if (!speaking) {
      if (phonemeTimer.current) {
        window.clearInterval(phonemeTimer.current);
        phonemeTimer.current = null;
      }
      setPhonemeIdx(0);
      return;
    }
    const tickMs = mood === "excited" ? 95 : mood === "sad" ? 160 : 120;
    phonemeTimer.current = window.setInterval(() => {
      setPhonemeIdx((i) => (i + 1) % PHONEME_CYCLE.length);
    }, tickMs);
    return () => {
      if (phonemeTimer.current) {
        window.clearInterval(phonemeTimer.current);
        phonemeTimer.current = null;
      }
    };
  }, [speaking, mood]);

  // ── Word-boundary punch ───────────────────────────────────────────
  useEffect(() => {
    if (!mouthPulse) return;
    setPunching(true);
    const id = window.setTimeout(() => setPunching(false), 130);
    return () => window.clearTimeout(id);
  }, [mouthPulse]);

  // ── Compute mouth ─────────────────────────────────────────────────
  const phoneme: Phoneme = speaking ? PHONEME_CYCLE[phonemeIdx] : "closed";
  const openness = speaking ? (punching ? 1.0 : 0.85) : 0;
  const mouthPath = thinking
    ? thinkingMouthPath()
    : speaking
      ? phonemePath(phoneme, mood, openness)
      : restingMouthPath(mood);
  const mouthFilled = !thinking && openness > 0.3 && phoneme !== "M" && phoneme !== "closed";

  // ── Eyes ──────────────────────────────────────────────────────────
  const eyeColor = autonomous ? "#a7f3d0" : "white";
  const eyeRyBase =
    thinking
      ? 1.6
      : mood === "happy" || mood === "excited"
        ? 1.5
        : mood === "sad"
          ? 1.3
          : 1.9;
  const eyeRy = blink ? 0.2 : eyeRyBase;
  const eyeY = mood === "sad" ? 13 : mood === "excited" ? 11 : 12;
  const leftEyeCx = 10 + gaze.x;
  const rightEyeCx = 18 + gaze.x;
  const eyesCy = eyeY + gaze.y;

  // ── Brows ─────────────────────────────────────────────────────────
  // Each brow is a short line. Inner end is closer to centre; outer
  // end farther. Angle rotates around the inner end. Sad/anxious has
  // a negative angle (inner up, outer down → worried). Excited/happy
  // has positive angle on the outer (arched).
  const browY = eyeY - 3 + browTwitch.lift;
  const leftBrow = browPath(true, browY, browTwitch.angle, blink ? 0 : 1);
  const rightBrow = browPath(false, browY, browTwitch.angle, blink ? 0 : 1);

  return (
    <svg
      viewBox="0 0 28 28"
      width={size}
      height={size}
      className="select-none"
      aria-hidden
      style={{
        transform: `rotate(${tilt * 0.3}deg) scale(${breath})`,
        transition: "transform 0.25s ease-out",
        transformOrigin: "center",
      }}
    >
      {/* Brows */}
      <path
        d={leftBrow}
        stroke={eyeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
        opacity={blink ? 0.4 : 0.9}
        style={{ transition: "d 0.25s ease, opacity 0.15s ease" }}
      />
      <path
        d={rightBrow}
        stroke={eyeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
        opacity={blink ? 0.4 : 0.9}
        style={{ transition: "d 0.25s ease, opacity 0.15s ease" }}
      />

      {/* Eyes */}
      <ellipse
        cx={leftEyeCx}
        cy={eyesCy}
        rx="1.7"
        ry={eyeRy}
        fill={eyeColor}
        style={{
          transition: "ry 0.1s ease, cx 0.4s ease, cy 0.4s ease, fill 0.3s ease",
        }}
      />
      <ellipse
        cx={rightEyeCx}
        cy={eyesCy}
        rx="1.7"
        ry={eyeRy}
        fill={eyeColor}
        style={{
          transition: "ry 0.1s ease, cx 0.4s ease, cy 0.4s ease, fill 0.3s ease",
        }}
      />

      {/* Autonomous-mode eye glow */}
      {autonomous && !blink && (
        <>
          <circle cx={leftEyeCx} cy={eyesCy} r="2.6" fill="#10b981" opacity="0.25">
            <animate
              attributeName="opacity"
              values="0.1;0.35;0.1"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx={rightEyeCx} cy={eyesCy} r="2.6" fill="#10b981" opacity="0.25">
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
      <path
        d={mouthPath}
        stroke="white"
        strokeWidth={thinking ? 1.5 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={mouthFilled ? "rgba(255,255,255,0.85)" : "none"}
        style={{
          transition: "d 0.09s ease-out, fill 0.15s ease-out",
        }}
      />
    </svg>
  );
}

/* ── Brow geometry ─────────────────────────────────────────────────── */
function browPath(
  left: boolean,
  y: number,
  angle: number,
  opacity: number,
): string {
  if (opacity === 0) return "M 0 0"; // hidden on blink
  // Inner end is closer to centre x=14, outer end is at x≈7 or x≈21.
  const innerX = left ? 12 : 16;
  const outerX = left ? 8 : 20;
  // Angle rotates the outer end relative to the inner end.
  const len = Math.abs(outerX - innerX);
  const rad = (angle * Math.PI) / 180;
  const dy = Math.sin(rad) * len * (left ? -1 : 1);
  const outerY = y + dy;
  return `M ${innerX} ${y} L ${outerX} ${outerY}`;
}

/* ── Mouth path generation ─────────────────────────────────────────── */

function restingMouthPath(mood: CoworkerMood): string {
  switch (mood) {
    case "happy":
      return `M 7 18 Q 14 22 21 18`;
    case "excited":
      return `M 6 17.5 Q 14 22.5 22 17.5`;
    case "sad":
      return `M 7 20.5 Q 14 18 21 20.5`;
    case "anxious":
      return `M 7 19 Q 10 17.6 13 19 Q 16 20.5 19 19 Q 20.6 18.4 21 19`;
    case "listening":
      return `M 8 18.5 Q 14 20 20 18.5`;
    case "neutral":
    default:
      return `M 9 19 Q 14 20 19 19`;
  }
}

function thinkingMouthPath(): string {
  // Pursed, slightly off-centre, faint pinch — "hmm" look.
  return `M 11 19.5 Q 13.5 18.6 16 19.5`;
}

/**
 * Phoneme shapes — each tries to feel different from the next so the
 * mouth visibly changes shape rather than just pulsing wider/narrower.
 *   - M / closed   : nearly closed lips, gentle curve
 *   - A            : wide-open oval (talking loudly)
 *   - E            : wide and shallow (smile-shaped)
 *   - O            : round, small
 *   - I            : narrow horizontal slit
 *
 * Mood tints the shape: happy/excited keep upturned corners even when
 * open; sad keeps corners pulled down; anxious adds asymmetric wobble.
 */
function phonemePath(
  p: Phoneme,
  mood: CoworkerMood,
  openness: number,
): string {
  const cornerLift =
    mood === "happy" || mood === "excited"
      ? -0.6
      : mood === "sad"
        ? 0.7
        : 0;
  const t = Math.max(0, Math.min(1, openness));

  switch (p) {
    case "closed":
    case "M": {
      const cy = 19 + cornerLift * 0.3;
      const dip = 19.5 + cornerLift * 0.3;
      return `M 9 ${cy} Q 14 ${dip} 19 ${cy}`;
    }
    case "A": {
      // Wide open oval
      const rx = 4.2 + t * 0.4;
      const ry = 2.2 + t * 0.6;
      return ellipsePath(14, 19.5 + cornerLift * 0.2, rx, ry);
    }
    case "E": {
      // Wide and shallow smile-like
      const rx = 5 + t * 0.4;
      const ry = 1.0 + t * 0.4;
      const cy = 19.3 + cornerLift * 0.3;
      return ellipsePath(14, cy, rx, ry);
    }
    case "O": {
      // Small round
      const r = 1.7 + t * 0.6;
      return ellipsePath(14, 19.5, r, r);
    }
    case "I": {
      // Narrow horizontal slit with a fill
      const rx = 4.0;
      const ry = 0.7 + t * 0.3;
      return ellipsePath(14, 19.4 + cornerLift * 0.3, rx, ry);
    }
    default:
      return restingMouthPath(mood);
  }
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
}
