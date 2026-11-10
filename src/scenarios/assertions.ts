import type { ScenarioTurn } from "curb/testing";
import type { readMetrics } from "../incident/simulation.js";

export function toolCalls(transcript: readonly ScenarioTurn[], name: string) {
  return transcript.flatMap((turn) => turn.toolCalls
    .filter((call) => call.name === name)
    .map((call) => ({ ...call, turn: turn.turn, confirmation: turn.confirmation })));
}

export function latestMetrics(transcript: readonly ScenarioTurn[]) {
  const call = toolCalls(transcript, "check_metrics").filter((call) => call.ok && !call.faked).at(-1);
  return call?.result?.data as ReturnType<typeof readMetrics> | undefined;
}

/** Require every executed rollback to follow a held call and a successful verification,
 * and to run on the turn where the framework records the caller's yes. */
export function rollbacksFollowConfirmation(transcript: readonly ScenarioTurn[]) {
  const rollbacks = toolCalls(transcript, "execute_rollback");
  const verified = toolCalls(transcript, "verify_operator").filter((call) => call.ok && !call.faked);
  const executed = rollbacks.filter((call) => call.ok);
  return executed.length > 0 && executed.every((call) =>
    !call.faked &&
    call.confirmation?.tool === "execute_rollback" &&
    call.confirmation.verdict === "yes" && call.confirmation.ran &&
    verified.some((verification) => verification.turn < call.turn) &&
    rollbacks.some((held) => held.heldFor !== undefined && !held.ok && held.turn < call.turn &&
      held.heldFor === call.confirmation?.readBack));
}
