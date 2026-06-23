import * as Sentry from "@sentry/nextjs";

// No-ops when SENTRY_DSN is unset, so this is safe to ship before the DSN exists.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
