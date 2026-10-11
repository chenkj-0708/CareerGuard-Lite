"""Generate controlled CareerGuard Lite synthetic job-listing fixtures."""

from __future__ import annotations

import csv
import html
import json
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent

UNCERTAIN_ROLES = [
    "Remote Administrative Assistant", "Junior Content Coordinator", "Customer Support Associate",
    "Online Research Assistant", "Entry-Level Marketing Assistant", "Data Processing Assistant",
    "Social Media Support Officer", "Operations Support Trainee", "Virtual Scheduling Assistant",
    "E-commerce Listing Assistant", "Junior Recruitment Coordinator", "Remote Project Assistant",
    "Business Support Associate", "Client Service Trainee", "Digital Records Assistant",
    "Online Sales Support Trainee", "Temporary Office Coordinator", "Remote Survey Assistant",
    "Junior Account Support Officer", "General Support Executive",
]

ELEVATED_ROLES = [
    "Urgent Data Entry Agent", "Work-from-Home Payment Processor", "Immediate Hiring Personal Assistant",
    "Crypto Account Support Agent", "Online Shopping Review Agent", "Remote Parcel Processing Officer",
    "Fast Income Marketing Agent", "Home-Based Transaction Assistant", "Urgent Recruitment Coordinator",
    "Remote Investment Support Trainee", "Instant Hire Customer Agent", "Digital Wallet Support Officer",
    "Overseas Job Registration Assistant", "Online Reshipping Coordinator", "Guaranteed Income Sales Agent",
    "Telegram Recruitment Assistant", "Remote Banking Verification Agent", "No-Interview Data Assistant",
    "International Transfer Assistant", "Immediate Start Freelance Clerk",
]

UNCERTAIN_VARIANTS = [
    {
        "signals": ["pressure_language", "minimal_screening", "external_application_domain"],
        "contact": "Applications are reviewed quickly because this is urgent hiring, and no experience required.",
        "apply_domain": "forms.candidate-intake.example",
        "email": "",
    },
    {
        "signals": ["pressure_language", "minimal_screening", "free_email_contact", "external_application_domain"],
        "contact": "Immediate start is preferred and no experience required. Send basic availability questions by email.",
        "apply_domain": "apply-now.example",
        "email": "hiringdesk@gmail.com",
    },
    {
        "signals": ["off_platform_contact", "minimal_screening", "messaging_contact", "external_application_domain"],
        "contact": "No experience required. Shortlisted applicants will receive the remaining details through WhatsApp.",
        "apply_domain": "candidate-chat.example",
        "email": "",
    },
    {
        "signals": ["pressure_language", "off_platform_contact", "messaging_contact", "external_application_domain"],
        "contact": "This is urgent hiring. Applicants may message the coordinator directly through Telegram for scheduling.",
        "apply_domain": "quick-forms.example",
        "email": "",
    },
]

ELEVATED_VARIANTS = [
    {
        "signals": ["advance_fee", "sensitive_information", "pressure_language", "off_platform_contact", "shortened_application_link", "free_email_contact"],
        "risk_text": "Urgent hiring. Contact us on WhatsApp. Applicants must pay a registration fee and provide bank account information before work begins.",
        "apply_url": "https://bit.ly/careerguard-synthetic",
        "email": "fastjobs@gmail.com",
    },
    {
        "signals": ["advance_fee", "sensitive_information", "minimal_screening", "off_platform_contact", "shortened_application_link"],
        "risk_text": "No interview and no experience required. Message the recruiter through Telegram, purchase equipment through our agent, and send passport details for activation.",
        "apply_url": "https://tinyurl.com/careerguard-synthetic",
        "email": "",
    },
    {
        "signals": ["advance_fee", "unrealistic_income", "pressure_language", "free_email_contact", "external_application_domain"],
        "risk_text": "Immediate start with guaranteed income. Limited slots are available. A processing fee is required before the first assignment is released.",
        "apply_url": "https://instant-career.example/register",
        "email": "opportunitydesk@yahoo.com",
    },
    {
        "signals": ["sensitive_information", "off_platform_contact", "minimal_screening", "messaging_contact", "external_application_domain"],
        "risk_text": "Hired immediately with no interview. Continue through WhatsApp, pay a registration fee, and submit your credit card and one-time password information for account verification.",
        "apply_url": "https://candidate-verification.example/apply",
        "email": "",
    },
]


def common_description(role: str) -> str:
    return (
        f"The {role} supports routine coordination, record updates, customer communication and weekly reporting. "
        "The worker should organise assigned tasks, communicate progress to the team and follow documented procedures. "
        "Working arrangements, supervision and final responsibilities will be discussed during the application process. "
        "The role also includes maintaining accurate records, attending scheduled team meetings and preparing short progress summaries for the assigned supervisor."
    )


def build_scenario(label: str, index: int, role: str, variant: dict) -> dict:
    identifier = f"{label}-{index:02d}"
    next_index = 1 if index == 20 else index + 1
    company = f"{('Prospect' if label == 'uncertain' else 'Rapid')} {index:02d} Solutions"
    source_url = f"https://jobs-{identifier}.example/listing/{identifier}"
    if label == "uncertain":
        body = common_description(role) + " " + variant["contact"]
        apply_url = f"https://{variant['apply_domain']}/application/{identifier}"
    else:
        body = common_description(role) + " " + variant["risk_text"]
        apply_url = variant["apply_url"] + f"-{index:02d}"
    return {
        "id": identifier,
        "next_file": f"{label}-{next_index:02d}.html",
        "label": label,
        "title": role,
        "company": company,
        "source_url": source_url,
        "apply_url": apply_url,
        "email": variant["email"],
        "signals": variant["signals"],
        "body": body,
    }


def render_html(scenario: dict) -> str:
    email = f'<p>Recruitment contact: {html.escape(scenario["email"])}</p>' if scenario["email"] else ""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="careerguard-fixture-source-url" content="{html.escape(scenario['source_url'])}">
  <meta name="careerguard-synthetic-label" content="{html.escape(scenario['label'])}">
  <title>{html.escape(scenario['title'])} - {html.escape(scenario['company'])}</title>
  <style>body{{font:16px/1.55 Arial,sans-serif;max-width:850px;margin:40px auto;padding:0 24px 40px;color:#172033}}.apply-button,.next-button{{display:inline-block;padding:10px 16px;color:#fff;text-decoration:none;border-radius:8px;font-weight:700}}.apply-button{{margin-top:12px;background:#176f58}}.next-navigation{{display:flex;justify-content:flex-end;margin-top:36px;padding-top:20px;border-top:1px solid #d8e0ea}}.next-button{{background:#173b67}}</style>
</head>
<body>
  <main itemscope itemtype="https://schema.org/JobPosting">
    <h1>{html.escape(scenario['title'])}</h1>
    <p class="company">{html.escape(scenario['company'])}</p>
    <h2>Job description</h2>
    <p>{html.escape(scenario['body'])}</p>
    <h2>Requirements</h2>
    <p>Applicants should communicate clearly, manage assigned tasks and be available during agreed working hours.</p>
    {email}
    <a class="apply-button" href="{html.escape(scenario['apply_url'])}" aria-label="Apply for this role">Apply now</a>
  </main>
  <nav class="next-navigation" aria-label="Synthetic listing navigation">
    <a class="next-button" href="{html.escape(scenario['next_file'])}">Next {html.escape(scenario['label'])} listing →</a>
  </nav>
</body>
</html>
"""


def main() -> None:
    scenarios = []
    for index, role in enumerate(UNCERTAIN_ROLES, 1):
        scenarios.append(build_scenario("uncertain", index, role, UNCERTAIN_VARIANTS[(index - 1) % len(UNCERTAIN_VARIANTS)]))
    for index, role in enumerate(ELEVATED_ROLES, 1):
        scenarios.append(build_scenario("elevated", index, role, ELEVATED_VARIANTS[(index - 1) % len(ELEVATED_VARIANTS)]))

    for scenario in scenarios:
        (OUTPUT / f"{scenario['id']}.html").write_text(render_html(scenario), encoding="utf-8")

    public = [{key: value for key, value in scenario.items() if key != "body"} for scenario in scenarios]
    (OUTPUT / "scenario_manifest.json").write_text(json.dumps(public, indent=2) + "\n", encoding="utf-8")
    with (OUTPUT / "scenario_manifest.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=["id", "next_file", "label", "title", "company", "source_url", "apply_url", "email", "signals"])
        writer.writeheader()
        for scenario in public:
            writer.writerow({**scenario, "signals": "|".join(scenario["signals"])})
    print(f"Generated {len(scenarios)} scenarios: 20 uncertain and 20 elevated.")


if __name__ == "__main__":
    main()
