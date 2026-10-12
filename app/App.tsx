import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, SafeAreaView, StyleSheet, Text,
  TextInput, View, useColorScheme,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { chat, checkIn, loadSettings, pdfUrl, saveSettings, todayMessages, type Settings } from "./src/api";
import { authorize, syncHealth } from "./src/health";
import { registerBackgroundSync } from "./src/background";

interface Msg {
  id: string;
  role: "coach" | "me";
  text: string;
  pdf?: string;
}

export default function App() {
  const dark = useColorScheme() === "dark";
  const c = dark ? palette.dark : palette.light;
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<Msg>>(null);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  useEffect(() => {
    if (!settings) return;
    // The server runs the morning read on a schedule; show whatever is already waiting.
    todayMessages()
      .then(({ messages }) => setMsgs(messages.map((m, i) => ({ id: `h${i}`, role: m.role === "user" ? "me" : "coach", text: m.content }))))
      .catch(() => undefined);
    authorize()
      .then(() => syncHealth(30)) // first run backfills a month so baselines exist
      .then(registerBackgroundSync)
      .catch((e) => add("coach", `Health sync problem: ${String(e)}`));
  }, [settings]);

  const add = (role: Msg["role"], text: string, pdf?: string) =>
    setMsgs((m) => [...m, { id: `${Date.now()}-${m.length}`, role, text, pdf }]);

  async function run(label: string | null, fn: () => Promise<{ message: string; pdf?: string }>) {
    if (label) add("me", label);
    setBusy(true);
    try {
      await syncHealth(2).catch(() => undefined);
      const out = await fn();
      add("coach", out.message, out.pdf);
    } catch (e) {
      add("coach", `Could not reach the coach: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openPdf(path: string) {
    const { url, token } = await pdfUrl(path);
    Linking.openURL(`${url}?token=${encodeURIComponent(token)}`);
  }

  if (settings === undefined) return <View style={[s.fill, { backgroundColor: c.bg }]} />;
  if (settings === null) return <Setup c={c} onSave={async (v) => { await saveSettings(v); setSettings(v); }} />;

  return (
    <SafeAreaView style={[s.fill, { backgroundColor: c.bg }]}>
      <StatusBar style={dark ? "light" : "dark"} />
      <View style={s.header}>
        <Text style={[s.title, { color: c.ink }]}>Flow Coach</Text>
        <Pressable disabled={busy} onPress={() => run(null, checkIn)} style={[s.pill, { backgroundColor: c.accent }]}>
          <Text style={s.pillText}>Morning read</Text>
        </Pressable>
      </View>
      <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          ref={list}
          data={msgs}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View style={[s.bubble, item.role === "me" ? { alignSelf: "flex-end", backgroundColor: c.accent } : { backgroundColor: c.card }]}>
              <Text style={{ color: item.role === "me" ? "#fff" : c.ink, fontSize: 15, lineHeight: 21 }}>{item.text}</Text>
              {item.pdf && (
                <Pressable onPress={() => openPdf(item.pdf!)} style={[s.pdf, { borderColor: c.accent }]}>
                  <Text style={{ color: c.accent, fontWeight: "600" }}>Open workout PDF</Text>
                </Pressable>
              )}
            </View>
          )}
          ListEmptyComponent={<Text style={[s.empty, { color: c.muted }]}>Tap Morning read to get today's readiness and workout.</Text>}
        />
        {busy && <ActivityIndicator style={{ marginBottom: 8 }} />}
        <View style={[s.composer, { borderColor: c.line }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder='Reply, or "lock it in"'
            placeholderTextColor={c.muted}
            style={[s.input, { color: c.ink, backgroundColor: c.card }]}
            onSubmitEditing={() => { const t = input.trim(); if (t) { setInput(""); run(t, () => chat(t)); } }}
            returnKeyType="send"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Setup({ c, onSave }: { c: typeof palette.light; onSave: (s: Settings) => void }) {
  const [serverUrl, setUrl] = useState("");
  const [token, setToken] = useState("");
  return (
    <SafeAreaView style={[s.fill, { backgroundColor: c.bg, padding: 24, gap: 12 }]}>
      <Text style={[s.title, { color: c.ink }]}>Connect your coach</Text>
      <TextInput placeholder="Server URL" autoCapitalize="none" value={serverUrl} onChangeText={setUrl} style={[s.input, { color: c.ink, backgroundColor: c.card }]} placeholderTextColor={c.muted} />
      <TextInput placeholder="Access token" autoCapitalize="none" secureTextEntry value={token} onChangeText={setToken} style={[s.input, { color: c.ink, backgroundColor: c.card }]} placeholderTextColor={c.muted} />
      <Pressable onPress={() => onSave({ serverUrl: serverUrl.trim(), token: token.trim() })} style={[s.pill, { backgroundColor: c.accent, alignSelf: "flex-start" }]}>
        <Text style={s.pillText}>Save</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const palette = {
  light: { bg: "#F9FAFB", card: "#FFFFFF", ink: "#111827", muted: "#6B7280", line: "#E5E7EB", accent: "#2563EB" },
  dark: { bg: "#0B0F17", card: "#161B26", ink: "#F3F4F6", muted: "#9CA3AF", line: "#273041", accent: "#3B82F6" },
};

const s = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 22, fontWeight: "700" },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  pillText: { color: "#fff", fontWeight: "600" },
  bubble: { maxWidth: "88%", borderRadius: 14, padding: 12 },
  pdf: { marginTop: 10, borderWidth: 1, borderRadius: 10, padding: 10, alignItems: "center" },
  empty: { textAlign: "center", marginTop: 40 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 10 },
  input: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
});
