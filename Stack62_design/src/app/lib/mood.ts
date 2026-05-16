import type { CoworkerMood } from "../workspace/CoworkerFace";

/**
 * Light-touch mood classifier for the Coworker face.
 *
 * No ML, no API call — just keyword + punctuation cues. The goal is
 * "the face looks like it's reacting to what's being said", not
 * accurate sentiment. We err toward `neutral`; a wrong-but-strong
 * emotion is worse than a placid one.
 *
 * Input is typically the latest assistant message (the thing being
 * spoken aloud) plus optionally the user message so a frustrated
 * user pulls the face toward `anxious`.
 */
export function classifyMood(opts: {
  assistantText?: string;
  userText?: string;
  /** When realtime voice is connected we'd rather show "listening"
   *  than guess, unless the assistant just spoke something cheerful. */
  listening?: boolean;
}): CoworkerMood {
  const a = (opts.assistantText ?? "").toLowerCase();
  const u = (opts.userText ?? "").toLowerCase();

  // User-side cues take priority — frustration in the user pushes
  // the face toward worry regardless of what the assistant said.
  if (u && hasAny(u, USER_FRUSTRATION)) return "anxious";

  // Strong assistant cues. Order matters — first match wins.
  if (a && hasAny(a, EXCITED)) return "excited";
  if (a && hasAny(a, HAPPY)) return "happy";
  if (a && hasAny(a, SAD)) return "sad";
  if (a && hasAny(a, ANXIOUS)) return "anxious";

  // Punctuation hints — bang-ending in the assistant is usually
  // upbeat or excited. Two or more bangs → excited.
  if (a) {
    const bangs = (a.match(/!/g) ?? []).length;
    if (bangs >= 2) return "excited";
    if (bangs === 1) return "happy";
    if (a.endsWith("?") && a.length < 80) return "neutral";
  }

  if (opts.listening) return "listening";
  // Default is `happy` rather than `neutral` — a friendly resting
  // smile reads better than a flat mouth when nothing's happening.
  return "happy";
}

function hasAny(text: string, words: string[]): boolean {
  for (const w of words) {
    // Use word boundaries for short tokens so "ok" doesn't match
    // "stock". For phrases (containing a space) do a substring match.
    if (w.includes(" ")) {
      if (text.includes(w)) return true;
    } else {
      const re = new RegExp(`\\b${w}\\b`);
      if (re.test(text)) return true;
    }
  }
  return false;
}

// Keyword lists. Conservative: only fire when a real signal is
// present. Common neutral verbs ("found", "here") are not on these
// lists so we don't get random happy faces during dry status updates.

const EXCITED = [
  "amazing",
  "awesome",
  "fantastic",
  "incredible",
  "love this",
  "perfect",
  "huge",
  "wonderful",
  "brilliant",
  "let's go",
  "yes!",
];

const HAPPY = [
  "done",
  "completed",
  "shipped",
  "ready",
  "success",
  "saved",
  "good",
  "nice",
  "great",
  "happy",
  "glad",
  "thanks",
  "thank you",
  "you're welcome",
  "no problem",
  "sounds good",
];

const SAD = [
  "sorry",
  "couldn't",
  "couldnt",
  "can't",
  "cant",
  "unable",
  "didn't",
  "didnt",
  "no luck",
  "no results",
  "nothing found",
  "empty",
  "failed",
  "unfortunately",
];

const ANXIOUS = [
  "error",
  "warning",
  "careful",
  "danger",
  "issue",
  "problem",
  "trouble",
  "broke",
  "broken",
  "wrong",
  "unexpected",
  "missing",
  "not found",
  "denied",
  "forbidden",
  "unauthorized",
];

const USER_FRUSTRATION = [
  "wtf",
  "annoying",
  "useless",
  "hate",
  "broken",
  "stupid",
  "frustrated",
  "doesn't work",
  "doesnt work",
  "not working",
  "why won't",
  "why wont",
];
