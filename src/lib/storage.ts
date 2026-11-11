import type { AppData } from "../types";

const STORAGE_KEY = "gameforge.workspace.v1";
const LEGACY_STORAGE_KEY = STORAGE_KEY;
const LANGUAGE_KEY = "gameforge.language";

export const emptyData: AppData = {
  scripts: [],
  assets: [],
  projects: [],
  board: [],
  projectResources: [],
  collections: ["Favorites"],
  preferences: { compactSidebar: false, accent: "blue", editorFontSize: 13, language: "fr", theme: "dark" },
};

export function loadData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyData;
  try {
    const saved = JSON.parse(raw) as Partial<AppData>;
    return {
      ...emptyData,
      ...saved,
      scripts: Array.isArray(saved.scripts) ? saved.scripts : [],
      assets: Array.isArray(saved.assets) ? saved.assets : [],
      projects: Array.isArray(saved.projects) ? saved.projects : [],
      board: Array.isArray(saved.board) ? saved.board.map(item => ({
        ...item,
        roles: Array.isArray(item.roles) && item.roles.length ? item.roles : ["Owner"],
      })) : [],
      projectResources: Array.isArray(saved.projectResources) ? saved.projectResources : [],
      collections: Array.isArray(saved.collections) && saved.collections.length ? saved.collections : ["Favorites"],
      preferences: {
        ...emptyData.preferences,
        ...saved.preferences,
        accent: "blue",
        language: saved.preferences?.language === "en" ? "en" : "fr",
        theme: saved.preferences?.theme === "light" ? "light" : "dark",
      },
    };
  } catch (error) {
    console.error("GAMEFORGE could not read saved workspace data.", error);
    throw new Error("Saved workspace data is invalid. Export or reset the damaged browser storage to continue.");
  }
}

export function saveData(data: AppData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("GAMEFORGE could not save workspace data.", error);
    throw new Error("Workspace could not be saved. Check available browser storage.");
  }
}

export function clearLegacyData() {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export function loadLanguagePreference(fallback: AppData["preferences"]["language"]) {
  const saved = localStorage.getItem(LANGUAGE_KEY);
  return saved === "en" || saved === "fr" ? saved : fallback;
}

export function saveLanguagePreference(language: AppData["preferences"]["language"]) {
  localStorage.setItem(LANGUAGE_KEY, language);
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
