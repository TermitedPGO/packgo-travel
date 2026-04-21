import { TRPCError } from "@trpc/server";
import { ENV } from "./env";

export type NotificationPayload = {
  title: string;
  content: string;
};

const TITLE_MAX_LENGTH = 1200;
const CONTENT_MAX_LENGTH = 20000;

const trimValue = (value: string): string => value.trim();
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const buildEndpointUrl = (baseUrl: string): string => {
  const normalizedBase = baseUrl.endsWith("/")
    ? baseUrl
    : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};

const validatePayload = (input: NotificationPayload): NotificationPayload => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required.",
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required.",
    });
  }

  const title = trimValue(input.title);
  const content = trimValue(input.content);

  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`,
    });
  }

  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`,
    });
  }

  return { title, content };
};

/**
 * Dispatches a project-owner notification.
 *
 * NOTE: After the Fly.io migration off Manus Forge, the upstream
 * `WebDevService/SendNotification` endpoint no longer exists. Payload
 * validation is still enforced (malformed inputs still throw TRPCError), but
 * delivery is a no-op that returns `false` so callers take their fallback
 * path (e.g. email via SMTP, Slack webhook). Re-implement with a real
 * provider (SendGrid, Slack Incoming Webhooks, etc.) when needed.
 */
export async function notifyOwner(
  payload: NotificationPayload
): Promise<boolean> {
  // Preserve validation behaviour — malformed callers still get TRPCError.
  validatePayload(payload);
  console.warn(
    "[Notification] notifyOwner() is a no-op after Manus migration; " +
      "caller should use its fallback channel."
  );
  return false;
}
