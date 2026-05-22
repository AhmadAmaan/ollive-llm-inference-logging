import { createDefaultRedactionPipeline } from "@/lib/sdk";

const redact = createDefaultRedactionPipeline();

export function redactSensitiveText(input: string | null | undefined) {
  if (!input) {
    return input ?? null;
  }

  return (
    redact({
      input,
      context: {
        provider: "internal",
        model: "n/a",
        operation: "legacy-redaction",
      },
    }).requestPreview ?? null
  );
}
