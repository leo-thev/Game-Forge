export type Section =
  | "overview"
  | "scripts"
  | "assets"
  | "generator"
  | "design"
  | "workspace"
  | "analytics"
  | "docs"
  | "settings";

export type Language = "en" | "fr";

export type Translator = (text: string) => string;

export type ScriptItem = {
  id: string;
  name: string;
  category: string;
  code: string;
  updatedAt: string;
  favorite: boolean;
  history?: ScriptVersion[];
};

export type ScriptVersion = { name: string; code: string; savedAt: string };

export type AssetCategory =
  | "Models"
  | "Animations"
  | "Sounds"
  | "Decals"
  | "Images"
  | "Meshes"
  | "Plugins";

export type AssetItem = {
  id: string;
  assetId: string;
  name: string;
  description: string;
  category: AssetCategory;
  collection: string;
  notes: string;
  favorite: boolean;
  imageUrl?: string;
}

export type Project = {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  ownerId?: string;
  role?: "owner" | "co-owner" | "editor";
  memberCount?: number;
  logoUrl?: string;
};

export type ProjectRole =
  | "Owner"
  | "Co-owner"
  | "UI/UX designer"
  | "Builder"
  | "Scripter"
  | "Modeler"
  | "Animator"
  | "SFX designer"
  | "Sound artist"
  | "Commercial manager";

export type ProjectTeamMember = {
  id: string;
  displayName: string;
  roles: ProjectRole[];
  isProjectOwner: boolean;
};

export type UsageStats = {
  totalVisits: number;
  accountsCreated: number;
  activeUsers7d: number;
  activeUsers30d: number;
  lastActivityAt: string | null;
};

export type BoardItem = {
  id: string;
  title: string;
  detail: string;
  kind: "Feature" | "Mechanic" | "Bug" | "Milestone" | "Note";
  priority: "Low" | "Medium" | "High";
  status: "Backlog" | "In progress" | "Done";
  projectId: string;
  roles: ProjectRole[];
  dueDate?: string;
};

export type ProjectResource = {
  id: string;
  projectId: string;
  sourceId: string;
  kind: "Script" | "Asset";
  title: string;
  description: string;
  category: string;
  code?: string;
  assetId?: string;
  imageUrl?: string;
  linkedAt: string;
};

export type Preferences = {
  compactSidebar: boolean;
  accent: "blue";
  editorFontSize: number;
  language: Language;
  theme: "dark" | "light";
};

export type AppData = {
  scripts: ScriptItem[];
  assets: AssetItem[];
  projects: Project[];
  board: BoardItem[];
  projectResources: ProjectResource[];
  collections: string[];
  preferences: Preferences;
};
