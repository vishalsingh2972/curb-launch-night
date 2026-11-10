/** Pure demo logic. No network, clock, persistence or real infrastructure. */
export type IncidentState = {
  service: "Checkout API";
  currentDeployment: "v2.4.1" | "v2.4.0";
  previousStableDeployment: "v2.4.0";
  errorRatePercent: number;
  serviceHealth: "degraded" | "healthy";
  incidentStatus: "active" | "resolved";
  operatorVerified: boolean;
  cause: string;
};

export function createInitialIncident(): IncidentState {
  return {
    service: "Checkout API",
    currentDeployment: "v2.4.1",
    previousStableDeployment: "v2.4.0",
    errorRatePercent: 37.2,
    serviceHealth: "degraded",
    incidentStatus: "active",
    operatorVerified: false,
    cause: "Checkout errors started immediately after deployment v2.4.1.",
  };
}

export function readMetrics(state: IncidentState) {
  return {
    simulated: true,
    source: "Launch Night synthetic demo data",
    window: "simulated latest 60 seconds",
    ...state,
  };
}

export function readLogs(state: IncidentState) {
  // Relative offsets keep this fictional timeline independent of real dates and time.
  const entries = [
    { offset: "before deployment", level: "INFO", deployment: "v2.4.0", message: "POST /checkout 200 request_id=demo-001 duration_ms=142" },
    { offset: "deploy +0s", level: "INFO", deployment: "v2.4.1", message: "Deployment activated; checkout traffic switched to v2.4.1" },
    { offset: "deploy +2s", level: "ERROR", deployment: "v2.4.1", message: "POST /checkout 500 request_id=demo-002 error=CHECKOUT_CONFIG_MISMATCH missing_field=payment_timeout_ms" },
    { offset: "deploy +5s", level: "ERROR", deployment: "v2.4.1", message: "POST /checkout 500 request_id=demo-003 error=CHECKOUT_CONFIG_MISMATCH missing_field=payment_timeout_ms" },
    { offset: "deploy +60s", level: "WARN", deployment: "v2.4.1", message: "Checkout error rate 37.2%; failures began after the latest deployment" },
  ];
  if (state.incidentStatus === "resolved") {
    entries.push(
      { offset: "after simulated rollback", level: "INFO", deployment: "v2.4.0", message: "Simulated rollback completed; traffic returned to v2.4.0" },
      { offset: "recovery +60s", level: "INFO", deployment: "v2.4.0", message: "POST /checkout 200 request_id=demo-004 duration_ms=139; synthetic window error rate 1.1%; service healthy" },
    );
  }
  return {
    simulated: true,
    source: "Launch Night synthetic demo logs",
    note: "Historical failures remain in this timeline after recovery. Current health is reported separately.",
    currentDeployment: state.currentDeployment,
    serviceHealth: state.serviceHealth,
    errorRatePercent: state.errorRatePercent,
    entries,
  };
}

type Transition = {
  state: IncidentState;
  result: { ok: boolean; message: string; data: ReturnType<typeof readMetrics> };
};

export function verifyOperator(state: IncidentState, pin: string): Transition {
  // Public, fictional demo credential: this is not production authentication.
  if (pin !== "2468") {
    return {
      state,
      result: { ok: false, message: "Demo PIN is incorrect. Ask the operator for the fictional demo PIN and try again.", data: readMetrics(state) },
    };
  }
  const next = { ...state, operatorVerified: true };
  return {
    state: next,
    result: { ok: true, message: "Demo operator verified for this session. Recovery is available if the incident is still active; wait for the operator's rollback request.", data: readMetrics(next) },
  };
}

export function executeRollback(state: IncidentState): Transition {
  // Defense in depth: verify inside the handler's transition as well as JSX.
  if (!state.operatorVerified) {
    return {
      state,
      result: { ok: false, message: "Simulated rollback blocked. Ask the operator to complete verify_operator first.", data: readMetrics(state) },
    };
  }
  if (state.incidentStatus === "resolved") {
    return {
      state,
      result: { ok: true, message: "The simulated incident is already recovered. No deployment was changed.", data: readMetrics(state) },
    };
  }
  const next: IncidentState = {
    ...state,
    currentDeployment: state.previousStableDeployment,
    serviceHealth: "healthy",
    incidentStatus: "resolved",
    errorRatePercent: 1.1,
  };
  return {
    state: next,
    result: { ok: true, message: "Simulated rollback completed from v2.4.1 to v2.4.0. Checkout API is healthy with a synthetic error rate of 1.1%. No real systems were changed.", data: readMetrics(next) },
  };
}
