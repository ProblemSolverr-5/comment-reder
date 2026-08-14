 /**
 * In-memory job store.
 * Replaces a real database for local development.
 * Jobs expire after 30 minutes to prevent memory leaks.
 */

const jobs = new Map();
const EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

function createJob(jobId, videoUrl) {
  const job = {
    job_id: jobId,
    video_url: videoUrl,
    status: "processing",
    progress: { step: 1, label: "Fetching public video comments..." },
    video: null,
    sentiment_summary: null,
    keywords: [],
    comments: [],
    error_code: null,
    message: null,
    created_at: Date.now(),
  };
  jobs.set(jobId, job);
  return job;
}

function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  // Auto-expire
  if (Date.now() - job.created_at > EXPIRY_MS) {
    jobs.delete(jobId);
    return null;
  }
  return job;
}

function updateJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, updates);
  return job;
}

function dismissComment(jobId, commentId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  const before = job.comments.length;
  job.comments = job.comments.filter((c) => c.id !== commentId);
  return job.comments.length < before;
}

module.exports = { createJob, getJob, updateJob, dismissComment };
