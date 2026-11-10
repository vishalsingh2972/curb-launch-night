import { scenario } from "curb/testing";
import { toolCalls } from "./assertions.js";

export default scenario({
  name: "investigation",
  turns: ["Checkout is failing during our launch. Investigate the metrics and recent logs, compare the deployments, and explain the likely cause. Do not roll back."],
  expect: ({ called, notCalled, check, transcript }) => [
    called("read_skill", { skill: "/incident-response" }),
    called("check_metrics"),
    called("inspect_logs"),
    notCalled("execute_rollback"),
    check("no rollback attempt or pending rollback", toolCalls(transcript, "execute_rollback").length === 0),
  ],
});
