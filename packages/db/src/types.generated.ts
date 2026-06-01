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
      area_gate_blockers: {
        Row: {
          area_id: string
          blocker_type: Database["public"]["Enums"]["blocker_type"]
          created_at: string
          description: string | null
          gate_code: Database["public"]["Enums"]["gate_code"]
          id: string
          opened_at: string
          opened_by_staff_id: string | null
          owner_staff_id: string | null
          project_id: string
          related_record_id: string | null
          related_record_type: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by_staff_id: string | null
          status: Database["public"]["Enums"]["blocker_status"]
          updated_at: string
        }
        Insert: {
          area_id: string
          blocker_type: Database["public"]["Enums"]["blocker_type"]
          created_at?: string
          description?: string | null
          gate_code: Database["public"]["Enums"]["gate_code"]
          id?: string
          opened_at?: string
          opened_by_staff_id?: string | null
          owner_staff_id?: string | null
          project_id: string
          related_record_id?: string | null
          related_record_type?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by_staff_id?: string | null
          status?: Database["public"]["Enums"]["blocker_status"]
          updated_at?: string
        }
        Update: {
          area_id?: string
          blocker_type?: Database["public"]["Enums"]["blocker_type"]
          created_at?: string
          description?: string | null
          gate_code?: Database["public"]["Enums"]["gate_code"]
          id?: string
          opened_at?: string
          opened_by_staff_id?: string | null
          owner_staff_id?: string | null
          project_id?: string
          related_record_id?: string | null
          related_record_type?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by_staff_id?: string | null
          status?: Database["public"]["Enums"]["blocker_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "area_gate_blockers_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_gate_blockers_gate_code_fkey"
            columns: ["gate_code"]
            isOneToOne: false
            referencedRelation: "gates"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "area_gate_blockers_opened_by_staff_id_fkey"
            columns: ["opened_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_gate_blockers_owner_staff_id_fkey"
            columns: ["owner_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_gate_blockers_project_id_area_id_gate_code_fkey"
            columns: ["project_id", "area_id", "gate_code"]
            isOneToOne: false
            referencedRelation: "area_gate_status"
            referencedColumns: ["project_id", "area_id", "gate_code"]
          },
          {
            foreignKeyName: "area_gate_blockers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_gate_blockers_resolved_by_staff_id_fkey"
            columns: ["resolved_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      area_gate_checkpoints: {
        Row: {
          area_id: string
          created_at: string
          evidence_attachment_id: string | null
          gate_code: Database["public"]["Enums"]["gate_code"]
          id: string
          notes: string | null
          passed_at: string | null
          passed_by_staff_id: string | null
          project_id: string
          status: Database["public"]["Enums"]["checkpoint_status"]
          template_id: string
          updated_at: string
        }
        Insert: {
          area_id: string
          created_at?: string
          evidence_attachment_id?: string | null
          gate_code: Database["public"]["Enums"]["gate_code"]
          id?: string
          notes?: string | null
          passed_at?: string | null
          passed_by_staff_id?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["checkpoint_status"]
          template_id: string
          updated_at?: string
        }
        Update: {
          area_id?: string
          created_at?: string
          evidence_attachment_id?: string | null
          gate_code?: Database["public"]["Enums"]["gate_code"]
          id?: string
          notes?: string | null
          passed_at?: string | null
          passed_by_staff_id?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["checkpoint_status"]
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "area_gate_checkpoints_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_gate_checkpoints_evidence_attachment_id_fkey"
            columns: ["evidence_attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_gate_checkpoints_gate_code_fkey"
            columns: ["gate_code"]
            isOneToOne: false
            referencedRelation: "gates"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "area_gate_checkpoints_passed_by_staff_id_fkey"
            columns: ["passed_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_gate_checkpoints_project_id_area_id_gate_code_fkey"
            columns: ["project_id", "area_id", "gate_code"]
            isOneToOne: false
            referencedRelation: "area_gate_status"
            referencedColumns: ["project_id", "area_id", "gate_code"]
          },
          {
            foreignKeyName: "area_gate_checkpoints_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_gate_checkpoints_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "gate_checkpoint_templates"
            referencedColumns: ["id"]
          },
        ]
      }
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
          stale: boolean
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
          stale?: boolean
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
          stale?: boolean
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
      assistant_messages: {
        Row: {
          content: string
          created_at: string
          estimated_cost_usd: number | null
          id: string
          role: Database["public"]["Enums"]["assistant_message_role"]
          session_id: string
          sources_jsonb: Json
          staff_id: string | null
          token_count: number | null
        }
        Insert: {
          content: string
          created_at?: string
          estimated_cost_usd?: number | null
          id?: string
          role: Database["public"]["Enums"]["assistant_message_role"]
          session_id: string
          sources_jsonb?: Json
          staff_id?: string | null
          token_count?: number | null
        }
        Update: {
          content?: string
          created_at?: string
          estimated_cost_usd?: number | null
          id?: string
          role?: Database["public"]["Enums"]["assistant_message_role"]
          session_id?: string
          sources_jsonb?: Json
          staff_id?: string | null
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "assistant_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_messages_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_query_audit: {
        Row: {
          answer_summary: string | null
          created_at: string
          estimated_cost_usd: number | null
          id: string
          included_unapproved_drafts: boolean
          project_scope_jsonb: Json
          question: string
          records_accessed_jsonb: Json
          staff_id: string | null
        }
        Insert: {
          answer_summary?: string | null
          created_at?: string
          estimated_cost_usd?: number | null
          id?: string
          included_unapproved_drafts?: boolean
          project_scope_jsonb?: Json
          question: string
          records_accessed_jsonb?: Json
          staff_id?: string | null
        }
        Update: {
          answer_summary?: string | null
          created_at?: string
          estimated_cost_usd?: number | null
          id?: string
          included_unapproved_drafts?: boolean
          project_scope_jsonb?: Json
          question?: string
          records_accessed_jsonb?: Json
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assistant_query_audit_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_sessions: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          project_id: string | null
          staff_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          project_id?: string | null
          staff_id?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          project_id?: string | null
          staff_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_sessions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          caption: string | null
          created_at: string
          file_path: string
          gps_lat: number | null
          gps_lon: number | null
          id: string
          kind: Database["public"]["Enums"]["attachment_kind"]
          mime_type: string | null
          project_id: string
          related_area_id: string | null
          related_gate: Database["public"]["Enums"]["gate_code"] | null
          related_record_id: string | null
          related_record_type: string | null
          taken_at: string | null
          uploaded_by_staff_id: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          file_path: string
          gps_lat?: number | null
          gps_lon?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["attachment_kind"]
          mime_type?: string | null
          project_id: string
          related_area_id?: string | null
          related_gate?: Database["public"]["Enums"]["gate_code"] | null
          related_record_id?: string | null
          related_record_type?: string | null
          taken_at?: string | null
          uploaded_by_staff_id?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          file_path?: string
          gps_lat?: number | null
          gps_lon?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["attachment_kind"]
          mime_type?: string | null
          project_id?: string
          related_area_id?: string | null
          related_gate?: Database["public"]["Enums"]["gate_code"] | null
          related_record_id?: string | null
          related_record_type?: string | null
          taken_at?: string | null
          uploaded_by_staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_related_area_id_fkey"
            columns: ["related_area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_staff_id_fkey"
            columns: ["uploaded_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      card_areas: {
        Row: {
          area_id: string
          card_id: string
        }
        Insert: {
          area_id: string
          card_id: string
        }
        Update: {
          area_id?: string
          card_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_areas_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_areas_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      card_attachments: {
        Row: {
          ai_caption: string | null
          ai_extracted: Json | null
          card_event_id: string
          created_at: string
          id: string
          mime_type: string
          storage_path: string
        }
        Insert: {
          ai_caption?: string | null
          ai_extracted?: Json | null
          card_event_id: string
          created_at?: string
          id?: string
          mime_type: string
          storage_path: string
        }
        Update: {
          ai_caption?: string | null
          ai_extracted?: Json | null
          card_event_id?: string
          created_at?: string
          id?: string
          mime_type?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_attachments_card_event_id_fkey"
            columns: ["card_event_id"]
            isOneToOne: false
            referencedRelation: "card_events"
            referencedColumns: ["id"]
          },
        ]
      }
      card_comments: {
        Row: {
          body: string
          card_id: string
          created_at: string
          created_by_staff_id: string | null
          deleted_at: string | null
          edited_at: string | null
          id: string
          mentions: string[]
          project_id: string
        }
        Insert: {
          body: string
          card_id: string
          created_at?: string
          created_by_staff_id?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          mentions?: string[]
          project_id: string
        }
        Update: {
          body?: string
          card_id?: string
          created_at?: string
          created_by_staff_id?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          mentions?: string[]
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_comments_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_comments_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      card_events: {
        Row: {
          card_id: string
          cost_visible: boolean
          created_at: string
          draft_id: string | null
          event_kind: Database["public"]["Enums"]["card_event_kind"]
          id: string
          logged_by_staff_id: string | null
          occurred_at: string
          payload: Json
          project_id: string
          source_id: string | null
          source_kind: Database["public"]["Enums"]["card_event_source"]
        }
        Insert: {
          card_id: string
          cost_visible?: boolean
          created_at?: string
          draft_id?: string | null
          event_kind: Database["public"]["Enums"]["card_event_kind"]
          id?: string
          logged_by_staff_id?: string | null
          occurred_at: string
          payload?: Json
          project_id: string
          source_id?: string | null
          source_kind: Database["public"]["Enums"]["card_event_source"]
        }
        Update: {
          card_id?: string
          cost_visible?: boolean
          created_at?: string
          draft_id?: string | null
          event_kind?: Database["public"]["Enums"]["card_event_kind"]
          id?: string
          logged_by_staff_id?: string | null
          occurred_at?: string
          payload?: Json
          project_id?: string
          source_id?: string | null
          source_kind?: Database["public"]["Enums"]["card_event_source"]
        }
        Relationships: [
          {
            foreignKeyName: "card_events_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_events_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "data_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_events_logged_by_staff_id_fkey"
            columns: ["logged_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      card_links: {
        Row: {
          created_at: string
          created_by_staff_id: string | null
          from_card_id: string
          relation: Database["public"]["Enums"]["card_link_relation"]
          to_card_id: string
        }
        Insert: {
          created_at?: string
          created_by_staff_id?: string | null
          from_card_id: string
          relation: Database["public"]["Enums"]["card_link_relation"]
          to_card_id: string
        }
        Update: {
          created_at?: string
          created_by_staff_id?: string | null
          from_card_id?: string
          relation?: Database["public"]["Enums"]["card_link_relation"]
          to_card_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_links_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_links_from_card_id_fkey"
            columns: ["from_card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_links_to_card_id_fkey"
            columns: ["to_card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      card_members: {
        Row: {
          added_at: string
          added_by_staff_id: string | null
          card_id: string
          removed_at: string | null
          role: Database["public"]["Enums"]["card_member_role"]
          staff_id: string
        }
        Insert: {
          added_at?: string
          added_by_staff_id?: string | null
          card_id: string
          removed_at?: string | null
          role?: Database["public"]["Enums"]["card_member_role"]
          staff_id: string
        }
        Update: {
          added_at?: string
          added_by_staff_id?: string | null
          card_id?: string
          removed_at?: string | null
          role?: Database["public"]["Enums"]["card_member_role"]
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_members_added_by_staff_id_fkey"
            columns: ["added_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_members_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_members_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      cards: {
        Row: {
          created_at: string
          created_by_staff_id: string | null
          current_summary: string | null
          id: string
          last_event_at: string | null
          project_id: string
          properties: Json
          slug: string
          status: Database["public"]["Enums"]["card_status"]
          title: string
          topic_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_staff_id?: string | null
          current_summary?: string | null
          id?: string
          last_event_at?: string | null
          project_id: string
          properties?: Json
          slug: string
          status?: Database["public"]["Enums"]["card_status"]
          title: string
          topic_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_staff_id?: string | null
          current_summary?: string | null
          id?: string
          last_event_at?: string | null
          project_id?: string
          properties?: Json
          slug?: string
          status?: Database["public"]["Enums"]["card_status"]
          title?: string
          topic_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      data_drafts: {
        Row: {
          approval_required_role:
            | Database["public"]["Enums"]["staff_role"]
            | null
          approved_at: string | null
          approved_by_staff_id: string | null
          created_at: string
          created_by_staff_id: string | null
          draft_type: Database["public"]["Enums"]["draft_type"]
          id: string
          original_input_text: string | null
          project_id: string
          promoted_record_id: string | null
          promoted_record_type: string | null
          proposed_payload: Json
          rejected_at: string | null
          rejected_by_staff_id: string | null
          rejection_reason: string | null
          risk_level: Database["public"]["Enums"]["draft_risk_level"]
          source_assistant_message_id: string | null
          source_attachment_id: string | null
          source_type: Database["public"]["Enums"]["draft_source_type"]
          status: Database["public"]["Enums"]["draft_status"]
          topic_id: string | null
        }
        Insert: {
          approval_required_role?:
            | Database["public"]["Enums"]["staff_role"]
            | null
          approved_at?: string | null
          approved_by_staff_id?: string | null
          created_at?: string
          created_by_staff_id?: string | null
          draft_type: Database["public"]["Enums"]["draft_type"]
          id?: string
          original_input_text?: string | null
          project_id: string
          promoted_record_id?: string | null
          promoted_record_type?: string | null
          proposed_payload: Json
          rejected_at?: string | null
          rejected_by_staff_id?: string | null
          rejection_reason?: string | null
          risk_level?: Database["public"]["Enums"]["draft_risk_level"]
          source_assistant_message_id?: string | null
          source_attachment_id?: string | null
          source_type: Database["public"]["Enums"]["draft_source_type"]
          status?: Database["public"]["Enums"]["draft_status"]
          topic_id?: string | null
        }
        Update: {
          approval_required_role?:
            | Database["public"]["Enums"]["staff_role"]
            | null
          approved_at?: string | null
          approved_by_staff_id?: string | null
          created_at?: string
          created_by_staff_id?: string | null
          draft_type?: Database["public"]["Enums"]["draft_type"]
          id?: string
          original_input_text?: string | null
          project_id?: string
          promoted_record_id?: string | null
          promoted_record_type?: string | null
          proposed_payload?: Json
          rejected_at?: string | null
          rejected_by_staff_id?: string | null
          rejection_reason?: string | null
          risk_level?: Database["public"]["Enums"]["draft_risk_level"]
          source_assistant_message_id?: string | null
          source_attachment_id?: string | null
          source_type?: Database["public"]["Enums"]["draft_source_type"]
          status?: Database["public"]["Enums"]["draft_status"]
          topic_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_drafts_approved_by_staff_id_fkey"
            columns: ["approved_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_drafts_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_drafts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_drafts_rejected_by_staff_id_fkey"
            columns: ["rejected_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_drafts_source_attachment_id_fkey"
            columns: ["source_attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_drafts_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      decisions: {
        Row: {
          approved_by_staff_id: string | null
          area_id: string | null
          category: Database["public"]["Enums"]["decision_category"]
          chosen_option: Json | null
          confirmed_at: string | null
          created_at: string
          decision_deadline: string | null
          gate_code: Database["public"]["Enums"]["gate_code"] | null
          id: string
          item_label: string
          notes: string | null
          priority: Database["public"]["Enums"]["decision_priority"] | null
          project_id: string
          proposed_by_staff_id: string | null
          proposed_options: Json
          source_topic_note_id: string | null
          status: Database["public"]["Enums"]["decision_status"]
          updated_at: string
        }
        Insert: {
          approved_by_staff_id?: string | null
          area_id?: string | null
          category: Database["public"]["Enums"]["decision_category"]
          chosen_option?: Json | null
          confirmed_at?: string | null
          created_at?: string
          decision_deadline?: string | null
          gate_code?: Database["public"]["Enums"]["gate_code"] | null
          id?: string
          item_label: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["decision_priority"] | null
          project_id: string
          proposed_by_staff_id?: string | null
          proposed_options?: Json
          source_topic_note_id?: string | null
          status?: Database["public"]["Enums"]["decision_status"]
          updated_at?: string
        }
        Update: {
          approved_by_staff_id?: string | null
          area_id?: string | null
          category?: Database["public"]["Enums"]["decision_category"]
          chosen_option?: Json | null
          confirmed_at?: string | null
          created_at?: string
          decision_deadline?: string | null
          gate_code?: Database["public"]["Enums"]["gate_code"] | null
          id?: string
          item_label?: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["decision_priority"] | null
          project_id?: string
          proposed_by_staff_id?: string | null
          proposed_options?: Json
          source_topic_note_id?: string | null
          status?: Database["public"]["Enums"]["decision_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "decisions_approved_by_staff_id_fkey"
            columns: ["approved_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_proposed_by_staff_id_fkey"
            columns: ["proposed_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_source_topic_note_id_fkey"
            columns: ["source_topic_note_id"]
            isOneToOne: false
            referencedRelation: "topic_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      drawing_revisions: {
        Row: {
          drawing_id: string
          file_path: string
          id: string
          notes: string | null
          revision_code: string
          uploaded_at: string
          uploaded_by_staff_id: string | null
        }
        Insert: {
          drawing_id: string
          file_path: string
          id?: string
          notes?: string | null
          revision_code: string
          uploaded_at?: string
          uploaded_by_staff_id?: string | null
        }
        Update: {
          drawing_id?: string
          file_path?: string
          id?: string
          notes?: string | null
          revision_code?: string
          uploaded_at?: string
          uploaded_by_staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drawing_revisions_drawing_id_fkey"
            columns: ["drawing_id"]
            isOneToOne: false
            referencedRelation: "drawings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_revisions_uploaded_by_staff_id_fkey"
            columns: ["uploaded_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      drawings: {
        Row: {
          created_at: string
          current_revision: string | null
          drawing_code: string
          drawing_name: string
          drawing_type: Database["public"]["Enums"]["drawing_type"]
          drawn_by: string | null
          id: string
          last_updated: string | null
          notes: string | null
          project_id: string
          related_topic_id: string | null
          status: Database["public"]["Enums"]["drawing_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_revision?: string | null
          drawing_code: string
          drawing_name: string
          drawing_type?: Database["public"]["Enums"]["drawing_type"]
          drawn_by?: string | null
          id?: string
          last_updated?: string | null
          notes?: string | null
          project_id: string
          related_topic_id?: string | null
          status?: Database["public"]["Enums"]["drawing_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_revision?: string | null
          drawing_code?: string
          drawing_name?: string
          drawing_type?: Database["public"]["Enums"]["drawing_type"]
          drawn_by?: string | null
          id?: string
          last_updated?: string | null
          notes?: string | null
          project_id?: string
          related_topic_id?: string | null
          status?: Database["public"]["Enums"]["drawing_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drawings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawings_related_topic_id_fkey"
            columns: ["related_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
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
      invoices: {
        Row: {
          amount: number
          approved_by_staff_id: string | null
          attachment_id: string | null
          created_at: string
          currency: string
          due_date: string | null
          id: string
          invoice_date: string
          invoice_number: string | null
          material_item_id: string | null
          notes: string | null
          paid_at: string | null
          project_id: string
          recorded_by_staff_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          updated_at: string
          vendor_id: string
        }
        Insert: {
          amount: number
          approved_by_staff_id?: string | null
          attachment_id?: string | null
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          material_item_id?: string | null
          notes?: string | null
          paid_at?: string | null
          project_id: string
          recorded_by_staff_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          vendor_id: string
        }
        Update: {
          amount?: number
          approved_by_staff_id?: string | null
          attachment_id?: string | null
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          material_item_id?: string | null
          notes?: string | null
          paid_at?: string | null
          project_id?: string
          recorded_by_staff_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_approved_by_staff_id_fkey"
            columns: ["approved_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_material_item_id_fkey"
            columns: ["material_item_id"]
            isOneToOne: false
            referencedRelation: "material_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_recorded_by_staff_id_fkey"
            columns: ["recorded_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      material_items: {
        Row: {
          actual_arrival: string | null
          area_id: string | null
          category: string
          created_at: string
          currency: string | null
          decision_id: string | null
          expected_arrival: string | null
          gate_code: Database["public"]["Enums"]["gate_code"] | null
          id: string
          lead_time_weeks: number | null
          order_by_date: string | null
          project_id: string
          quantity: number | null
          spec: string | null
          status: Database["public"]["Enums"]["material_status"]
          unit: string | null
          unit_price: number | null
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          actual_arrival?: string | null
          area_id?: string | null
          category: string
          created_at?: string
          currency?: string | null
          decision_id?: string | null
          expected_arrival?: string | null
          gate_code?: Database["public"]["Enums"]["gate_code"] | null
          id?: string
          lead_time_weeks?: number | null
          order_by_date?: string | null
          project_id: string
          quantity?: number | null
          spec?: string | null
          status?: Database["public"]["Enums"]["material_status"]
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          actual_arrival?: string | null
          area_id?: string | null
          category?: string
          created_at?: string
          currency?: string | null
          decision_id?: string | null
          expected_arrival?: string | null
          gate_code?: Database["public"]["Enums"]["gate_code"] | null
          id?: string
          lead_time_weeks?: number | null
          order_by_date?: string | null
          project_id?: string
          quantity?: number | null
          spec?: string | null
          status?: Database["public"]["Enums"]["material_status"]
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "material_items_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_items_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_items_vendor_fk"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      material_milestones: {
        Row: {
          attachment_id: string | null
          created_at: string
          id: string
          material_item_id: string
          milestone_type: Database["public"]["Enums"]["material_milestone_type"]
          notes: string | null
          occurred_at: string
          recorded_by_staff_id: string | null
        }
        Insert: {
          attachment_id?: string | null
          created_at?: string
          id?: string
          material_item_id: string
          milestone_type: Database["public"]["Enums"]["material_milestone_type"]
          notes?: string | null
          occurred_at?: string
          recorded_by_staff_id?: string | null
        }
        Update: {
          attachment_id?: string | null
          created_at?: string
          id?: string
          material_item_id?: string
          milestone_type?: Database["public"]["Enums"]["material_milestone_type"]
          notes?: string | null
          occurred_at?: string
          recorded_by_staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "material_milestones_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_milestones_material_item_id_fkey"
            columns: ["material_item_id"]
            isOneToOne: false
            referencedRelation: "material_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_milestones_recorded_by_staff_id_fkey"
            columns: ["recorded_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
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
      review_queue: {
        Row: {
          assigned_to_staff_id: string | null
          created_at: string
          draft_id: string
          id: string
          priority: Database["public"]["Enums"]["review_priority"]
          project_id: string
          resolved_at: string | null
          resolved_by_staff_id: string | null
          status: Database["public"]["Enums"]["review_queue_status"]
        }
        Insert: {
          assigned_to_staff_id?: string | null
          created_at?: string
          draft_id: string
          id?: string
          priority?: Database["public"]["Enums"]["review_priority"]
          project_id: string
          resolved_at?: string | null
          resolved_by_staff_id?: string | null
          status?: Database["public"]["Enums"]["review_queue_status"]
        }
        Update: {
          assigned_to_staff_id?: string | null
          created_at?: string
          draft_id?: string
          id?: string
          priority?: Database["public"]["Enums"]["review_priority"]
          project_id?: string
          resolved_at?: string | null
          resolved_by_staff_id?: string | null
          status?: Database["public"]["Enums"]["review_queue_status"]
        }
        Relationships: [
          {
            foreignKeyName: "review_queue_assigned_to_staff_id_fkey"
            columns: ["assigned_to_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_queue_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "data_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_queue_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_queue_resolved_by_staff_id_fkey"
            columns: ["resolved_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
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
      topic_notes: {
        Row: {
          approved_by_staff_id: string | null
          body: string
          created_at: string
          created_by_staff_id: string | null
          id: string
          note_type: Database["public"]["Enums"]["topic_note_type"]
          official_status: Database["public"]["Enums"]["note_official_status"]
          project_id: string
          related_area_id: string | null
          related_gate: Database["public"]["Enums"]["gate_code"] | null
          related_record_id: string | null
          related_record_type: string | null
          topic_id: string
          updated_at: string
        }
        Insert: {
          approved_by_staff_id?: string | null
          body: string
          created_at?: string
          created_by_staff_id?: string | null
          id?: string
          note_type?: Database["public"]["Enums"]["topic_note_type"]
          official_status?: Database["public"]["Enums"]["note_official_status"]
          project_id: string
          related_area_id?: string | null
          related_gate?: Database["public"]["Enums"]["gate_code"] | null
          related_record_id?: string | null
          related_record_type?: string | null
          topic_id: string
          updated_at?: string
        }
        Update: {
          approved_by_staff_id?: string | null
          body?: string
          created_at?: string
          created_by_staff_id?: string | null
          id?: string
          note_type?: Database["public"]["Enums"]["topic_note_type"]
          official_status?: Database["public"]["Enums"]["note_official_status"]
          project_id?: string
          related_area_id?: string | null
          related_gate?: Database["public"]["Enums"]["gate_code"] | null
          related_record_id?: string | null
          related_record_type?: string | null
          topic_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_notes_approved_by_staff_id_fkey"
            columns: ["approved_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_notes_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_notes_related_area_id_fkey"
            columns: ["related_area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_notes_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          code: string
          created_at: string
          created_by_staff_id: string | null
          default_gate: Database["public"]["Enums"]["gate_code"] | null
          id: string
          name: string
          project_id: string
          related_area_id: string | null
          sort_order: number
          status: string
          topic_type: Database["public"]["Enums"]["topic_type"]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by_staff_id?: string | null
          default_gate?: Database["public"]["Enums"]["gate_code"] | null
          id?: string
          name: string
          project_id: string
          related_area_id?: string | null
          sort_order?: number
          status?: string
          topic_type?: Database["public"]["Enums"]["topic_type"]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by_staff_id?: string | null
          default_gate?: Database["public"]["Enums"]["gate_code"] | null
          id?: string
          name?: string
          project_id?: string
          related_area_id?: string | null
          sort_order?: number
          status?: string
          topic_type?: Database["public"]["Enums"]["topic_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topics_related_area_id_fkey"
            columns: ["related_area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_quotes: {
        Row: {
          amount: number
          attachment_id: string | null
          created_at: string
          currency: string
          id: string
          material_item_id: string | null
          notes: string | null
          project_id: string
          quote_date: string
          quoted_lead_time_weeks: number | null
          received_by_staff_id: string | null
          status: Database["public"]["Enums"]["quote_status"]
          updated_at: string
          vendor_id: string
        }
        Insert: {
          amount: number
          attachment_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          material_item_id?: string | null
          notes?: string | null
          project_id: string
          quote_date?: string
          quoted_lead_time_weeks?: number | null
          received_by_staff_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          updated_at?: string
          vendor_id: string
        }
        Update: {
          amount?: number
          attachment_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          material_item_id?: string | null
          notes?: string | null
          project_id?: string
          quote_date?: string
          quoted_lead_time_weeks?: number | null
          received_by_staff_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_quotes_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_quotes_material_item_id_fkey"
            columns: ["material_item_id"]
            isOneToOne: false
            referencedRelation: "material_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_quotes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_quotes_received_by_staff_id_fkey"
            columns: ["received_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_quotes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["vendor_category"]
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          notes: string | null
          updated_at: string
          vendor_name: string
        }
        Insert: {
          active?: boolean
          category?: Database["public"]["Enums"]["vendor_category"]
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
          vendor_name: string
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["vendor_category"]
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
          vendor_name?: string
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
      mark_areas_stale_for_card: {
        Args: { p_card_id: string }
        Returns: undefined
      }
      path_project_id: { Args: { p_path: string }; Returns: string }
      seed_default_topics: {
        Args: { p_project_id: string }
        Returns: undefined
      }
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
      assistant_message_role: "user" | "assistant" | "system"
      attachment_kind: "photo" | "drawing" | "document" | "other"
      blocker_status: "open" | "resolved" | "cancelled"
      blocker_type:
        | "decision_pending"
        | "material_not_arrived"
        | "prior_gate_not_passed"
        | "area_occupied"
        | "approval_pending"
        | "quality_failed"
        | "shop_drawing_pending"
        | "other"
      card_event_kind:
        | "decision"
        | "drawing"
        | "survey"
        | "vendor_quote"
        | "vendor_pick"
        | "material"
        | "worker_assigned"
        | "progress"
        | "defect"
        | "photo"
        | "document"
        | "client_request"
        | "note"
        | "pending"
      card_event_source:
        | "chat"
        | "manual"
        | "import"
        | "ai_extraction"
        | "external_pdf"
      card_link_relation: "depends_on" | "blocks" | "related_to" | "supersedes"
      card_member_role: "owner" | "watcher" | "assignee"
      card_status: "active" | "dormant" | "closed"
      checkpoint_status: "pending" | "passed" | "failed" | "not_applicable"
      decision_category:
        | "material"
        | "vendor"
        | "approval"
        | "change_order"
        | "scope"
        | "schedule"
        | "design"
        | "other"
      decision_priority: "P1" | "P2" | "P3"
      decision_status: "pending" | "approved" | "rejected" | "superseded"
      draft_risk_level: "low" | "medium" | "high"
      draft_source_type:
        | "manual_form"
        | "assistant_chat"
        | "pdf_upload"
        | "image_upload"
        | "import"
        | "migration"
      draft_status:
        | "draft"
        | "approved"
        | "rejected"
        | "superseded"
        | "auto_promoted"
      draft_type:
        | "note"
        | "decision"
        | "material_item_update"
        | "material_milestone"
        | "quality_checkpoint_pass"
        | "quality_checkpoint_fail"
        | "blocker_open"
        | "blocker_close"
        | "drawing_extraction"
        | "photo_record"
        | "progress_update"
        | "cost_quote"
        | "invoice"
        | "card_event"
      drawing_status:
        | "required"
        | "issued"
        | "revised"
        | "approved"
        | "superseded"
        | "not_applicable"
      drawing_type:
        | "cover"
        | "floor_plan"
        | "section"
        | "elevation"
        | "door_window"
        | "detail"
        | "finishing_schedule"
        | "room_data_sheet"
        | "utility"
        | "landscape"
        | "other"
      gate_code: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H"
      invoice_status: "received" | "approved" | "paid" | "disputed" | "rejected"
      material_milestone_type:
        | "po_sent"
        | "deposit_paid"
        | "shop_drawing_approved"
        | "production_start"
        | "dispatch"
        | "arrived"
        | "installed"
        | "rejected"
      material_status:
        | "decided"
        | "shop_drawing_pending"
        | "ordered"
        | "in_fabrication"
        | "arrived_on_site"
        | "installed"
        | "rejected"
      note_official_status: "draft" | "approved" | "rejected"
      project_status:
        | "design"
        | "construction"
        | "finishing"
        | "handover"
        | "closed"
      quote_status: "received" | "selected" | "superseded" | "rejected"
      readiness_state:
        | "not_started"
        | "in_progress"
        | "ready_for_handoff"
        | "blocked"
        | "passed"
        | "not_applicable"
      review_priority: "low" | "normal" | "high" | "urgent"
      review_queue_status: "pending" | "in_review" | "resolved" | "dismissed"
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
      topic_note_type:
        | "general"
        | "meeting"
        | "client_conversation"
        | "site_instruction"
        | "survey"
        | "decision_log"
        | "imported"
      topic_type: "drawing" | "utility" | "room" | "forum" | "general"
      vendor_category:
        | "marmer"
        | "keramik"
        | "sanitair"
        | "kusen"
        | "cat"
        | "duco"
        | "ironwork"
        | "furniture"
        | "wallpaper"
        | "lampu"
        | "mep"
        | "landscape"
        | "other"
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
      assistant_message_role: ["user", "assistant", "system"],
      attachment_kind: ["photo", "drawing", "document", "other"],
      blocker_status: ["open", "resolved", "cancelled"],
      blocker_type: [
        "decision_pending",
        "material_not_arrived",
        "prior_gate_not_passed",
        "area_occupied",
        "approval_pending",
        "quality_failed",
        "shop_drawing_pending",
        "other",
      ],
      card_event_kind: [
        "decision",
        "drawing",
        "survey",
        "vendor_quote",
        "vendor_pick",
        "material",
        "worker_assigned",
        "progress",
        "defect",
        "photo",
        "document",
        "client_request",
        "note",
        "pending",
      ],
      card_event_source: [
        "chat",
        "manual",
        "import",
        "ai_extraction",
        "external_pdf",
      ],
      card_link_relation: ["depends_on", "blocks", "related_to", "supersedes"],
      card_member_role: ["owner", "watcher", "assignee"],
      card_status: ["active", "dormant", "closed"],
      checkpoint_status: ["pending", "passed", "failed", "not_applicable"],
      decision_category: [
        "material",
        "vendor",
        "approval",
        "change_order",
        "scope",
        "schedule",
        "design",
        "other",
      ],
      decision_priority: ["P1", "P2", "P3"],
      decision_status: ["pending", "approved", "rejected", "superseded"],
      draft_risk_level: ["low", "medium", "high"],
      draft_source_type: [
        "manual_form",
        "assistant_chat",
        "pdf_upload",
        "image_upload",
        "import",
        "migration",
      ],
      draft_status: [
        "draft",
        "approved",
        "rejected",
        "superseded",
        "auto_promoted",
      ],
      draft_type: [
        "note",
        "decision",
        "material_item_update",
        "material_milestone",
        "quality_checkpoint_pass",
        "quality_checkpoint_fail",
        "blocker_open",
        "blocker_close",
        "drawing_extraction",
        "photo_record",
        "progress_update",
        "cost_quote",
        "invoice",
        "card_event",
      ],
      drawing_status: [
        "required",
        "issued",
        "revised",
        "approved",
        "superseded",
        "not_applicable",
      ],
      drawing_type: [
        "cover",
        "floor_plan",
        "section",
        "elevation",
        "door_window",
        "detail",
        "finishing_schedule",
        "room_data_sheet",
        "utility",
        "landscape",
        "other",
      ],
      gate_code: ["A", "B", "C", "D", "E", "F", "G", "H"],
      invoice_status: ["received", "approved", "paid", "disputed", "rejected"],
      material_milestone_type: [
        "po_sent",
        "deposit_paid",
        "shop_drawing_approved",
        "production_start",
        "dispatch",
        "arrived",
        "installed",
        "rejected",
      ],
      material_status: [
        "decided",
        "shop_drawing_pending",
        "ordered",
        "in_fabrication",
        "arrived_on_site",
        "installed",
        "rejected",
      ],
      note_official_status: ["draft", "approved", "rejected"],
      project_status: [
        "design",
        "construction",
        "finishing",
        "handover",
        "closed",
      ],
      quote_status: ["received", "selected", "superseded", "rejected"],
      readiness_state: [
        "not_started",
        "in_progress",
        "ready_for_handoff",
        "blocked",
        "passed",
        "not_applicable",
      ],
      review_priority: ["low", "normal", "high", "urgent"],
      review_queue_status: ["pending", "in_review", "resolved", "dismissed"],
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
      topic_note_type: [
        "general",
        "meeting",
        "client_conversation",
        "site_instruction",
        "survey",
        "decision_log",
        "imported",
      ],
      topic_type: ["drawing", "utility", "room", "forum", "general"],
      vendor_category: [
        "marmer",
        "keramik",
        "sanitair",
        "kusen",
        "cat",
        "duco",
        "ironwork",
        "furniture",
        "wallpaper",
        "lampu",
        "mep",
        "landscape",
        "other",
      ],
    },
  },
} as const
