import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";
import { Toaster } from "@/components/ui/sonner";
import { HelmetProvider } from "react-helmet-async";
import SentryBoundary from "./_core/SentryBoundary";

// v2 Wave 1 Module 1.1 — Sentry browser SDK. MUST run before createRoot
// so the SDK can install global error/unhandledrejection handlers before
// React mounts. No-op when VITE_SENTRY_DSN unset (preview / dev without
// observability).
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_GIT_COMMIT,
    integrations: [
      Sentry.browserTracingIntegration(),
      // PII discipline: mask all text + block all media in session replays.
      // Locked decision for v2 — opt-in unmasking is a v3 customization.
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: 0.1,
    // Cost discipline: 0% baseline replay, 100% on error. Replay only
    // when something actually broke.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
    // v2 Wave 1 Module 1.1 — surface tRPC query errors in Sentry. Skipping
    // unauthorized (we redirect to login) since it's not a bug.
    if (error && !(error instanceof TRPCClientError && error.message === UNAUTHED_ERR_MSG)) {
      Sentry.captureException(error);
    }
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
    if (error && !(error instanceof TRPCClientError && error.message === UNAUTHED_ERR_MSG)) {
      Sentry.captureException(error);
    }
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        // 設定 10 分鐘超時時間以支援 AI 自動生成等長時間操作
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600000);
        
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <SentryBoundary>
    <HelmetProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <App />
          <Toaster />
        </QueryClientProvider>
      </trpc.Provider>
    </HelmetProvider>
  </SentryBoundary>
);
