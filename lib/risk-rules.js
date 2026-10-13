// Frozen initial research rules; changes require a new validation run.
export const RULE_VERSION = "1.0.0";
export const TEXT_RULES = [
  { id: "advance_fee", points: 30, pattern: /\b(pay|payment|fee|deposit|training fee|registration fee|processing fee|purchase equipment)\b/i, reason: "The listing may request money or an advance payment." },
  { id: "sensitive_information", points: 20, pattern: /\b(bank account|credit card|passport|identity card|social security|otp|one[- ]time password)\b/i, reason: "The listing may request sensitive personal or financial information." },
  { id: "pressure_language", points: 12, pattern: /\b(urgent hiring|act now|immediate start|limited slots|respond immediately|today only)\b/i, reason: "The listing uses pressure or unusual urgency." },
  { id: "off_platform_contact", points: 15, pattern: /\b(whatsapp|telegram|signal app|wechat|contact via chat|message me directly)\b/i, reason: "The listing encourages off-platform messaging." },
  { id: "unrealistic_income", points: 16, pattern: /\b(guaranteed income|earn \$?\d+[k,]? (?:daily|per day)|no experience.{0,25}high (?:pay|salary)|get rich|unlimited earnings)\b/i, reason: "The income claim may be unrealistic or guaranteed." },
  { id: "minimal_screening", points: 8, pattern: /\b(no interview|hired immediately|no resume required|no experience required)\b/i, reason: "The recruitment process appears to use very limited screening." }
];


export const METADATA_WEIGHTS = {
  "limited_text": 10,
  "insecure_or_invalid_page": 18,
  "shortened_application_link": 25,
  "external_application_domain": 18,
  "free_email_contact": 13,
  "messaging_contact": 12,
  "many_external_domains": 6,
  "extraction_uncertainty": 10
};
export const THRESHOLDS = Object.freeze({ uncertain: 30, elevated: 60 });
