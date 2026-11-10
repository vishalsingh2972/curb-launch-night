import { Instruction, type SkillMeta } from "curb";

export const meta: SkillMeta = {
  title: "Incident response",
  description: "Use FIRST when investigating a checkout outage, failed checkout requests, degraded service, deployment regressions, or whether rollback is justified. NOT for operator verification alone.",
};

export default function IncidentResponse() {
  return (
    <Instruction>{`
      Checkout incident runbook (synthetic demo data):
      1. Call check_metrics to establish current health, error rate and deployment. If already healthy after recovery, report that; do not recommend another rollback.
      2. Call inspect_logs for recent checkout errors. Separate historical failures from current health.
      3. Compare the failing deployment with the previous stable version and the log timeline.
      4. Explain the likely cause using that evidence: failures beginning just after v2.4.1, with CHECKOUT_CONFIG_MISMATCH, indicate a deployment regression. Describe this as a likely cause supported by the demo data.
      5. Recommend simulated rollback only when degraded metrics and post-deployment errors justify it. Explain the target stable version and verification requirement. Never promise that recovery has already happened.
      Keep the investigation concise. Operator verification and recovery permissions are managed outside this runbook.
    `}</Instruction>
  );
}
