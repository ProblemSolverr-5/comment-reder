const Queue = require("better-queue");
const MemoryStore = require("better-queue-memory");
const { updateJob } = require("../db/jobStore");
const { fetchVideoMetadata, fetchComments } = require("../services/youtube.service");
const {
  classifyComments,
  buildSentimentSummary,
  extractKeywords,
} = require("../services/sentiment.service");

const analysisQueue = new Queue(
  async function (task, done) {
    const { jobId, videoId } = task;

    try {
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

      updateJob(jobId, {
        progress: { step: 2, label: "Running NLP sentiment analysis..." },
      });

      let rawComments = [];
      try {
        rawComments = await fetchComments(videoId, 300);
      } catch (err) {
        console.warn(`Comments unavailable for ${videoId}:`, err.message);
      }

      updateJob(jobId, {
        progress: {
          step: 3,
          label: "Extracting viewer questions & suggestions...",
        },
      });

      let classifiedComments = rawComments;
      if (rawComments.length > 0) {
        const classifications = await classifyComments(rawComments);
        const categoryMap = new Map(classifications.map((c) => [c.id, c.category]));
        classifiedComments = rawComments.map((c) => ({
          ...c,
          category: categoryMap.get(c.id) || "neutral",
        }));
      }

      updateJob(jobId, {
        progress: { step: 4, label: "Building interactive dashboard..." },
      });

      const sentimentSummary = buildSentimentSummary(classifiedComments);
      const keywords = await extractKeywords(classifiedComments);

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
    store: new MemoryStore(),
    concurrent: 2,
    maxRetries: 1,
    retryDelay: 2000,
  }
);

analysisQueue.on("task_failed", (taskId, err) => {
  console.error(`Task ${taskId} permanently failed:`, err?.message);
});

module.exports = analysisQueue;