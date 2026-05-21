const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern =
  /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){1}\d{3}[-.\s]?\d{4}\b/g;
const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g;
const cardPattern = /\b(?:\d[ -]*?){13,16}\b/g;
const apiKeyPattern =
  /\b(?:sk-[A-Za-z0-9_\-]{16,}|AIza[0-9A-Za-z\-_]{20,}|anthropic_[A-Za-z0-9_\-]{16,})\b/g;

function redactCardCandidate(value: string) {
  const digits = value.replace(/[ -]/g, "");
  return digits.length >= 13 && digits.length <= 16 ? "[REDACTED_CARD]" : value;
}

export function redactSensitiveText(input: string | null | undefined) {
  if (!input) {
    return input ?? null;
  }

  return input
    .replace(emailPattern, "[REDACTED_EMAIL]")
    .replace(phonePattern, "[REDACTED_PHONE]")
    .replace(ssnPattern, "[REDACTED_SSN]")
    .replace(apiKeyPattern, "[REDACTED_SECRET]")
    .replace(cardPattern, redactCardCandidate);
}
