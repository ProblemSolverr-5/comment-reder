const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error_code: "RATE_LIMITED",
    message: "Too many requests. Please wait a moment and try again.",
  },
});

module.exports = limiter;
