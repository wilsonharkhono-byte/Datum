import { useState, useRef } from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { supabase } from "@/lib/supabase/client";
import messages from "@/messages/id.json";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    setPending(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (error) Alert.alert(messages.login.error);
  }

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center", backgroundColor: "#fafaf9" }}>
      <Text style={{ fontSize: 22, fontWeight: "600", marginBottom: 24 }}>{messages.login.title}</Text>
      <Text style={{ marginBottom: 4 }}>{messages.login.email}</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        blurOnSubmit={false}
        testID="login-email-input"
        style={{ borderWidth: 1, borderColor: "#d6d3d1", borderRadius: 6, padding: 12, marginBottom: 16, backgroundColor: "#fff" }}
      />
      <Text style={{ marginBottom: 4 }}>{messages.login.password}</Text>
      <TextInput
        ref={passwordRef}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        returnKeyType="done"
        onSubmitEditing={submit}
        testID="login-password-input"
        style={{ borderWidth: 1, borderColor: "#d6d3d1", borderRadius: 6, padding: 12, marginBottom: 24, backgroundColor: "#fff" }}
      />
      <Pressable
        onPress={submit}
        disabled={pending || !email || !password}
        style={{
          backgroundColor: pending ? "#a8a29e" : "#1c1917",
          borderRadius: 6, padding: 14, alignItems: "center",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "500" }}>
          {pending ? messages.login.loading : messages.login.submit}
        </Text>
      </Pressable>
    </View>
  );
}
