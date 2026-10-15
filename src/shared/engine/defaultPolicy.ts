import type { Policy } from './policyCore';

export const DEFAULT_POLICY_YAML = `# SmartMask masking policy.
# Roles x tags -> masking function. Save publishes a new policy_version.
policy_version: 7
fail_mode: closed
rules:
  - role: ROLE_ADMIN
    tag: "*"
    function: PLAINTEXT
  - role: ROLE_SUPPORT
    tag: PII_HIGH
    function: PARTIAL_KEEP
  - role: ROLE_SUPPORT
    tag: FINANCIAL_CONFIDENTIAL
    function: BUCKET
    width: 50000
  - role: ROLE_SUPPORT
    tag: PII_MEDIUM
    function: PARTIAL_KEEP
  - role: ROLE_SUPPORT
    tag: PII_MEDIUM
    family: EMAIL
    function: PARTIAL_EMAIL
  - role: ROLE_ANALYST
    tag: PII_HIGH
    function: HMAC_TOKEN
  - role: ROLE_ANALYST
    tag: FINANCIAL_CONFIDENTIAL
    function: REDACT
  - role: ROLE_ANALYST
    tag: PII_MEDIUM
    function: REDACT
`;


/**
 * The same policy, pre-parsed, so the engine can start without loading the YAML parser.
 * A unit test asserts this stays identical to parsing DEFAULT_POLICY_YAML.
 */
export const DEFAULT_POLICY: Policy = {
  version: 7,
  rules: [
    { role: 'ROLE_ADMIN', tag: '*', function: 'PLAINTEXT', line: 0 },
    { role: 'ROLE_SUPPORT', tag: 'PII_HIGH', function: 'PARTIAL_KEEP', line: 0 },
    { role: 'ROLE_SUPPORT', tag: 'FINANCIAL_CONFIDENTIAL', function: 'BUCKET', width: 50000, line: 0 },
    { role: 'ROLE_SUPPORT', tag: 'PII_MEDIUM', function: 'PARTIAL_KEEP', line: 0 },
    { role: 'ROLE_SUPPORT', tag: 'PII_MEDIUM', family: 'EMAIL', function: 'PARTIAL_EMAIL', line: 0 },
    { role: 'ROLE_ANALYST', tag: 'PII_HIGH', function: 'HMAC_TOKEN', line: 0 },
    { role: 'ROLE_ANALYST', tag: 'FINANCIAL_CONFIDENTIAL', function: 'REDACT', line: 0 },
    { role: 'ROLE_ANALYST', tag: 'PII_MEDIUM', function: 'REDACT', line: 0 },
  ],
};
