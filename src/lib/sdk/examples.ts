import {
  createHttpEventTransport,
  createInferenceSdk,
  instrumentFetch,
} from "@/lib/sdk";

export async function wrapArbitraryHttpCall(baseUrl: string) {
  const sdk = createInferenceSdk({
    transport: createHttpEventTransport(`${baseUrl}/api/ingest/inference`),
  });

  return sdk.wrap({
    context: {
      provider: "internal-http",
      model: "none",
      operation: "runtime-info.lookup",
      sourceType: "http",
      sessionId: "sdk-example",
    },
    input: {
      url: `${baseUrl}/api/runtime-info`,
      method: "GET",
    },
    execute: async () => {
      const response = await fetch(`${baseUrl}/api/runtime-info`, {
        cache: "no-store",
      });

      return response.json();
    },
  });
}

export function installProviderAgnosticFetchInstrumentation(baseUrl: string) {
  return instrumentFetch({
    emit: createHttpEventTransport(`${baseUrl}/api/ingest/inference`),
    shouldInstrument(input) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      return !url.includes("/api/ingest/inference") && !url.includes("localhost");
    },
    resolveContext(input) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      return {
        operation: "monkey-patched.fetch",
        sourceType: "fetch",
        metadata: {
          url,
        },
      };
    },
  });
}
