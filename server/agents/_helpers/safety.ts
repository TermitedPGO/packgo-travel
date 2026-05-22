/**
 * v2 Wave 3 Module 3.11 — autonomous-agent safety wrapper.
 *
 * Wraps an autonomous agent's top-level entry function so any throw
 * gets reported to Jeff via `notifyOwner` BEFORE propagating to the
 * caller. Closes the audit gap §A line 71:
 *
 *   "failure-mode coverage is inconsistent — refundAgent, reviewAgent,
 *    followupAgent do not call notifyOwner"
 *
 * Today (pre-3.11):
 *   - gmailPollWorker / retrospectiveWorker / tripReminderWorker call
 *     notifyOwner at the worker level, so anything they invoke is
 *     covered transitively
 *   - But: refundAgent (autonomous via Stripe webhook, module 3.5),
 *     reviewAgent (line 179 has `catch {}` — silent swallow),
 *     followupAgent, marketingAgent, accountingAgent — all CAN throw
 *     in their own autonomous paths, and Jeff would see nothing
 *
 * This wrapper:
 *   1. Catches every throw at the agent's top-level entry
 *   2. Calls `notifyOwner` with the agent name + error + optional
 *      structured context (e.g., bookingId, customerEmail)
 *   3. Re-throws the original error so existing worker-level catches
 *      see the same shape (back-compat with every caller)
 *
 * Important properties:
 *   - notifyOwner's OWN failure does NOT shadow the original error.
 *     We catch its throw and console.error it (using stderr directly
 *     so we don't recurse through pino → Sentry if Sentry is the
 *     thing that's down). Original error always propagates.
 *   - `await`s notifyOwner — caller blocks until Jeff is notified
 *     (or the notification fails). This is intentional: a silent
 *     "I'll send the email later" pattern is exactly what we're
 *     trying to fix.
 */

import { notifyOwner } from "../../_core/notification";

export type SafetyOptions = {
  /** Agent identifier for the alert title — e.g. "refund", "review". */
  agentName: string;
  /**
   * Extra structured context to include in the alert body. Useful for
   * pinning the failure to a customer / booking / charge id. Stringified
   * with JSON.stringify; keep it small (<2 KB) — email body has limits.
   */
  context?: Record<string, unknown>;
};

/**
 * Wrap an async function with the safety net. The returned function
 * has the same arg + return shape as the original, plus an alert
 * fire-and-rethrow on any throw.
 *
 * Usage:
 *   export const runRefundAgent = withAutonomousSafety(
 *     { agentName: "refund" },
 *     _runRefundAgentInner,
 *   );
 *
 * Or with dynamic context:
 *   async function runRefundAgent(input: RefundAgentInput) {
 *     return withAutonomousSafety(
 *       { agentName: "refund", context: { bookingId: input.stripeContext?.bookingId } },
 *       () => _runRefundAgentInner(input),
 *     )();
 *   }
 */
export function withAutonomousSafety<TArgs extends unknown[], TReturn>(
  options: SafetyOptions,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    try {
      return await fn(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;

      try {
        await notifyOwner({
          title: `⚠️ ${options.agentName} 自動代理人失敗`,
          content:
            `Agent: ${options.agentName}\n` +
            `Error: ${message}\n` +
            (options.context
              ? `Context: ${JSON.stringify(options.context, null, 2)}\n`
              : "") +
            (stack ? `\nStack:\n${stack.slice(0, 2000)}` : ""),
        });
      } catch (notifyErr) {
        // Use stderr directly so a broken pino / Sentry doesn't make
        // this throw recursively. Original error always propagates next.
        process.stderr.write(
          `[withAutonomousSafety] notifyOwner ALSO failed for ` +
            `${options.agentName}: ${
              notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
            }\n`,
        );
      }

      // Re-throw the ORIGINAL error so callers see unchanged shape.
      throw err;
    }
  };
}
