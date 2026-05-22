import type { EmitTransport, InferenceEvent } from "@/lib/sdk/types";

export function createHttpEventTransport(endpoint: string): EmitTransport {
  return async (event: InferenceEvent) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Inference transport failed with status ${response.status}.`);
    }
  };
}

export function emitAsync(transport: EmitTransport, event: InferenceEvent) {
  void transport(event).catch((error) => {
    console.error("Inference event emission failed.", error);
  });
}
