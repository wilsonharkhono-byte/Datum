import { View, Text, Pressable } from "react-native";
import { supabase } from "@/lib/supabase/client";

export default function MoreTab() {
  return (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 16, marginBottom: 16 }}>Lainnya</Text>
      <Pressable onPress={() => supabase.auth.signOut()}>
        <Text style={{ color: "#a00" }}>Logout</Text>
      </Pressable>
    </View>
  );
}
