export function sanitizeSensitiveData(text: string): string {
  let result = text;
  
  const patterns = [
    /(api[_-]?key|secret|token|password|bearer)\s*[:=]\s*([A-Za-z0-9-]{8,})/gi,
    /(API[_-]?KEY|SECRET|TOKEN|PASSWORD|BEARER)\s*[:=]\s*([A-Za-z0-9-]{8,})/g,
    /(Api[_-]?Key|Secret|Token|Password|Bearer)\s*[:=]\s*([A-Za-z0-9-]{8,})/g
  ];
  
  for (const pattern of patterns) {
    result = result.replace(pattern, '$1: [REDACTED]');
  }
  
  result = result.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    '[REDACTED]'
  );
  
  result = result.replace(
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    '[REDACTED]'
  );
  
  result = result.replace(
    /\b([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    '[REDACTED]'
  );
  
  return result;
}

export function validateInput(input: {
  title: string;
  description: string;
  expected: string;
  actual: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!input.title || input.title.length < 1 || input.title.length > 120) {
    errors.push('Title must be between 1-120 characters');
  }
  
  if (!input.description || input.description.length < 30) {
    errors.push('Description must be at least 30 characters');
  }
  
  if (!input.expected || input.expected.length < 10) {
    errors.push('Expected behavior must be at least 10 characters');
  }
  
  if (!input.actual || input.actual.length < 10) {
    errors.push('Actual behavior must be at least 10 characters');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

export function generateFilename(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return `issue-${year}${month}${day}-${hour}${minute}.md`;
}

export async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
