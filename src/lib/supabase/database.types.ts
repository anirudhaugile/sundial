
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "blocks": {
                  Row: {
                    "completed_at": string | null,"created_at": string,"ends_at": string,"habit_id": string | null,"id": string,"kind": string,"locked": boolean,"plan_run_id": string | null,"reasoning": string | null,"starts_at": string,"status": string,"title": string,"user_id": string,"work_item_id": string | null
                  }
                  Insert: {
                    "completed_at"?: string | null,"created_at"?: string,"ends_at": string,"habit_id"?: string | null,"id"?: string,"kind": string,"locked"?: boolean,"plan_run_id"?: string | null,"reasoning"?: string | null,"starts_at": string,"status"?: string,"title": string,"user_id": string,"work_item_id"?: string | null
                  }
                  Update: {
                    "completed_at"?: string | null,"created_at"?: string,"ends_at"?: string,"habit_id"?: string | null,"id"?: string,"kind"?: string,"locked"?: boolean,"plan_run_id"?: string | null,"reasoning"?: string | null,"starts_at"?: string,"status"?: string,"title"?: string,"user_id"?: string,"work_item_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "blocks_habit_id_user_id_fkey"
      columns: ["habit_id","user_id"]
isOneToOne: false
      referencedRelation: "habits"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "blocks_plan_run_id_user_id_fkey"
      columns: ["plan_run_id","user_id"]
isOneToOne: false
      referencedRelation: "plan_runs"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "blocks_work_item_id_user_id_fkey"
      columns: ["work_item_id","user_id"]
isOneToOne: false
      referencedRelation: "work_items"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"courses": {
                  Row: {
                    "code": string | null,"color": string,"created_at": string,"external_id": string | null,"id": string,"name": string,"source": string,"user_id": string
                  }
                  Insert: {
                    "code"?: string | null,"color"?: string,"created_at"?: string,"external_id"?: string | null,"id"?: string,"name": string,"source"?: string,"user_id": string
                  }
                  Update: {
                    "code"?: string | null,"color"?: string,"created_at"?: string,"external_id"?: string | null,"id"?: string,"name"?: string,"source"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"effort_estimates": {
                  Row: {
                    "content_hash": string,"created_at": string,"hours": number,"id": string,"model": string | null,"origin": string,"reasoning": string | null,"user_id": string,"work_item_id": string
                  }
                  Insert: {
                    "content_hash": string,"created_at"?: string,"hours": number,"id"?: string,"model"?: string | null,"origin": string,"reasoning"?: string | null,"user_id": string,"work_item_id": string
                  }
                  Update: {
                    "content_hash"?: string,"created_at"?: string,"hours"?: number,"id"?: string,"model"?: string | null,"origin"?: string,"reasoning"?: string | null,"user_id"?: string,"work_item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "effort_estimates_work_item_id_user_id_fkey"
      columns: ["work_item_id","user_id"]
isOneToOne: false
      referencedRelation: "work_items"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"events": {
                  Row: {
                    "all_day": boolean,"busy": boolean,"created_at": string,"ends_at": string,"external_uid": string | null,"id": string,"instance_start": string | null,"kind": string,"location": string | null,"removed_at": string | null,"source": string,"starts_at": string,"title": string,"user_id": string
                  }
                  Insert: {
                    "all_day"?: boolean,"busy"?: boolean,"created_at"?: string,"ends_at": string,"external_uid"?: string | null,"id"?: string,"instance_start"?: string | null,"kind"?: string,"location"?: string | null,"removed_at"?: string | null,"source"?: string,"starts_at": string,"title": string,"user_id": string
                  }
                  Update: {
                    "all_day"?: boolean,"busy"?: boolean,"created_at"?: string,"ends_at"?: string,"external_uid"?: string | null,"id"?: string,"instance_start"?: string | null,"kind"?: string,"location"?: string | null,"removed_at"?: string | null,"source"?: string,"starts_at"?: string,"title"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"habits": {
                  Row: {
                    "color": string,"created_at": string,"days_of_week": (number)[],"end_date": string | null,"id": string,"min_min": number,"name": string,"priority": number,"retired_at": string | null,"start_date": string,"target_min": number,"user_id": string,"window_end": string,"window_start": string
                  }
                  Insert: {
                    "color"?: string,"created_at"?: string,"days_of_week"?: (number)[],"end_date"?: string | null,"id"?: string,"min_min": number,"name": string,"priority"?: number,"retired_at"?: string | null,"start_date"?: string,"target_min": number,"user_id": string,"window_end": string,"window_start": string
                  }
                  Update: {
                    "color"?: string,"created_at"?: string,"days_of_week"?: (number)[],"end_date"?: string | null,"id"?: string,"min_min"?: number,"name"?: string,"priority"?: number,"retired_at"?: string | null,"start_date"?: string,"target_min"?: number,"user_id"?: string,"window_end"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"plan_conflicts": {
                  Row: {
                    "day": string | null,"habit_id": string | null,"id": string,"message": string,"plan_run_id": string,"severity": string,"shortfall_min": number,"user_id": string,"work_item_id": string | null
                  }
                  Insert: {
                    "day"?: string | null,"habit_id"?: string | null,"id"?: string,"message": string,"plan_run_id": string,"severity"?: string,"shortfall_min"?: number,"user_id": string,"work_item_id"?: string | null
                  }
                  Update: {
                    "day"?: string | null,"habit_id"?: string | null,"id"?: string,"message"?: string,"plan_run_id"?: string,"severity"?: string,"shortfall_min"?: number,"user_id"?: string,"work_item_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "plan_conflicts_habit_id_user_id_fkey"
      columns: ["habit_id","user_id"]
isOneToOne: false
      referencedRelation: "habits"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "plan_conflicts_plan_run_id_user_id_fkey"
      columns: ["plan_run_id","user_id"]
isOneToOne: false
      referencedRelation: "plan_runs"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "plan_conflicts_work_item_id_user_id_fkey"
      columns: ["work_item_id","user_id"]
isOneToOne: false
      referencedRelation: "work_items"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"plan_runs": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"horizon_end": string,"horizon_start": string,"id": string,"status": string,"summary": NonNullable<Json>,"trigger": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"horizon_end": string,"horizon_start": string,"id"?: string,"status"?: string,"summary"?: NonNullable<Json>,"trigger"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"horizon_end"?: string,"horizon_start"?: string,"id"?: string,"status"?: string,"summary"?: NonNullable<Json>,"trigger"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"daily_work_cap_min": number,"day_end": string,"day_start": string,"display_name": string | null,"due_buffer_hours": number,"horizon_days": number,"id": string,"is_demo": boolean,"max_block_min": number,"min_block_min": number,"timezone": string
                  }
                  Insert: {
                    "created_at"?: string,"daily_work_cap_min"?: number,"day_end"?: string,"day_start"?: string,"display_name"?: string | null,"due_buffer_hours"?: number,"horizon_days"?: number,"id": string,"is_demo"?: boolean,"max_block_min"?: number,"min_block_min"?: number,"timezone"?: string
                  }
                  Update: {
                    "created_at"?: string,"daily_work_cap_min"?: number,"day_end"?: string,"day_start"?: string,"display_name"?: string | null,"due_buffer_hours"?: number,"horizon_days"?: number,"id"?: string,"is_demo"?: boolean,"max_block_min"?: number,"min_block_min"?: number,"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"source_connections": {
                  Row: {
                    "base_url": string | null,"created_at": string,"enabled": boolean,"id": string,"kind": string,"last_error": string | null,"last_synced_at": string | null,"secret_hint": string | null,"user_id": string
                  }
                  Insert: {
                    "base_url"?: string | null,"created_at"?: string,"enabled"?: boolean,"id"?: string,"kind": string,"last_error"?: string | null,"last_synced_at"?: string | null,"secret_hint"?: string | null,"user_id": string
                  }
                  Update: {
                    "base_url"?: string | null,"created_at"?: string,"enabled"?: boolean,"id"?: string,"kind"?: string,"last_error"?: string | null,"last_synced_at"?: string | null,"secret_hint"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"source_secrets": {
                  Row: {
                    "ciphertext": string,"connection_id": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "ciphertext": string,"connection_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "ciphertext"?: string,"connection_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "source_secrets_connection_id_fkey"
      columns: ["connection_id"]
isOneToOne: true
      referencedRelation: "source_connections"
      referencedColumns: ["id"]
    }
                  ]
                },"sync_runs": {
                  Row: {
                    "connection_id": string,"error": string | null,"finished_at": string | null,"id": string,"inserted": number,"removed": number,"started_at": string,"updated": number,"user_id": string
                  }
                  Insert: {
                    "connection_id": string,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"inserted"?: number,"removed"?: number,"started_at"?: string,"updated"?: number,"user_id": string
                  }
                  Update: {
                    "connection_id"?: string,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"inserted"?: number,"removed"?: number,"started_at"?: string,"updated"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sync_runs_connection_id_user_id_fkey"
      columns: ["connection_id","user_id"]
isOneToOne: false
      referencedRelation: "source_connections"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"work_items": {
                  Row: {
                    "completed_at": string | null,"content_hash": string | null,"course_id": string | null,"created_at": string,"description": string | null,"due_at": string | null,"external_id": string | null,"id": string,"kind": string,"planned_for": string | null,"points": number | null,"removed_at": string | null,"source": string,"status": string,"title": string,"updated_at": string,"url": string | null,"user_id": string
                  }
                  Insert: {
                    "completed_at"?: string | null,"content_hash"?: string | null,"course_id"?: string | null,"created_at"?: string,"description"?: string | null,"due_at"?: string | null,"external_id"?: string | null,"id"?: string,"kind"?: string,"planned_for"?: string | null,"points"?: number | null,"removed_at"?: string | null,"source"?: string,"status"?: string,"title": string,"updated_at"?: string,"url"?: string | null,"user_id": string
                  }
                  Update: {
                    "completed_at"?: string | null,"content_hash"?: string | null,"course_id"?: string | null,"created_at"?: string,"description"?: string | null,"due_at"?: string | null,"external_id"?: string | null,"id"?: string,"kind"?: string,"planned_for"?: string | null,"points"?: number | null,"removed_at"?: string | null,"source"?: string,"status"?: string,"title"?: string,"updated_at"?: string,"url"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_items_course_id_user_id_fkey"
      columns: ["course_id","user_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id","user_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "is_demo":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const

