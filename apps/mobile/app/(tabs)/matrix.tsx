import { View, Text, FlatList } from "react-native";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Row = { id: string; project_code: string; project_name: string };

export default function MatrixTab() {
  const [projects, setProjects] = useState<Row[]>([]);
  useEffect(() => {
    supabase
      .from("projects")
      .select("id, project_code, project_name")
      .order("project_code")
      .then(({ data }) => setProjects(data ?? []));
  }, []);
  return (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 12 }}>Proyek</Text>
      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <View style={{ padding: 12, borderWidth: 1, borderColor: "#e5e5e5", borderRadius: 6, marginBottom: 8 }}>
            <Text style={{ fontWeight: "500" }}>{item.project_code}</Text>
            <Text>{item.project_name}</Text>
          </View>
        )}
      />
    </View>
  );
}
