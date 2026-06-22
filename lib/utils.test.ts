import { sanitizeSensitiveData, validateInput, generateFilename } from './utils'

describe('sanitizeSensitiveData', () => {
  it('should redact API keys', () => {
    const input = 'My API key is: api_key=abc123def456ghi789'
    const result = sanitizeSensitiveData(input)
    expect(result).toContain('api_key: [REDACTED]')
  })

  it('should redact secrets', () => {
    const input = 'secret=mySecret12345678'
    const result = sanitizeSensitiveData(input)
    expect(result).toContain('secret: [REDACTED]')
  })

  it('should redact tokens', () => {
    const input = 'token=xyz789abc123def456'
    const result = sanitizeSensitiveData(input)
    expect(result).toContain('token: [REDACTED]')
  })

  it('should redact passwords', () => {
    const input = 'password=superSecret12345678'
    const result = sanitizeSensitiveData(input)
    expect(result).toContain('password: [REDACTED]')
  })

  it('should redact emails', () => {
    const input = 'Contact me at test@example.com'
    const result = sanitizeSensitiveData(input)
    expect(result).toContain('[REDACTED]')
  })

  it('should redact IP addresses', () => {
    const input = 'Server IP is 192.168.1.100'
    const result = sanitizeSensitiveData(input)
    expect(result).toContain('[REDACTED]')
  })

  it('should not modify normal text', () => {
    const input = 'This is a normal sentence without sensitive data.'
    const result = sanitizeSensitiveData(input)
    expect(result).toBe(input)
  })
})

describe('validateInput', () => {
  it('should pass validation with valid input', () => {
    const input = {
      title: 'Test Issue',
      description: 'This is a detailed description with more than 30 characters.',
      expected: 'Expected behavior is clear',
      actual: 'Actual behavior is different'
    }
    const result = validateInput(input)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should fail when title is too short', () => {
    const input = {
      title: '',
      description: 'This is a detailed description with more than 30 characters.',
      expected: 'Expected behavior is clear',
      actual: 'Actual behavior is different'
    }
    const result = validateInput(input)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Title must be between 1-120 characters')
  })

  it('should fail when title is too long', () => {
    const input = {
      title: 'x'.repeat(121),
      description: 'This is a detailed description with more than 30 characters.',
      expected: 'Expected behavior is clear',
      actual: 'Actual behavior is different'
    }
    const result = validateInput(input)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Title must be between 1-120 characters')
  })

  it('should fail when description is too short', () => {
    const input = {
      title: 'Test Issue',
      description: 'Short',
      expected: 'Expected behavior is clear',
      actual: 'Actual behavior is different'
    }
    const result = validateInput(input)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Description must be at least 30 characters')
  })

  it('should fail when expected behavior is too short', () => {
    const input = {
      title: 'Test Issue',
      description: 'This is a detailed description with more than 30 characters.',
      expected: 'Short',
      actual: 'Actual behavior is different'
    }
    const result = validateInput(input)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Expected behavior must be at least 10 characters')
  })

  it('should fail when actual behavior is too short', () => {
    const input = {
      title: 'Test Issue',
      description: 'This is a detailed description with more than 30 characters.',
      expected: 'Expected behavior is clear',
      actual: 'Short'
    }
    const result = validateInput(input)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Actual behavior must be at least 10 characters')
  })
})

describe('generateFilename', () => {
  it('should generate filename with correct format', () => {
    const filename = generateFilename()
    expect(filename).toMatch(/^issue-\d{8}-\d{4}\.md$/)
  })
})
