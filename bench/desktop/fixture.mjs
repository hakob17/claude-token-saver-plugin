// Material for the desktop-plugin benchmark: a long vendor contract with a few
// specific facts buried in boilerplate, and an email draft to revise.
import fs from "node:fs";
import path from "node:path";

// The facts the tasks ask about. Everything else in the contract is filler.
export const FACTS = {
  termination: "ninety (90) days' prior written notice",
  latePayment: "1.5% per month",
  liabilityCap: "the total Fees paid in the twelve (12) months preceding the claim",
  confidentialityCap: "two times (2x) the annual Fees",
  renewal: "renew automatically for successive twelve (12) month terms unless either party gives written notice of non-renewal at least sixty (60) days",
  sla: "99.9%",
  credits: "5%, 10% and 25%",
  dataReturn: "thirty (30) days",
  law: "the laws of the Netherlands",
  courts: "the competent courts of Amsterdam",
};

const TOPICS = [
  "Definitions", "Scope of Services", "Service Levels", "Customer Obligations", "Supplier Personnel",
  "Subcontracting", "Change Control", "Acceptance", "Fees and Invoicing", "Taxes", "Audit Rights",
  "Intellectual Property", "Licence Grants", "Confidentiality", "Data Protection", "Security",
  "Business Continuity", "Warranties", "Indemnities", "Limitation of Liability", "Insurance",
  "Term and Renewal", "Termination", "Consequences of Termination", "Exit Assistance", "Force Majeure",
  "Dispute Resolution", "Notices", "Assignment", "Anti-Bribery", "Export Control", "Publicity",
  "Non-Solicitation", "Third-Party Rights", "Entire Agreement", "Variation", "Waiver", "Severance",
  "Counterparts", "Governing Law",
];

const FILLER = [
  "Each party shall perform its obligations under this Clause in a timely, diligent and professional manner, in accordance with Good Industry Practice and all applicable laws, regulations and binding codes of practice.",
  "Nothing in this Clause shall operate to limit or exclude any right or remedy that either party may have under any other provision of this Agreement, save as expressly stated otherwise herein.",
  "The Supplier shall maintain complete and accurate records relating to the matters described in this Clause and shall make such records available to the Customer on reasonable written request.",
  "Where any obligation in this Clause is expressed to be subject to the reasonable endeavours of a party, that party shall not be required to incur material unbudgeted expenditure in discharging it.",
  "The parties acknowledge that the provisions of this Clause have been negotiated at arm's length and reflect a fair allocation of commercial risk between them in the circumstances.",
  "Any approval or consent required under this Clause shall not be unreasonably withheld, conditioned or delayed, and shall be given in writing by an authorised representative of the relevant party.",
  "The Supplier shall promptly notify the Customer in writing of any matter which may reasonably be expected to affect its ability to comply with this Clause, together with proposed remedial steps.",
  "For the avoidance of doubt, references in this Clause to the Services include any part of the Services and any Deliverables provided in connection with them from time to time.",
  "Each party shall bear its own costs incurred in complying with this Clause unless expressly agreed otherwise in a Statement of Work executed by both parties.",
  "The obligations in this Clause shall continue to apply during any period of Exit Assistance and for such further period as is reasonably necessary to give effect to them.",
];

const SPECIFIC = {
  "Service Levels": `The Supplier shall make the Platform available ${FACTS.sla} of the time in each calendar month, excluding Scheduled Maintenance notified at least five (5) Business Days in advance. If monthly availability falls below the target, the Customer shall be entitled to service credits of ${FACTS.credits} of the monthly Fees where availability is below 99.9%, 99.5% and 99.0% respectively. Service credits are the Customer's sole financial remedy for availability failures, save where availability falls below 99.0% in any three (3) consecutive months, in which case the Customer may terminate for material breach.`,
  "Fees and Invoicing": `The Supplier shall invoice the Fees monthly in arrears. Undisputed invoices are payable within thirty (30) days of receipt. Late payments shall bear interest at ${FACTS.latePayment}, calculated daily from the due date until the date of actual payment.`,
  "Confidentiality": `Notwithstanding Clause 20 (Limitation of Liability), each party's aggregate liability for breach of this Clause 14 shall not exceed ${FACTS.confidentialityCap} payable under this Agreement.`,
  "Limitation of Liability": `Subject to Clauses 14 and 19, each party's total aggregate liability arising out of or in connection with this Agreement shall not exceed ${FACTS.liabilityCap}. Neither party shall be liable for indirect or consequential loss, loss of profit or loss of goodwill.`,
  "Term and Renewal": `This Agreement commences on the Effective Date and continues for an Initial Term of thirty-six (36) months. Thereafter it shall ${FACTS.renewal} before the end of the then-current term.`,
  "Termination": `Either party may terminate this Agreement for convenience on ${FACTS.termination} to the other party, provided that no such notice may expire before the end of the Initial Term. Either party may terminate immediately on written notice if the other commits a material breach which is incapable of remedy or is not remedied within thirty (30) days of notice requiring it to be remedied.`,
  "Consequences of Termination": `On termination or expiry, the Supplier shall make the Customer Data available for export for ${FACTS.dataReturn} and shall thereafter securely delete it, save as required by law.`,
  "Governing Law": `This Agreement and any dispute or claim arising out of it shall be governed by ${FACTS.law}, and the parties submit to the exclusive jurisdiction of ${FACTS.courts}.`,
};

export function contractText() {
  let out = `# MASTER SERVICES AGREEMENT\n\nBetween Northwind Analytics B.V. (the "Supplier") and Contoso Retail Ltd (the "Customer").\n\n`;
  TOPICS.forEach((topic, i) => {
    out += `## ${i + 1}. ${topic}\n\n`;
    const paras = [];
    for (let j = 0; j < 6; j++) {
      const a = FILLER[(i * 3 + j) % FILLER.length];
      const b = FILLER[(i * 7 + j * 3 + 1) % FILLER.length];
      paras.push(`${i + 1}.${j + 1} ${a} ${b}`);
    }
    if (SPECIFIC[topic]) paras.splice(2, 0, `${i + 1}.${paras.length + 1} ${SPECIFIC[topic]}`);
    out += paras.join("\n\n") + "\n\n";
  });
  return out;
}

export const EMAIL = `Subject: Q3 data platform migration — status and next steps

Hi Maria,

Thanks again for the time on Tuesday. I wanted to follow up in writing so we're all aligned before the steering committee next week, and so the wider team has a single place to look for where things stand.

Overall the migration is on track. The ingestion pipelines have been moved over, the nightly batch jobs are running on the new cluster, and the reconciliation reports for the last two weeks show no discrepancies above the agreed tolerance. The analytics team has started using the new warehouse for their weekly dashboards.

The one thing that is not on track is the reporting cutover, which honestly has been a mess on your side. Your team still hasn't signed off the test results we sent over on March 14, and because of that we've had to keep the old servers running for another month, which is costing us an extra €4,200 that frankly we shouldn't be paying. We need the sign-off by Friday or we'll have to escalate this to the steering committee.

On our side, we'll finish the access-control review and update the runbooks for the support team. We're also planning a short training session for the analysts in the first week of next month.

Let me know if there's anything you need from us.

Best regards,
Daniel
`;

export function writeMaterial(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "contract.md"), contractText());
  fs.writeFileSync(path.join(dir, "email.md"), EMAIL);
}
