import type { BoardItem } from "../types";

export type ProjectTemplateId = "blank" | "obby" | "simulator" | "rounds" | "rpg" | "tycoon";

type StarterItem = Pick<BoardItem, "title" | "detail" | "kind" | "priority">;

export type ProjectTemplate = {
  id: ProjectTemplateId;
  label: string;
  description: string;
  items: StarterItem[];
};

export const projectTemplates: ProjectTemplate[] = [
  { id: "blank", label: "Blank project", description: "Start with an empty board and add only what you need.", items: [] },
  {
    id: "obby", label: "Obby", description: "Plan a playable obstacle course from checkpoints to release.",
    items: [
      { title: "Sketch the first course route", detail: "Outline the start, major obstacles, checkpoints, and finish.", kind: "Mechanic", priority: "High" },
      { title: "Build checkpoints and respawn flow", detail: "Test checkpoint activation and respawning after a fall.", kind: "Feature", priority: "High" },
      { title: "Add obstacle variety", detail: "Mix timing, movement, and observation challenges.", kind: "Feature", priority: "Medium" },
      { title: "Playtest difficulty and mobile controls", detail: "Record confusing jumps and device-specific issues.", kind: "Bug", priority: "Medium" },
      { title: "Release a playable first course", detail: "Confirm the start-to-finish route works for a new player.", kind: "Milestone", priority: "High" },
    ],
  },
  {
    id: "simulator", label: "Simulator", description: "Set up the core loop, upgrades, rewards, and progression.",
    items: [
      { title: "Define the repeatable core action", detail: "Describe what players do repeatedly and why it feels rewarding.", kind: "Mechanic", priority: "High" },
      { title: "Design currency sources and sinks", detail: "List how currency is earned and what players spend it on.", kind: "Mechanic", priority: "High" },
      { title: "Plan the first upgrade path", detail: "Specify upgrade costs, effects, and unlock order.", kind: "Feature", priority: "Medium" },
      { title: "Save player progression", detail: "Plan what must persist between play sessions.", kind: "Feature", priority: "High" },
      { title: "Playtest the first progression curve", detail: "Check that early upgrades feel understandable and paced.", kind: "Milestone", priority: "Medium" },
    ],
  },
  {
    id: "rounds", label: "Round-based game", description: "Plan lobbies, round flow, maps, and win conditions.",
    items: [
      { title: "Define round states and transitions", detail: "List waiting, intermission, active round, and results behavior.", kind: "Mechanic", priority: "High" },
      { title: "Build the lobby and player queue", detail: "Decide how players enter a round and what happens if they leave.", kind: "Feature", priority: "High" },
      { title: "Choose the first map and objective", detail: "Write down the playable space and clear win condition.", kind: "Feature", priority: "High" },
      { title: "Handle ties, disconnects, and empty rounds", detail: "Document expected behavior for common edge cases.", kind: "Bug", priority: "Medium" },
      { title: "Run a complete round playtest", detail: "Test the full flow with multiple players from lobby to results.", kind: "Milestone", priority: "High" },
    ],
  },
  {
    id: "rpg", label: "RPG", description: "Organize quests, combat, inventory, and character progression.",
    items: [
      { title: "Outline the first playable area", detail: "Define its purpose, points of interest, and exit.", kind: "Mechanic", priority: "High" },
      { title: "Design the starter quest chain", detail: "List objectives, completion conditions, and rewards.", kind: "Feature", priority: "High" },
      { title: "Define combat rules and enemy behavior", detail: "Specify player actions, enemy attacks, and defeat conditions.", kind: "Mechanic", priority: "High" },
      { title: "Plan inventory and item progression", detail: "List item types and how players acquire or use them.", kind: "Feature", priority: "Medium" },
      { title: "Test saving character progress", detail: "Verify which quest, inventory, and progression data must persist.", kind: "Milestone", priority: "Medium" },
    ],
  },
  {
    id: "tycoon", label: "Tycoon", description: "Map plot ownership, income, unlocks, and saving.",
    items: [
      { title: "Map the first plot and purchase sequence", detail: "Order the first buttons, builds, and unlock dependencies.", kind: "Mechanic", priority: "High" },
      { title: "Build plot claiming and ownership checks", detail: "Ensure each player can control only their own plot.", kind: "Feature", priority: "High" },
      { title: "Balance the first income loop", detail: "Compare production rates with the cost and time of early unlocks.", kind: "Mechanic", priority: "Medium" },
      { title: "Save plot unlocks and player progress", detail: "Decide which purchases and upgrades persist between sessions.", kind: "Feature", priority: "High" },
      { title: "Test multiple players and plot resets", detail: "Check ownership, leaving, rejoining, and cleanup behavior.", kind: "Milestone", priority: "Medium" },
    ],
  },
];
