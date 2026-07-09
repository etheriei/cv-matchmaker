// Local (browser) persistence for tailoring history and saved CV profiles.
// Uses localStorage; no auth required.

export type TailorResult = {
  tailoredCv: string;
  improvements: string[];
  ats: unknown;
  fit: unknown;
  keywordGap: unknown;
  positioningLine: string;
  coverLetter: string;
  fabrication?: { flagged: string[]; note: string } | null;
};

export type HistoryEntry = {
  id: string;
  createdAt: number;
  jobTitle: string;
  jobDescription: string;
  cvText: string;
  result: TailorResult;
};

export type CvProfile = {
  id: string;
  name: string;
  cvText: string;
  createdAt: number;
};

const HISTORY_KEY = "cvfoundry.history.v1";
const PROFILES_KEY = "cvfoundry.profiles.v1";
const MAX_HISTORY = 20;

function safeGet<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSet<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded – ignore
  }
}

export const listHistory = (): HistoryEntry[] => safeGet<HistoryEntry[]>(HISTORY_KEY, []);

export const addHistory = (entry: Omit<HistoryEntry, "id" | "createdAt">) => {
  const all = listHistory();
  const item: HistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  const next = [item, ...all].slice(0, MAX_HISTORY);
  safeSet(HISTORY_KEY, next);
  return item;
};

export const removeHistory = (id: string) => {
  safeSet(HISTORY_KEY, listHistory().filter((h) => h.id !== id));
};

export const clearHistory = () => safeSet(HISTORY_KEY, []);

export const listProfiles = (): CvProfile[] => safeGet<CvProfile[]>(PROFILES_KEY, []);

export const saveProfile = (name: string, cvText: string): CvProfile => {
  const all = listProfiles();
  const item: CvProfile = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || "Untitled",
    cvText,
    createdAt: Date.now(),
  };
  safeSet(PROFILES_KEY, [item, ...all].slice(0, 10));
  return item;
};

export const removeProfile = (id: string) => {
  safeSet(PROFILES_KEY, listProfiles().filter((p) => p.id !== id));
};
