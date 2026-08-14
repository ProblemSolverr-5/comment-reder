const express = require("express");
const router = express.Router();
const { getJob, dismissComment } = require("../db/jobStore");

/**
 * GET /comments
 * Query: job_id, category (default: "all"), page (default: 1), per_page (default: 20)
 *
 * Returns filtered + paginated comments for a job.
 * Used when the user clicks a category filter tab in the results view.
 */
router.get("/", (req, res) => {
  const { job_id, category = "all", page = "1", per_page = "20" } = req.query;

  if (!job_id) {
    return res.status(400).json({
      error_code: "MISSING_PARAM",
      message: "job_id query parameter is required.",
    });
  }

  const job = getJob(job_id);
  if (!job) {
    return res.status(404).json({
      error_code: "JOB_NOT_FOUND",
      message: "No analysis job found with that ID.",
    });
  }

  if (job.status !== "complete") {
    return res.status(409).json({
      error_code: "JOB_NOT_READY",
      message: "Analysis is still in progress. Please wait.",
    });
  }

  const validCategories = [
    "all", "positive", "critical", "questions",
    "suggestions", "urgent", "business", "spam", "sarcasm", "neutral",
  ];

  if (!validCategories.includes(category)) {
    return res.status(400).json({
      error_code: "INVALID_CATEGORY",
      message: `Category must be one of: ${validCategories.join(", ")}`,
    });
  }

  // Filter
  let filtered =
    category === "all"
      ? job.comments
      : job.comments.filter((c) => c.category === category);

  const total = filtered.length;

  // Paginate
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const perPageNum = Math.min(100, Math.max(1, parseInt(per_page, 10) || 20));
  const start = (pageNum - 1) * perPageNum;
  const paginated = filtered.slice(start, start + perPageNum);

  return res.json({
    job_id,
    category,
    total,
    page: pageNum,
    per_page: perPageNum,
    total_pages: Math.ceil(total / perPageNum),
    comments: paginated,
  });
});

/**
 * DELETE /comments/:commentId
 * Body: { job_id: "job_..." }
 *
 * Removes a comment from the job's feed (mirrors the ✕ dismiss button).
 */
router.delete("/:commentId", (req, res) => {
  const { commentId } = req.params;
  const { job_id } = req.body;

  if (!job_id) {
    return res.status(400).json({
      error_code: "MISSING_PARAM",
      message: "job_id is required in the request body.",
    });
  }

  const job = getJob(job_id);
  if (!job) {
    return res.status(404).json({
      error_code: "JOB_NOT_FOUND",
      message: "No analysis job found with that ID.",
    });
  }

  const removed = dismissComment(job_id, commentId);
  if (!removed) {
    return res.status(404).json({
      error_code: "COMMENT_NOT_FOUND",
      message: "Comment not found or already dismissed.",
    });
  }

  return res.json({
    success: true,
    dismissed_id: commentId,
  });
});

module.exports = router;
