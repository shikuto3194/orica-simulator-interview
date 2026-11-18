const SECRET_PATTERNS = [
  { re: /\b(sk-(?:proj-)?[A-Za-z0-9]{20,})/g, name: "API Key" },
  { re: /\b(AKIA[A-Z0-9]{16})/g, name: "AWS Access Key" },
  { re: /\b(ghp_[A-Za-z0-9]{36,})/g, name: "GitHub PAT" },
  { re: /\b(gho_[A-Za-z0-9]{36,})/g, name: "GitHub OAuth" },
  { re: /\b(xox[bpas]-[A-Za-z0-9-]{10,})/g, name: "Slack Token" },
  { re: /\b(sk-ant-[A-Za-z0-9-]{20,})/g, name: "Anthropic Key" },
  { re: /\b(\d{8,10}:AA[A-Za-z0-9_-]{30,})/g, name: "Telegram Bot Token" },
  {
    re: /(-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH|ENCRYPTED)?\s*PRIVATE KEY-----[\s\S]*?-----END\s+(?:RSA|DSA|EC|OPENSSH|ENCRYPTED)?\s*PRIVATE KEY-----)/g,
    name: "SSH Private Key",
  },
  {
    re: /\b(eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/g,
    name: "JWT Token",
  },
  { re: /\b([0-9a-f]{40,})\b/gi, name: "Hex Secret" },
  {
    re: /(?:(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?)\s*[:=]\s*)([^\s"']{12,})/gi,
    name: "Credential Value",
  },
];

export function maskSecret(value) {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export function sanitizeOutput(text) {
  const detected = [];
  let sanitized = text;

  for (const { re, name } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    sanitized = sanitized.replace(re, (fullMatch, capture) => {
      detected.push(name);
      return fullMatch.replace(capture, maskSecret(capture));
    });
  }

  return { text: sanitized, detected: [...new Set(detected)] };
}
