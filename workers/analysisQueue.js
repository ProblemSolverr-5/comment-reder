const Queue = require("better-queue");
const { updateJob } = require("../db/jobStore");
const { fetchVideoMetadata, fetchComments } = require("../services/youtube.service");
const {
  classifyComments,
  buildSentimentSummary,
  extractKeywords,
} = require("../services/sentiment.service");

/**
 * The analysis queue processes one job at a time.
 * Each job runs through 4 steps mirroring the frontend loading screen.
 */
const analysisQueue = new Queue(
  async function (task, done) {
    const { jobId, videoId } = task;

    try {
      // ── STEP 1: Fetch video metadata ────────────────────────────────
      updateJob(jobId, {
        progress: { step: 1, label: "Fetching public video comments..." },
      });

      let videoData;
      try {
        videoData = await fetchVideoMetadata(videoId);
      } catch (err) {
        if (err.code === "VIDEO_NOT_FOUND") {
          updateJob(jobId, {
            status: "failed",
            error_code: "VIDEO_NOT_FOUND",
            message: "This video does not exist or has been removed.",
          });
          return done();
        }
        throw err;
      }

      // ── STEP 2: Fetch comments ───────────────────────────────────────
      updateJob(jobId, {
        progress: { step: 2, label: "Running NLP sentiment analysis..." },
      });

      let rawComments = [];
      try {
        rawComments = await fetchComments(videoId, 300);
      } catch (err) {
        // Comments disabled — continue with empty array
        console.warn(`Comments unavailable for ${videoId}:`, err.message);
      }

      // ── STEP 3: AI classification ────────────────────────────────────
      updateJob(jobId, {
        progress: {
          step: 3,
          label: "Extracting viewer questions & suggestions...",
        },
      });

      let classifiedComments = rawComments;
      if (rawComments.length > 0) {
        const classifications = await classifyComments(rawComments);
        // Merge category back into comment objects
        const categoryMap = new Map(classifications.map((c) => [c.id, c.category]));
        classifiedComments = rawComments.map((c) => ({
          ...c,
          category: categoryMap.get(c.id) || "neutral",
        }));
      }

      // ── STEP 4: Build summary + keywords ────────────────────────────
      updateJob(jobId, {
        progress: { step: 4, label: "Building interactive dashboard..." },
      });

      const sentimentSummary = buildSentimentSummary(classifiedComments);
      const keywords = await extractKeywords(classifiedComments);

      // ── COMPLETE ─────────────────────────────────────────────────────
      updateJob(jobId, {
        status: "complete",
        video: videoData,
        sentiment_summary: sentimentSummary,
        keywords,
        comments: classifiedComments,
      });

      done();
    } catch (err) {
      console.error(`Job ${jobId} failed:`, err.message);
      updateJob(jobId, {
        status: "failed",
        error_code: "INTERNAL_ERROR",
        message: "An unexpected error occurred. Please try again.",
      });
      done(err);
    }
  },
  {
    concurrent: 2,     // Process 2 jobs at a time
    maxRetries: 1,
    retryDelay: 2000,
  }
);

analysisQueue.on("task_failed", (taskId, err) => {
  console.error(`Task ${taskId} permanently failed:`, err?.message);
});

module.exports = analysisQueue;
