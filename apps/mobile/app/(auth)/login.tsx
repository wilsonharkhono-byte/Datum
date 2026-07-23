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
    <View className="flex-1 justify-center bg-bg px-6">
      <View className="rounded-lg border border-border bg-surface p-6">
        <Text className="font-bold text-[13px] uppercase tracking-widest text-text-muted">
          DATUM
        </Text>
        <Text className="mb-6 mt-1 font-semibold text-[22px] text-text">
          {messages.login.title}
        </Text>
        <Text className="mb-1 font-medium text-[12px] uppercase tracking-wide text-text-sec">
          {messages.login.email}
        </Text>
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
          className="mb-4 min-h-[48px] rounded border border-border bg-surface-alt px-3 font-sans text-[15px] text-text"
        />
        <Text className="mb-1 font-medium text-[12px] uppercase tracking-wide text-text-sec">
          {messages.login.password}
        </Text>
        <TextInput
          ref={passwordRef}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          returnKeyType="done"
          onSubmitEditing={submit}
          testID="login-password-input"
          className="mb-6 min-h-[48px] rounded border border-border bg-surface-alt px-3 font-sans text-[15px] text-text"
        />
        <Pressable
          onPress={submit}
          disabled={pending || !email || !password}
          className={`min-h-[48px] items-center justify-center rounded ${
            pending || !email || !password ? "bg-text-muted" : "bg-primary"
          } active:opacity-80`}
        >
          <Text className="font-semibold text-[14px] text-surface">
            {pending ? messages.login.loading : messages.login.submit}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
