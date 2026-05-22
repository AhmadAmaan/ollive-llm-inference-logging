import { truncate } from "@/lib/utils";

import type {
  ClassificationDecision,
  ClassificationDomain,
  ContentClassification,
  InferenceContext,
  RedactionClassifier,
  RedactionInput,
  RedactionResult,
  RedactionStrategy,
} from "@/lib/sdk/types";

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern =
  /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){1}\d{3}[-.\s]?\d{4}\b/g;
const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g;
const cardPattern = /\b(?:\d[ -]*?){13,19}\b/g;
const apiKeyPattern =
  /\b(?:sk-[A-Za-z0-9_\-]{16,}|AIza[0-9A-Za-z\-_]{20,}|anthropic_[A-Za-z0-9_\-]{16,})\b/g;
const ibanPattern = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const passportPattern = /\b[A-Z0-9]{6,9}\b/g;

const riskyFieldNames = new Set([
  "address",
  "api_key",
  "apikey",
  "authorization",
  "bank_account",
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
  "passport",
  "patient",
  "patient_name",
  "phone",
  "prescription",
  "routing_number",
  "secret",
  "social_security_number",
  "ssn",
  "token",
]);

type DomainRule = {
  domain: ClassificationDomain;
  keywords: Array<{ term: string; weight: number }>;
  patterns?: Array<{ pattern: RegExp; weight: number; reason: string }>;
  threshold: number;
  suppressThreshold: number;
};

const domainRules: DomainRule[] = [
  {
    domain: "health",
    threshold: 0.45,
    suppressThreshold: 0.7,
    keywords: [
      { term: "allergy", weight: 0.16 },
      { term: "clinical", weight: 0.14 },
      { term: "diagnosis", weight: 0.2 },
      { term: "lab result", weight: 0.17 },
      { term: "medical", weight: 0.14 },
      { term: "medication", weight: 0.16 },
      { term: "patient", weight: 0.18 },
      { term: "physician", weight: 0.13 },
      { term: "prescription", weight: 0.18 },
      { term: "radiology", weight: 0.15 },
      { term: "treatment", weight: 0.15 },
    ],
  },
  {
    domain: "finance",
    threshold: 0.45,
    suppressThreshold: 0.72,
    keywords: [
      { term: "account number", weight: 0.18 },
      { term: "bank", weight: 0.12 },
      { term: "billing", weight: 0.1 },
      { term: "claim amount", weight: 0.15 },
      { term: "credit card", weight: 0.18 },
      { term: "invoice", weight: 0.1 },
      { term: "payment", weight: 0.12 },
      { term: "premium", weight: 0.1 },
      { term: "routing number", weight: 0.18 },
      { term: "wire transfer", weight: 0.14 },
    ],
    patterns: [
      { pattern: ibanPattern, weight: 0.28, reason: "iban" },
      { pattern: cardPattern, weight: 0.26, reason: "payment-card" },
    ],
  },
  {
    domain: "identity",
    threshold: 0.42,
    suppressThreshold: 0.68,
    keywords: [
      { term: "date of birth", weight: 0.18 },
      { term: "driver license", weight: 0.16 },
      { term: "passport", weight: 0.18 },
      { term: "phone", weight: 0.08 },
      { term: "social security", weight: 0.2 },
      { term: "ssn", weight: 0.2 },
      { term: "tax id", weight: 0.18 },
    ],
    patterns: [
      { pattern: ssnPattern, weight: 0.35, reason: "ssn-pattern" },
      { pattern: passportPattern, weight: 0.08, reason: "passport-like" },
    ],
  },
  {
    domain: "legal",
    threshold: 0.38,
    suppressThreshold: 0.65,
    keywords: [
      { term: "attorney", weight: 0.15 },
      { term: "confidential settlement", weight: 0.2 },
      { term: "legal hold", weight: 0.18 },
      { term: "litigation", weight: 0.18 },
      { term: "privileged", weight: 0.18 },
      { term: "subpoena", weight: 0.14 },
    ],
  },
  {
    domain: "secrets",
    threshold: 0.35,
    suppressThreshold: 0.55,
    keywords: [
      { term: "access token", weight: 0.18 },
      { term: "authorization", weight: 0.12 },
      { term: "bearer", weight: 0.1 },
      { term: "client secret", weight: 0.18 },
      { term: "private key", weight: 0.16 },
      { term: "secret key", weight: 0.16 },
    ],
    patterns: [{ pattern: apiKeyPattern, weight: 0.4, reason: "api-key-pattern" }],
  },
];

function redactCardCandidate(value: string) {
  const digits = value.replace(/[ -]/g, "");
  return digits.length >= 13 && digits.length <= 19 ? "[REDACTED_CARD]" : value;
}

function patternRedact(value: string) {
  return value
    .replace(emailPattern, "[REDACTED_EMAIL]")
    .replace(phonePattern, "[REDACTED_PHONE]")
    .replace(ssnPattern, "[REDACTED_SSN]")
    .replace(apiKeyPattern, "[REDACTED_SECRET]")
    .replace(ibanPattern, "[REDACTED_IBAN]")
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

function detectStructuredRisk(input: unknown) {
  let hits = 0;

  function walk(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (riskyFieldNames.has(key.toLowerCase())) {
          hits += 1;
        }
        walk(entry);
      }
    }
  }

  walk(input);
  return hits;
}

function buildClassification(
  domain: ClassificationDomain,
  confidence: number,
  reasons: string[],
  suppressThreshold: number,
): ContentClassification {
  const decision: ClassificationDecision =
    confidence >= suppressThreshold ? "suppress-document" : "redact-fields";

  return {
    domain,
    confidence: Math.min(1, Number(confidence.toFixed(2))),
    decision,
    reasons,
  };
}

function keywordScore(lower: string, keywords: DomainRule["keywords"]) {
  let score = 0;
  const reasons: string[] = [];

  for (const keyword of keywords) {
    if (lower.includes(keyword.term)) {
      score += keyword.weight;
      reasons.push(`keyword:${keyword.term}`);
    }
  }

  return { score, reasons };
}

function patternScore(raw: string, patterns: DomainRule["patterns"] = []) {
  let score = 0;
  const reasons: string[] = [];

  for (const entry of patterns) {
    entry.pattern.lastIndex = 0;
    if (entry.pattern.test(raw)) {
      score += entry.weight;
      reasons.push(`pattern:${entry.reason}`);
    }
  }

  return { score, reasons };
}

export function createContentClassifier(
  extraClassifiers: RedactionClassifier[] = [],
): RedactionClassifier {
  return {
    name: "default-classifier",
    classify(payload) {
      const rawInput = normalizeText(payload.input) || "";
      const rawOutput = normalizeText(payload.output) || "";
      const combined = `${payload.context.operation}\n${rawInput}\n${rawOutput}`;
      const lower = combined.toLowerCase();
      const structuredRisk = Math.min(0.25, detectStructuredRisk(payload.input) * 0.05);
      const classifications: ContentClassification[] = [];

      for (const rule of domainRules) {
        const keyword = keywordScore(lower, rule.keywords);
        const pattern = patternScore(combined, rule.patterns);
        const confidence = keyword.score + pattern.score + structuredRisk;

        if (confidence >= rule.threshold) {
          classifications.push(
            buildClassification(
              rule.domain,
              confidence,
              [...keyword.reasons, ...pattern.reasons, structuredRisk > 0 ? "structured-risk" : ""]
                .filter(Boolean),
              rule.suppressThreshold,
            ),
          );
        }
      }

      for (const classifier of extraClassifiers) {
        classifications.push(...classifier.classify(payload));
      }

      return classifications.sort((a, b) => b.confidence - a.confidence);
    },
  };
}

function createSuppressedDocumentPreview(
  context: InferenceContext,
  rawValue: string,
  classifications: ContentClassification[],
  direction: "input" | "output",
) {
  const domains = classifications
    .filter((item) => item.decision === "suppress-document")
    .map((item) => `${item.domain}:${item.confidence}`)
    .join(",");

  return `[REDACTED_${direction.toUpperCase()}_DOCUMENT:${context.operation}] chars=${rawValue.length} classifications=${domains}`;
}

function createClassificationStrategy(
  classifier: RedactionClassifier = createContentClassifier(),
): RedactionStrategy {
  return {
    name: "classification",
    redact(payload) {
      const classifications = classifier.classify(payload);
      if (classifications.length === 0) {
        return null;
      }

      const rawInput = normalizeText(payload.input);
      const rawOutput = normalizeText(payload.output);
      const hasSuppressed = classifications.some(
        (item) => item.decision === "suppress-document",
      );

      return {
        requestPreview:
          rawInput && hasSuppressed
            ? createSuppressedDocumentPreview(
                payload.context,
                rawInput,
                classifications,
                "input",
              )
            : undefined,
        responsePreview:
          rawOutput && hasSuppressed
            ? createSuppressedDocumentPreview(
                payload.context,
                rawOutput,
                classifications,
                "output",
              )
            : undefined,
        metadata: {
          redactionClassifier: classifier.name,
          classifications: classifications.map((item) => ({
            domain: item.domain,
            confidence: item.confidence,
            decision: item.decision,
          })),
        },
      };
    },
  };
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

export function createDefaultRedactionPipeline(options?: {
  classifiers?: RedactionClassifier[];
  strategies?: RedactionStrategy[];
}) {
  const classifier = createContentClassifier(options?.classifiers);
  const strategies =
    options?.strategies ??
    [createClassificationStrategy(classifier), structuredFieldStrategy, patternStrategy];

  return (payload: RedactionInput): RedactionResult => {
    let currentInput: unknown = payload.input;
    let currentOutput: unknown = payload.output;
    let requestPreview: string | null | undefined;
    let responsePreview: string | null | undefined;
    const metadata: Record<string, unknown> = {};
    const fallbackRequestPreview = normalizeText(payload.input);
    const fallbackResponsePreview = normalizeText(payload.output);

    for (const strategy of strategies) {
      const result = strategy.redact({
        ...payload,
        input: currentInput,
        output: currentOutput,
      });

      if (!result) {
        continue;
      }

      if (result.requestPreview !== undefined) {
        requestPreview = result.requestPreview;
        currentInput = result.requestPreview;
      }

      if (result.responsePreview !== undefined) {
        responsePreview = result.responsePreview;
        currentOutput = result.responsePreview;
      }

      if (result.metadata) {
        Object.assign(metadata, result.metadata);
      }
    }

    return {
      requestPreview:
        requestPreview === undefined
          ? fallbackRequestPreview
            ? truncate(fallbackRequestPreview, 320)
            : fallbackRequestPreview
          : requestPreview
            ? truncate(requestPreview, 320)
            : requestPreview,
      responsePreview:
        responsePreview === undefined
          ? fallbackResponsePreview
            ? truncate(fallbackResponsePreview, 320)
            : fallbackResponsePreview
          : responsePreview
            ? truncate(responsePreview, 320)
            : responsePreview,
      metadata,
    };
  };
}
