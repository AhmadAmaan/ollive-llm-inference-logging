import { truncate } from "@/lib/utils";

import type {
  InferenceContext,
  RedactionInput,
  RedactionResult,
  RedactionStrategy,
} from "@/lib/sdk/types";

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern =
  /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){1}\d{3}[-.\s]?\d{4}\b/g;
const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g;
const cardPattern = /\b(?:\d[ -]*?){13,16}\b/g;
const apiKeyPattern =
  /\b(?:sk-[A-Za-z0-9_\-]{16,}|AIza[0-9A-Za-z\-_]{20,}|anthropic_[A-Za-z0-9_\-]{16,})\b/g;

const riskyFieldNames = new Set([
  "address",
  "api_key",
  "apikey",
  "authorization",
  "card",
  "card_number",
  "dob",
  "date_of_birth",
  "diagnosis",
  "email",
  "insurance",
  "medical_record_number",
  "mrn",
  "name",
  "patient",
  "patient_name",
  "phone",
  "prescription",
  "secret",
  "social_security_number",
  "ssn",
  "token",
]);

const sensitiveDocumentTerms = [
  "allergy",
  "blood pressure",
  "claim",
  "clinical",
  "diagnosis",
  "dob",
  "insurance",
  "lab result",
  "medical",
  "medication",
  "patient",
  "physician",
  "prescription",
  "radiology",
  "ssn",
  "treatment",
];

function redactCardCandidate(value: string) {
  const digits = value.replace(/[ -]/g, "");
  return digits.length >= 13 && digits.length <= 16 ? "[REDACTED_CARD]" : value;
}

function patternRedact(value: string) {
  return value
    .replace(emailPattern, "[REDACTED_EMAIL]")
    .replace(phonePattern, "[REDACTED_PHONE]")
    .replace(ssnPattern, "[REDACTED_SSN]")
    .replace(apiKeyPattern, "[REDACTED_SECRET]")
    .replace(cardPattern, redactCardCandidate);
}

function normalizeText(value: unknown) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function redactStructuredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactStructuredValue);
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (riskyFieldNames.has(normalizedKey)) {
        next[key] = "[REDACTED_FIELD]";
        continue;
      }

      next[key] = redactStructuredValue(entry);
    }

    return next;
  }

  if (typeof value === "string") {
    return patternRedact(value);
  }

  return value;
}

function createDocumentSensitivitySummary(
  context: InferenceContext,
  rawInput: string,
  rawOutput?: string | null,
) {
  const lower = `${context.operation}\n${rawInput}\n${rawOutput ?? ""}`.toLowerCase();
  const hits = sensitiveDocumentTerms.filter((term) => lower.includes(term)).length;

  if (hits < 2) {
    return null;
  }

  return {
    requestPreview: `[REDACTED_SENSITIVE_DOCUMENT:${context.operation}] input_chars=${rawInput.length}`,
    responsePreview: rawOutput
      ? `[REDACTED_SENSITIVE_DOCUMENT:${context.operation}] output_chars=${rawOutput.length}`
      : undefined,
    metadata: {
      redactionPolicy: "document-sensitive",
      sensitiveTermHits: hits,
    },
  } satisfies RedactionResult;
}

const structuredFieldStrategy: RedactionStrategy = {
  name: "structured-field",
  redact(payload) {
    const input =
      payload.input && typeof payload.input === "object"
        ? redactStructuredValue(payload.input)
        : payload.input;
    const output =
      payload.output && typeof payload.output === "object"
        ? redactStructuredValue(payload.output)
        : payload.output;

    if (input === payload.input && output === payload.output) {
      return null;
    }

    return {
      requestPreview: normalizeText(input),
      responsePreview: normalizeText(output),
      metadata: {
        redactionPolicy: "structured-field",
      },
    };
  },
};

const documentSensitivityStrategy: RedactionStrategy = {
  name: "document-sensitive",
  redact(payload) {
    const rawInput = normalizeText(payload.input);
    if (!rawInput) {
      return null;
    }

    return createDocumentSensitivitySummary(
      payload.context,
      rawInput,
      normalizeText(payload.output),
    );
  },
};

const patternStrategy: RedactionStrategy = {
  name: "pattern",
  redact(payload) {
    const rawInput = normalizeText(payload.input);
    const rawOutput = normalizeText(payload.output);

    return {
      requestPreview: rawInput ? patternRedact(rawInput) : rawInput,
      responsePreview: rawOutput ? patternRedact(rawOutput) : rawOutput,
      metadata: {
        redactionPolicy: "pattern",
      },
    };
  },
};

export function createDefaultRedactionPipeline(
  strategies: RedactionStrategy[] = [
    structuredFieldStrategy,
    documentSensitivityStrategy,
    patternStrategy,
  ],
) {
  return (payload: RedactionInput): RedactionResult => {
    let requestPreview = normalizeText(payload.input);
    let responsePreview = normalizeText(payload.output);
    const metadata: Record<string, unknown> = {};

    for (const strategy of strategies) {
      const result = strategy.redact({
        ...payload,
        input: requestPreview ?? payload.input,
        output: responsePreview ?? payload.output,
      });

      if (!result) {
        continue;
      }

      if (result.requestPreview !== undefined) {
        requestPreview = result.requestPreview;
      }

      if (result.responsePreview !== undefined) {
        responsePreview = result.responsePreview;
      }

      if (result.metadata) {
        Object.assign(metadata, result.metadata);
      }
    }

    return {
      requestPreview: requestPreview ? truncate(requestPreview, 320) : requestPreview,
      responsePreview: responsePreview ? truncate(responsePreview, 320) : responsePreview,
      metadata,
    };
  };
}
