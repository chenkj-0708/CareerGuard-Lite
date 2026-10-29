// Thesis Table 4.7 and Equations 4.1-4.6; new configuration, not a retrospective test-set repair.
export const RULE_VERSION = "thesis-v1.0.0";
export const CONFIG_ID = "thesis-primary-50-50-v1";
export const THRESHOLDS = Object.freeze({ uncertain: 30, elevated: 60 });
export const BRANCH_MAX = Object.freeze({ text: 101, metadata: 49 });
export const TEXT_RULES = [
  { id: "TXT_ADVANCE_FEE", points: 30, pattern: /\b(?:registration fee|processing fee|training fee|advance fee|upfront fee|security deposit|(?:pay|payment)\b.{0,40}\b(?:fee|deposit)|send (?:money|payment)|transfer (?:money|funds)|gift card|cryptocurrency|(?:purchase|buy) equipment)\b/gi, reason: "The listing contains an applicant money or value request cue." },
  { id: "TXT_SENSITIVE", points: 20, pattern: /\b(?:bank account|credit card|passport|identity card|social security|otp|one[- ]time password)\b/gi, reason: "The listing contains a sensitive-information request cue." },
  { id: "TXT_PRESSURE", points: 12, pattern: /\b(?:urgent hiring|act now|immediate start|limited slots|respond immediately|today only)\b/gi, reason: "The listing contains a pressure or urgency cue." },
  { id: "TXT_OFFPLATFORM", points: 15, pattern: /\b(?:whatsapp|telegram|signal app|wechat|contact via chat|message me directly)\b/gi, reason: "The listing contains an off-platform recruitment contact cue." },
  { id: "TXT_INCOME", points: 16, pattern: /\b(?:guaranteed income|earn\s+(?:[$£€]|RM\s*|MYR\s*)?\d[\d,]*(?:\.\d+)?[kK]?\s+(?:daily|per day)|no experience.{0,25}high (?:pay|salary)|get rich|unlimited earnings)\b/gi, reason: "The listing contains an unrealistic or guaranteed-income cue." },
  { id: "TXT_SCREENING", points: 8, pattern: /\b(?:no interview|hired immediately|no resume required)\b/gi, reason: "The listing contains a minimal-screening cue." }
];
export const METADATA_RULES = [
  { id: "META_INSECURE", points: 10, role: "scored", reason: "The listing uses HTTP rather than HTTPS." },
  { id: "META_SHORTENER", points: 25, role: "scored", reason: "An application link uses a shortened destination." },
  { id: "META_EXTERNAL_APP", points: 0, role: "context", reason: "An application goes to a different registrable domain; legitimate ATS routing can do this." },
  { id: "META_PUBLIC_EMAIL", points: 8, role: "scored", reason: "Recruitment contact uses a public email provider." },
  { id: "META_MESSAGING", points: 0, role: "context", reason: "The selected listing contains a messaging contact cue." },
  { id: "META_MANY_DOMAINS", points: 6, role: "scored", reason: "The selected listing links to at least eight distinct external registrable domains." },
  { id: "META_EXTRACTION_LOW", points: 0, role: "uncertainty", reason: "Extraction coverage is limited; this is not risk evidence." }
];
export const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "cutt.ly", "rb.gy"]);
export const FREE_EMAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "proton.me", "protonmail.com"]);
export const DUPLICATE_MESSAGE = "Similar listing content appears on multiple domains. This can occur through legitimate syndication or reposting and is not proof of fraud.";
