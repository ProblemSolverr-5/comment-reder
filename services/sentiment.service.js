const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// gemini-1.5-flash is fast, cheap, and great for classification tasks
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const VALID_CATEGORIES = [
  "positive",
  "critical",
  "questions",
  "suggestions",
  "urgent",
  "business",
  "spam",
  "sarcasm",
  "neutral",
];

/**
 * Classify a batch of comments using Gemini.
 * We send up to 50 comments per request to stay within token limits.
 * Returns an array of { id, category } objects.
 */
async function classifyComments(comments) {
  const results = [];
  const BATCH_SIZE = 50;

  for (let i = 0; i < comments.length; i += BATCH_SIZE) {
    const batch = comments.slice(i, i + BATCH_SIZE);
    const batchResults = await classifyBatch(batch);
    results.push(...batchResults);
  }

  return results;
}

async function classifyBatch(comments) {
  const input = comments.map((c, idx) => `${idx + 1}. [ID:${c.id}] ${c.body}`).join("\n");

  const prompt = `You are a YouTube comment classifier. Classify each comment below into EXACTLY one category.

CATEGORIES:
- positive     → praise, thanks, love, enthusiasm, encouragement
- critical     → complaints, audio/video issues, factual errors, disappointment
- questions    → asking anything (how, what, why, when, where)
- suggestions  → requesting new content, features, improvements
- urgent       → broken links, errors, time-sensitive issues that need creator action
- business     → sponsorship offers, collaboration, brand deals, affiliate mentions
- spam         → ads, self-promotion, bots, irrelevant links, repetitive caps
- sarcasm      → jokes, irony, memes, backhanded compliments
- neutral      → off-topic, general statements, neither positive nor negative

COMMENTS TO CLASSIFY:
${input}

RESPOND WITH ONLY valid JSON — no explanation, no markdown fences. Format:
[{"id":"COMMENT_ID","category":"CATEGORY"},...]

Use exactly the IDs from the [ID:...] tags. Use only the category names listed above.`;

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    // Strip any accidental markdown fences Gemini sometimes adds
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    // Validate each result
    return parsed.map((item) => ({
      id: item.id,
      category: VALID_CATEGORIES.includes(item.category) ? item.category : "neutral",
    }));
  } catch (err) {
    console.error("Sentiment classification error:", err.message);
    // Fallback: mark all as neutral if AI fails
    return comments.map((c) => ({ id: c.id, category: "neutral" }));
  }
}

/**
 * Build sentiment summary counts from classified comments.
 */
function buildSentimentSummary(comments) {
  const summary = {
    positive: 0,
    critical: 0,
    questions: 0,
    suggestions: 0,
    urgent: 0,
    business: 0,
    spam: 0,
    sarcasm: 0,
    neutral: 0,
  };
  for (const c of comments) {
    if (summary[c.category] !== undefined) {
      summary[c.category]++;
    }
  }
  return summary;
}

/**
 * Extract top repeated keywords/themes using Gemini.
 */
async function extractKeywords(comments) {
  if (comments.length === 0) return [];

  // Sample up to 100 comment bodies for keyword extraction
  const sample = comments
    .slice(0, 100)
    .map((c) => c.body)
    .join("\n");

  const prompt = `Extract the top 8 recurring topics or keywords from these YouTube comments.
Return ONLY a JSON array of short phrases (2-4 words each), no explanation, no markdown fences.
Example: ["react hooks","audio quality","part 2","VS Code theme"]

COMMENTS:
${sample}`;

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/```json|```/g, "").trim();
    const keywords = JSON.parse(raw);
    return Array.isArray(keywords) ? keywords.slice(0, 8) : [];
  } catch {
    return [];
  }
}

module.exports = { classifyComments, buildSentimentSummary, extractKeywords };