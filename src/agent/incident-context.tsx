import { GlobalTools, Instruction, Text, Tool, useMessage, useSend, z, type ToolResult } from "curb";
import { INCIDENT_EVENT_KEY, INCIDENT_SNAPSHOT_KEY } from "../incident/events.js";
import { useIncident } from "../incident/store.js";

const verificationSchema = z.object({
  pin: z.string().trim().regex(/^\d{4}$/, "Ask the operator for a four-digit fictional demo PIN.")
    .describe("Four-digit fictional demo PIN supplied by the operator. Never guess it."),
});

export function IncidentContext() {
  const { incident, checkMetrics, inspectLogs, verifyOperator, executeRollback, dashboardSnapshot } = useIncident();
  const send = useSend();
  // A client may read state, but cannot supply state, a PIN or an authorization flag here.
  useMessage(INCIDENT_SNAPSHOT_KEY, {
    from: "client",
    schema: z.object({ version: z.literal(1) }).strict(),
    onMessage: () => dashboardSnapshot(),
  });
  function publish(action: () => ToolResult): ToolResult {
    const before = dashboardSnapshot().sequence;
    const result = action();
    for (const event of dashboardSnapshot().recentEvents.filter((event) => event.sequence > before)) {
      try {
        send.toClient(INCIDENT_EVENT_KEY, event);
      } catch {
        // Display delivery must never turn a completed recovery into a failed/retried tool.
        console.warn("[launch-night] Dashboard event delivery failed; request a fresh snapshot.");
      }
    }
    return result;
  }

  return (
    <>
      <Text>{`
        Launch Night — synthetic demo incident, with no connection to production infrastructure.
        Service: ${incident.service}
        Current deployment: ${incident.currentDeployment}
        Previous stable deployment: ${incident.previousStableDeployment}
        Service health: ${incident.serviceHealth}
        Error rate: ${incident.errorRatePercent}%
        Incident status: ${incident.incidentStatus}
        Operator verified for this session: ${incident.operatorVerified ? "yes" : "no"}
        Original incident cause: ${incident.cause}
      `}</Text>

      {incident.incidentStatus === "resolved" ? (
        <Instruction>{`
          Report the simulated recovery: Checkout API is healthy on v2.4.0 with a 1.1% error rate.
          Offer to recheck metrics or inspect the synthetic log timeline. Explain that old failures are historical.
          Recovery is complete; no further rollback is available.
        `}</Instruction>
      ) : incident.operatorVerified ? (
        <Instruction>{`
          The demo operator is verified. Recovery is available through execute_rollback.
          Explain that it simulates returning Checkout API to v2.4.0. Run it when the operator requests rollback or recovery.
        `}</Instruction>
      ) : (
        <Instruction>{`
          Investigate the simulated incident with check_metrics and inspect_logs.
          Recovery is locked until verify_operator validates the operator's fictional demo PIN.
          If asked to roll back, explain that verification is required first and ask for the demo PIN.
        `}</Instruction>
      )}

      <GlobalTools>
        <Tool name="check_metrics" description="Read current synthetic Checkout API error rate, health, incident state and deployment information." onSubmit={() => publish(checkMetrics)} />
        <Tool name="inspect_logs" description="Read synthetic checkout logs showing failures after v2.4.1, plus recovery entries after a simulated rollback." onSubmit={() => publish(inspectLogs)} />
        <Tool name="verify_operator" description="Validate the operator-supplied fictional demo PIN in code to unlock simulated recovery for this session. This is demo verification only."
          schema={verificationSchema} tryWith={{ pin: "2468" }} onSubmit={({ pin }) => publish(() => verifyOperator(pin))} />

        {/* Structural capability gate: rollback is absent from the model's tools until verification. */}
        {incident.operatorVerified && incident.incidentStatus === "active" ? (
          <Tool name="execute_rollback" description="SIMULATED rollback of Checkout API from v2.4.1 to stable v2.4.0. Updates only this demo session to healthy with 1.1% errors."
            confirm={() => "Confirm the simulated Checkout API rollback from v2.4.1 to v2.4.0?"}
            onSubmit={() => publish(executeRollback)} />
        ) : null}
      </GlobalTools>
    </>
  );
}
