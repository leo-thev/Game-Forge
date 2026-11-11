import type { ProjectRole } from "../types";

export const projectRoles: ProjectRole[] = [
  "Owner",
  "Co-owner",
  "UI/UX designer",
  "Builder",
  "Scripter",
  "Modeler",
  "Animator",
  "SFX designer",
  "Sound artist",
  "Commercial manager",
];

export const assignableProjectRoles = projectRoles.filter((role): role is Exclude<ProjectRole, "Owner"> => role !== "Owner");
