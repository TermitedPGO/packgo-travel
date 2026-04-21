/**
 * Manus-specific generic data-API proxy wrapper.
 *
 * DEPRECATED in the Fly.io deployment. The upstream
 * `webdevtoken.v1.WebDevService/CallApi` endpoint is a Manus-platform feature
 * that does not exist outside Manus. We keep the export so imports resolve,
 * but invocation throws. Grep shows zero in-repo callers; if you need
 * third-party API access on Fly, call the target API directly.
 */

export type DataApiCallOptions = {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  formData?: Record<string, unknown>;
};

export async function callDataApi(
  _apiId: string,
  _options: DataApiCallOptions = {}
): Promise<unknown> {
  throw new Error(
    "callDataApi() is not available on Fly.io. The Manus generic data-API proxy " +
      "was removed during migration. Call the target third-party API directly instead."
  );
}
