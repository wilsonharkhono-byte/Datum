export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      area_gate_status: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          area_id: string
          blocking_reason: string | null
          created_at: string
          current_owner_id: string | null
          gate_code: Database["public"]["Enums"]["gate_code"]
          last_recomputed_at: string | null
          project_id: string
          readiness_score: number | null
          status: Database["public"]["Enums"]["readiness_state"]
          target_end_date: string | null
          target_start_date: string | null
          updated_at: string
        }
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          area_id: string
          blocking_reason?: string | null
          created_at?: string
          current_owner_id?: string | null
          gate_code: Database["public"]["Enums"]["gate_code"]
          last_recomputed_at?: string | null
          project_id: string
          readiness_score?: number | null
          status?: Database["public"]["Enums"]["readiness_state"]
          target_end_date?: string | null
          target_start_date?: string | null
          updated_at?: string
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          area_id?: string
          blocking_reason?: string | null
          created_at?: string
          current_owner_id?: string | null
          gate_code?: Database["public"]["Enums"]["gate_code"]
          last_recomputed_at?: string | null
          project_id?: string
          readiness_score?: number | null
          status?: Database["public"]["Enums"]["readiness_state"]
          target_end_date?: string | null
          target_start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "area_gate_status_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_gate_status_current_owner_id_fkey"
            columns: ["current_owner_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_gate_status_gate_code_fkey"
            columns: ["gate_code"]
            isOneToOne: false
            referencedRelation: "gates"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "area_gate_status_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      areas: {
        Row: {
          area_code: string
          area_name: string
          area_sqm: number | null
          area_type: Database["public"]["Enums"]["area_type"]
          created_at: string
          floor: string | null
          id: string
          project_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          area_code: string
          area_name: string
          area_sqm?: number | null
          area_type?: Database["public"]["Enums"]["area_type"]
          created_at?: string
          floor?: string | null
          id?: string
          project_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          area_code?: string
          area_name?: string
          area_sqm?: number | null
          area_type?: Database["public"]["Enums"]["area_type"]
          created_at?: string
          floor?: string | null
          id?: string
          project_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "areas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      gate_checkpoint_templates: {
        Row: {
          created_at: string
          gate_code: Database["public"]["Enums"]["gate_code"]
          id: string
          item_text: string
          required: boolean
          sort_order: number
        }
        Insert: {
          created_at?: string
          gate_code: Database["public"]["Enums"]["gate_code"]
          id?: string
          item_text: string
          required?: boolean
          sort_order?: number
        }
        Update: {
          created_at?: string
          gate_code?: Database["public"]["Enums"]["gate_code"]
          id?: string
          item_text?: string
          required?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "gate_checkpoint_templates_gate_code_fkey"
            columns: ["gate_code"]
            isOneToOne: false
            referencedRelation: "gates"
            referencedColumns: ["code"]
          },
        ]
      }
      gates: {
        Row: {
          active_weeks: unknown
          code: Database["public"]["Enums"]["gate_code"]
          created_at: string
          description: string | null
          name: string
          sort_order: number
        }
        Insert: {
          active_weeks?: unknown
          code: Database["public"]["Enums"]["gate_code"]
          created_at?: string
          description?: string | null
          name: string
          sort_order: number
        }
        Update: {
          active_weeks?: unknown
          code?: Database["public"]["Enums"]["gate_code"]
          created_at?: string
          description?: string | null
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      project_events: {
        Row: {
          actor_staff_id: string | null
          body: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          project_id: string
          related_area_id: string | null
          related_gate: Database["public"]["Enums"]["gate_code"] | null
          source_id: string | null
          source_type: string | null
          title: string
        }
        Insert: {
          actor_staff_id?: string | null
          body?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          project_id: string
          related_area_id?: string | null
          related_gate?: Database["public"]["Enums"]["gate_code"] | null
          source_id?: string | null
          source_type?: string | null
          title: string
        }
        Update: {
          actor_staff_id?: string | null
          body?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          project_id?: string
          related_area_id?: string | null
          related_gate?: Database["public"]["Enums"]["gate_code"] | null
          source_id?: string | null
          source_type?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_events_actor_staff_id_fkey"
            columns: ["actor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_events_related_area_id_fkey"
            columns: ["related_area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
        ]
      }
      project_gates: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          created_at: string
          gate_code: Database["public"]["Enums"]["gate_code"]
          project_id: string
          target_end_date: string | null
          target_start_date: string | null
          updated_at: string
        }
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          created_at?: string
          gate_code: Database["public"]["Enums"]["gate_code"]
          project_id: string
          target_end_date?: string | null
          target_start_date?: string | null
          updated_at?: string
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          created_at?: string
          gate_code?: Database["public"]["Enums"]["gate_code"]
          project_id?: string
          target_end_date?: string | null
          target_start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_gates_gate_code_fkey"
            columns: ["gate_code"]
            isOneToOne: false
            referencedRelation: "gates"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "project_gates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_staff: {
        Row: {
          active_from: string
          active_until: string | null
          cost_visible: boolean
          created_at: string
          project_id: string
          role_on_project: string
          staff_id: string
        }
        Insert: {
          active_from?: string
          active_until?: string | null
          cost_visible?: boolean
          created_at?: string
          project_id: string
          role_on_project: string
          staff_id: string
        }
        Update: {
          active_from?: string
          active_until?: string | null
          cost_visible?: boolean
          created_at?: string
          project_id?: string
          role_on_project?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_staff_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_staff_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client_name: string | null
          created_at: string
          id: string
          kickoff_date: string | null
          location: string | null
          pic_id: string | null
          principal_id: string | null
          project_code: string
          project_name: string
          search_aliases: Json
          site_address: string | null
          status: Database["public"]["Enums"]["project_status"]
          target_handover: string | null
          updated_at: string
        }
        Insert: {
          client_name?: string | null
          created_at?: string
          id?: string
          kickoff_date?: string | null
          location?: string | null
          pic_id?: string | null
          principal_id?: string | null
          project_code: string
          project_name: string
          search_aliases?: Json
          site_address?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_handover?: string | null
          updated_at?: string
        }
        Update: {
          client_name?: string | null
          created_at?: string
          id?: string
          kickoff_date?: string | null
          location?: string | null
          pic_id?: string | null
          principal_id?: string | null
          project_code?: string
          project_name?: string
          search_aliases?: Json
          site_address?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_handover?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_pic_id_fkey"
            columns: ["pic_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_principal_id_fkey"
            columns: ["principal_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      record_revisions: {
        Row: {
          actor_staff_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          new_payload: Json | null
          previous_payload: Json | null
          project_id: string
          reason: string | null
          revision_type: Database["public"]["Enums"]["revision_type"]
        }
        Insert: {
          actor_staff_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          new_payload?: Json | null
          previous_payload?: Json | null
          project_id: string
          reason?: string | null
          revision_type: Database["public"]["Enums"]["revision_type"]
        }
        Update: {
          actor_staff_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          new_payload?: Json | null
          previous_payload?: Json | null
          project_id?: string
          reason?: string | null
          revision_type?: Database["public"]["Enums"]["revision_type"]
        }
        Relationships: [
          {
            foreignKeyName: "record_revisions_actor_staff_id_fkey"
            columns: ["actor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_revisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          active: boolean
          cost_visible: boolean
          created_at: string
          email: string | null
          full_name: string
          id: string
          role: Database["public"]["Enums"]["staff_role"]
          updated_at: string
          whatsapp_number: string | null
        }
        Insert: {
          active?: boolean
          cost_visible?: boolean
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          role: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
          whatsapp_number?: string | null
        }
        Update: {
          active?: boolean
          cost_visible?: boolean
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
          whatsapp_number?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_can_read_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      current_cost_visible_for: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      current_has_cross_project_read: { Args: never; Returns: boolean }
      current_is_assigned: { Args: { p_project_id: string }; Returns: boolean }
      current_staff_id: { Args: never; Returns: string }
    }
    Enums: {
      area_type:
        | "bathroom"
        | "kitchen"
        | "bedroom"
        | "living"
        | "dining"
        | "garden"
        | "circulation"
        | "utility"
        | "general"
      gate_code: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H"
      project_status:
        | "design"
        | "construction"
        | "finishing"
        | "handover"
        | "closed"
      readiness_state:
        | "not_started"
        | "in_progress"
        | "ready_for_handoff"
        | "blocked"
        | "passed"
        | "not_applicable"
      revision_type:
        | "created"
        | "corrected"
        | "superseded"
        | "approved"
        | "rejected"
      staff_role:
        | "principal"
        | "designer"
        | "pic"
        | "site_supervisor"
        | "admin"
        | "estimator"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      area_type: [
        "bathroom",
        "kitchen",
        "bedroom",
        "living",
        "dining",
        "garden",
        "circulation",
        "utility",
        "general",
      ],
      gate_code: ["A", "B", "C", "D", "E", "F", "G", "H"],
      project_status: [
        "design",
        "construction",
        "finishing",
        "handover",
        "closed",
      ],
      readiness_state: [
        "not_started",
        "in_progress",
        "ready_for_handoff",
        "blocked",
        "passed",
        "not_applicable",
      ],
      revision_type: [
        "created",
        "corrected",
        "superseded",
        "approved",
        "rejected",
      ],
      staff_role: [
        "principal",
        "designer",
        "pic",
        "site_supervisor",
        "admin",
        "estimator",
      ],
    },
  },
} as const
