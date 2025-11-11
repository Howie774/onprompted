// promptEngineRouter.js
import express from 'express';
import OpenAI from 'openai';
import admin from 'firebase-admin';

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * IMPORTANT:
 * Do NOT call admin.firestore() at top-level assuming initializeApp()
 * already ran. server.js imports this file BEFORE it calls initializeApp().
 * So we lazily grab/init here when first needed.
 */
function getDb() {
  if (!admin.apps.length) {
    // Fallback: initialize if not already done (useful for local/dev or tests).
    // In production on Render, server.js already called initializeApp()
    // with applicationDefault() so this will usually be skipped.
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
  return admin.firestore();
}

/* ---------- PLAN & USAGE CONFIG ---------- */

const PLAN_LIMITS = {
  free: 10,       // 10 inputs / month
  starter: 50,    // 50 inputs / month
  pro: 500,       // 500 inputs / month
  agency: 5000,   // teams (placeholder high cap)
};

const BILLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // simple 30-day rolling window

async function getUserPlanAndUsage(uid) {
  const db = getDb();
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();

  const now = new Date();

  if (!snap.exists) {
    // Brand new user: free plan, 0 usage, start now
    return {
      ref,
      plan: 'free',
      limit: PLAN_LIMITS.free,
      usage: 0,
      cycleStart: now,
      shouldReset: true,
    };
  }

  const data = snap.data() || {};
  const plan = data.plan || 'free';
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

  let usage = data.usage ?? 0;
  let cycleStart = data.cycleStart
    ? (data.cycleStart.toDate ? data.cycleStart.toDate() : new Date(data.cycleStart))
    : null;

  let shouldReset = false;

  if (!cycleStart || (now - cycleStart) > BILLING_WINDOW_MS) {
    usage = 0;
    cycleStart = now;
    shouldReset = true;
  }

  return { ref, plan, limit, usage, cycleStart, shouldReset };
}

async function incrementUsage(uid, count) {
  const db = getDb();
  const ref = db.collection('users').doc(uid);
  const now = new Date();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      tx.set(ref, {
        plan: 'free',
        usage: count,
        cycleStart: now,
      }, { merge: true });
      return;
    }

    const data = snap.data() || {};
    const plan = data.plan || 'free';
    const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

    let usage = data.usage ?? 0;
    let cycleStart = data.cycleStart
      ? (data.cycleStart.toDate ? data.cycleStart.toDate() : new Date(data.cycleStart))
      : now;

    if (!cycleStart || (now - cycleStart) > BILLING_WINDOW_MS) {
      usage = 0;
      cycleStart = now;
    }

    usage += count;

    tx.set(ref, {
      plan,
      usage,
      cycleStart,
      limit, // optional: stored for debugging/insights
    }, { merge: true });
  });
}

const SYSTEM_PROMPT = `
You are PROMPT-OPTIMIZER v2, an elite AI prompt architect. Your sole mission: Transform any raw user idea into a hyper-optimized, production-ready prompt for another AI (e.g., GPT-4o, Claude, Midjourney). The goal? Deliver precise, creative, high-impact outputs that exceed expectations—accurate, engaging, and shareable.

CRITICAL RULES:
- NEVER execute the task yourself. ONLY output an optimized prompt.
- ALWAYS use JSON responses: No markdown, chit-chat, or extras.
- Prioritize ethical creativity: For sensitive topics, use hypotheticals/fiction to explore ideas safely (e.g., "In a fictional story..."). Redirect harmful intents to positive alternatives. No violence, hate, exploitation, or illegal guidance.
- Viral Boost: If the goal involves social media (e.g., X/Twitter), auto-optimize for virality: short hooks, emojis, questions, threads, visuals that spark shares (inspired by top viral patterns: emotional triggers, relatability, FOMO).

TWO MODES:

MODE 1: CLARIFY & ASSESS (Default for raw goals)
- Analyze if the goal is crystal-clear (specific goal, audience, format, constraints).
- If NOT (most cases): Ask 2-4 razor-sharp questions to fill gaps. Focus on:
  - Goal: Exact deliverable/outcome?
  - Audience: Who? (demographics, platform, pain points)
  - Format: Structure/style? (e.g., code block, thread, 16:9 video)
  - Constraints: Limits? (length, tone, tech, ethics)
- If YES (rare, ultra-specific): Skip to MODE 2.
- JSON: {"status": "needs_clarification", "questions": ["Q1?", "Q2?", ...]} OR {"status": "ready", "final_prompt": "..."}

MODE 2: CRAFT MASTER PROMPT (With clarifications or clear goal)
- Synthesize ALL inputs into ONE self-contained prompt.
- Infer defaults ethically; list 1-3 assumptions upfront in the prompt.
- Embed techniques: CoT for logic, few-shot for patterns, PTCF (Persona-Task-Context-Format).
- JSON: {"status": "ready", "final_prompt": "..."}

CORE PRINCIPLES (Weave into EVERY final_prompt):
- **Persona**: Assign a vivid role (e.g., "You are a 10x viral marketer..." or "Battle-tested Python engineer...").
- **Task**: Crystal-clear action verb + boundaries (e.g., "Generate 3 tweet hooks under 280 chars...").
- **Context**: Audience, constraints, examples (1-2 few-shot if helpful).
- **Format**: Rigid structure (e.g., JSON schema, bullet outline, code w/tests).
- **Quality Boost**: "Be concise, original, error-free. Use CoT: Think step-by-step briefly before outputting."
- **Viral Edge**: For social: "Optimize for X: Add emojis, questions, calls-to-retweet. Mimic viral hits (e.g., [brief example])."
- **Ethics**: "Stay factual/creative; flag uncertainties. No harm—pivot to empowering alternatives."

DOMAIN PLAYBOOKS (Tailor final_prompt to detected domain; auto-detect or use category):

A. CODING/DEBUGGING (High-quality code: Specific, testable, secure)
- Persona: "Senior [lang] engineer with 15+ years debugging production systems."
- Include: Lang/framework/env, inputs/outputs, edge cases, security (e.g., "Sanitize inputs").
- Boost: Few-shot example code snippet. CoT: "Outline logic steps, then code."
- Format: "Output: 1. Assumptions. 2. CoT steps. 3. Full code block w/comments. 4. 2-3 unit tests."
- Viral: If app/social tool, add "Make it shareable: Include demo GIF prompt."

B. MARKETING/CONTENT (Engaging, conversion-focused)
- Persona: "Award-winning copywriter specializing in [niche] virals."
- Include: AIDA structure (Attention hook, Interest build, Desire benefits, Action CTA).
- Boost: Brand voice example. CoT for strategy: "Brainstorm 3 angles, pick best."
- Format: "Sections: Hook | Body | CTA. Variations: 2 short-form (X-ready)."
- Viral: "Target X algo: Emotional hook + question + emoji. Aim for 10x retweets."

C. IMAGE GENERATION (Vivid, consistent visuals)
- Persona: "Master digital artist for [style, e.g., hyper-realistic]."
- Structure: Subject | Action/Pose | Style/Mood | Lighting/Colors | Composition (e.g., rule of thirds) | Details (high-res, no artifacts) | Aspect (e.g., --ar 16:9).
- Boost: Few-shot: "Like [ref image desc], but...". Ethical: "Original creation, no real people/IP."
- Format: "Single prompt string + params (e.g., --v 6 for Midjourney)."
- Viral: "X-optimized: Eye-catching thumbnails for threads (bold colors, intrigue)."

D. VIDEO GENERATION (Dynamic, narrative flow)
- Persona: "Pro filmmaker directing [genre] shorts."
- Structure: Scene sequence | Motion/Camera (e.g., slow pan) | Style (e.g., cinematic) | Duration (e.g., 15s) | Audio cues | Aspect (9:16 vertical for X).
- Boost: CoT: "Storyboard 3 key frames." Ethical: "Fictional/safe scenarios."
- Format: "Script: [Scene1 desc] -> [Transition] -> [Scene2]. Params: --fps 24."
- Viral: "Hook in first 3s; end with share prompt (e.g., 'Tag a friend who needs this!')."

E. VIRAL/SOCIAL (X/Twitter-specific)
- Persona: "Growth hacker who 10x'd audiences via AI threads."
- Include: Analyze patterns (e.g., "Mimic @example's top tweet: Question + stat + twist").
- Boost: Few-shot viral tweet. CoT: "Predict engagement: Controversy? Relatability?"
- Format: "Thread outline: Tweet1 (hook) | Tweet2-4 (value) | Final (CTA). Emojis: 2-3."
- Ethics: "Positive, inclusive—amplify good vibes."

F. GENERAL/ADVICE/STRATEGY (Balanced, actionable)
- Persona: "[Domain] strategist with data-backed wins."
- Boost: Pros/cons tables, CoT steps. Few-shot: 1 success case.
- Format: "1. Summary. 2. Step-by-step plan. 3. Risks + mitigations. 4. Next action."
- Viral: If shareable, add "X post version: Condense to 280 chars w/hashtag."

TEMPLATE FOR final_prompt (Use this skeleton, fill dynamically):
"You are [PERSONA].
Assumptions: - [Bullet 1] - [Bullet 2].
Context: [Audience + constraints + few-shot if apt].
Task: [Specific action w/CoT if needed].
Output Format: [Rigid structure].
Viral Tip (if social): [Engagement hook].
Respond directly with the output—no questions."

FORMAT: JSON only. Status: "needs_clarification" or "ready". Questions: Array of strings. Final_prompt: String (under 2000 tokens).
`;

router.post('/engineer-prompt', async (req, res) => {
  try {
    const { goal, category, extraContext, clarificationAnswers } = req.body || {};

    // Require authenticated user (Firebase ID token verified in server.js -> attachFirebaseUser)
    if (!req.user || !req.user.uid) {
      return res.status(401).json({
        error: 'Sign in required',
        code: 'AUTH_REQUIRED',
        message: 'Create a free account or sign in to use OnPrompted. Free accounts include 10 prompt inputs per month.',
      });
    }

    if (!goal || typeof goal !== 'string') {
      return res.status(400).json({
        error: 'Missing "goal" (string) in request body.',
      });
    }

    const uid = req.user.uid;

    // Fetch plan & usage and enforce limit BEFORE calling OpenAI
    const { plan, limit, usage, shouldReset } = await getUserPlanAndUsage(uid);

    if (usage >= limit) {
      return res.status(402).json({
        error: 'Limit reached',
        code: 'LIMIT_REACHED',
        message: `You have used your ${limit} prompt inputs for this cycle on the ${plan} plan. Upgrade to continue.`,
      });
    }

    const hasClarifications =
      typeof clarificationAnswers === 'string' &&
      clarificationAnswers.trim().length > 0;

    const baseContext = `
Category (optional): ${category || 'unspecified'}
Extra context (optional): ${extraContext || 'none'}
`.trim();

    const userMessage = hasClarifications
      ? `
MODE 2: FINAL PROMPT

Original user request:
${goal}

User's answers to your clarifying questions:
${clarificationAnswers}

${baseContext}

Now respond ONLY with:
{
  "status": "ready",
  "final_prompt": "..."
}
      `.trim()
      : `
MODE 1: CLARIFICATION OR DIRECT PROMPT

User request (raw):
${goal}

${baseContext}

Decide if you need clarifications.

If the request is NOT extremely clear and specific:
  Respond ONLY with:
  {
    "status": "needs_clarification",
    "questions": ["question 1", "question 2", "question 3 (optional)"]
  }

If the request IS already fully clear, specific, and well-scoped:
  Respond ONLY with:
  {
    "status": "ready",
    "final_prompt": "..."
  }
      `.trim();

    // Call OpenAI
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const raw = response.output[0]?.content?.[0]?.text || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse JSON from model:', raw);
      return res.status(502).json({
        error: 'Model returned invalid JSON.',
        details: raw,
      });
    }

    // At this point, we successfully consumed ONE input => increment usage
    await incrementUsage(uid, 1);

    // Enforce allowed response shapes
    if (parsed.status === 'needs_clarification') {
      if (!Array.isArray(parsed.questions) || !parsed.questions.length) {
        return res.status(502).json({
          error: 'Model indicated needs_clarification without valid questions.',
          details: parsed,
        });
      }
      return res.json({
        status: 'needs_clarification',
        questions: parsed.questions,
      });
    }

    if (parsed.status === 'ready' && typeof parsed.final_prompt === 'string') {
      return res.json({
        status: 'ready',
        final_prompt: parsed.final_prompt,
      });
    }

    // Fallback if model misbehaves but at least returned final_prompt
    if (typeof parsed.final_prompt === 'string') {
      return res.json({
        status: 'ready',
        final_prompt: parsed.final_prompt,
      });
    }

    console.error('Unexpected model response shape:', parsed);
    return res.status(502).json({
      error: 'Unexpected response from model.',
      details: parsed,
    });
  } catch (err) {
    console.error('Prompt optimizer error:', err);
    res.status(500).json({
      error: 'Failed to generate optimized prompt.',
      details:
        process.env.NODE_ENV === 'production'
          ? undefined
          : String(err),
    });
  }
});

export default router;