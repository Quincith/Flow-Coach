// Talks to the Flow Coach server. Server URL and token are entered once in Settings and kept in the keychain.

import * as SecureStore from "expo-secure-store";
import type { DaySample } from "./aggregate";

export interface Settings {
  serverUrl: string;
  token: string;
}

export async function loadSettings(): Promise<Settings | null> {
  const raw = await SecureStore.getItemAsync("flow-settings");
  return raw ? (JSON.parse(raw) as Settings) : null;
}

export async function saveSettings(s: Settings): Promise<void> {
  await SecureStore.setItemAsync("flow-settings", JSON.stringify(s));
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const s = await loadSettings();
  if (!s) throw new Error("Add your server in Settings first.");
  const res = await fetch(`${s.serverUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: { Authorization: `Bearer ${s.token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const postHealth = (payload: { platform: "ios"; samples: DaySample[] }) => call<{ stored: number }>("POST", "/health", payload);
export const todayMessages = () => call<{ messages: { role: "user" | "assistant"; content: string }[] }>("GET", "/messages");
export const checkIn = () => call<{ message: string }>("POST", "/checkin");
export const chat = (text: string) => call<{ message: string; pdf?: string }>("POST", "/chat", { text });

export async function pdfUrl(path: string): Promise<{ url: string; token: string }> {
  const s = await loadSettings();
  return { url: `${s!.serverUrl.replace(/\/$/, "")}${path}`, token: s!.token };
}
