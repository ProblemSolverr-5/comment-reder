const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

// Retry helper — exponential backoff
async function withRetry(fn, retries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === retries;
      console.warn(`Attempt ${attempt} failed: ${err.message}${isLast ? " — giving up." : " — retrying..."}`);
      if (isLast) throw err;
      await new Promise((res) => setTimeout(res, delayMs * attempt)); // exponential: 1s, 2s, 3s
    }
  }
}

/**
 * Classify a batch of comments using Gemini.
 * Gemini freely decides the category based on comment meaning.
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
  const input = comments
    .map((c, idx) => `${idx + 1}. [ID:${c.id}] ${c.body}`)
    .join("\n");

  const prompt = `You are an expert YouTube comment analyst. Your job is to read each comment carefully and assign it a single descriptive category that best captures its meaning, intent, and tone.

Do NOT use a fixed list. Instead, derive the category naturally from what the commenter is actually expressing. The category should be:
- A short lowercase phrase (1–3 words, no punctuation)
- Descriptive and specific enough to be meaningful (e.g. "technical issue", "genuine praise", "feature request", "confused viewer", "spam link", "sarcastic joke", "collaboration offer")
- Consistent — similar comments should get the same category label

COMMENTS:
${input}

RESPOND WITH ONLY valid JSON — no explanation, no markdown fences. Format:
[{"id":"COMMENT_ID","category":"your derived category"},...]

Use exactly the IDs from the [ID:...] tags.`;

  try {
    // Wrap the Gemini call in withRetry
    const result = await withRetry(() => model.generateContent(prompt));
    const raw = result.response.text().trim();
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return parsed.map((item) => ({
      id: item.id,
      category:
        typeof item.category === "string" && item.category.trim().length > 0
          ? item.category.trim().toLowerCase().replace(/\s+/g, " ")
          : "uncategorized",
    }));
  } catch (err) {
    console.error("Sentiment classification failed after retries:", err.message);
    return comments.map((c) => ({ id: c.id, category: "uncategorized" }));
  }
}

/**
 * Build sentiment summary counts from classified comments.
 * Since categories are now dynamic, this groups by whatever labels Gemini returned.
 */
function buildSentimentSummary(comments) {
  const summary = {};
  for (const c of comments) {
    const cat = c.category || "uncategorized";
    summary[cat] = (summary[cat] || 0) + 1;
  }
  return summary;
}

/**
 * Extract top repeated keywords/themes using Gemini.
 */
async function extractKeywords(comments) {
  if (comments.length === 0) return [];

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
    // Retry for keyword extraction too
    const result = await withRetry(() => model.generateContent(prompt));
    const raw = result.response
      .text()
      .trim()
      .replace(/```json|```/g, "")
      .trim();
    const keywords = JSON.parse(raw);
    return Array.isArray(keywords) ? keywords.slice(0, 8) : [];
  } catch {
    return [];
  }
}

module.exports = { classifyComments, buildSentimentSummary, extractKeywords };