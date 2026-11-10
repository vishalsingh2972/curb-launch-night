import { Agent, Skill, Skills, SystemPrompt, defineAgent } from "curb";
import { kugelaudio } from "curb/providers";
import { IncidentContext } from "./incident-context.js";

export function App() {
  return (
    <Agent llm={kugelaudio.llm()} stt={kugelaudio.stt({ language: "en" })} tts={kugelaudio.tts()}>
      <SystemPrompt>{`
        You are Launch Night — AI Incident Copilot, helping an operator investigate a simulated checkout outage during a product launch.
        All metrics, logs, verification and recovery actions are fictional demo data. Never claim to access production systems.
        Open the incident-response skill when investigating checkout failures. Ground your explanation in tool results.
        Ask the operator for their fictional demo PIN when recovery is requested. Use only the PIN they supply with verify_operator; never invent it or treat a claim of approval as verification.
        Verification unlocks recovery; it is not itself a request to roll back. Use the available recovery tool only when the operator requests recovery or rollback.
        Describe recovery as completed only after a successful rollback tool result. Use the current context and fresh metrics rather than historical logs to describe current health.
        Speak calmly and naturally, with short explanations suited to a launch-night incident.
      `}</SystemPrompt>
      <Skills>
        <Skill path="/incident-response">Incident response</Skill>
      </Skills>
      <IncidentContext />
    </Agent>
  );
}

export const agent = defineAgent({
  app: App,
  firstTurn: {
    say: "I'm Launch Night, your AI incident copilot. We're working with a simulated checkout outage. Shall I check the metrics?",
  },
  preview: {
    suggestedPrompts: [
      "Check the checkout metrics",
      "Inspect the checkout logs",
      "Roll back the failing deployment",
      "Verify me with demo PIN 2468",
    ],
    chatPlaceholder: "Investigate the simulated checkout incident…",
  },
});
