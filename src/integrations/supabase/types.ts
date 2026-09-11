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
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          bot_id: string | null
          created_at: string
          detail: string | null
          id: string
          meta: Json
          user_id: string | null
        }
        Insert: {
          action: string
          bot_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          meta?: Json
          user_id?: string | null
        }
        Update: {
          action?: string
          bot_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          meta?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_chat_state: {
        Row: {
          bot_id: string
          created_at: string
          data: Json
          expires_at: string
          flow: string
          id: string
          step: string
          telegram_id: number
          updated_at: string
        }
        Insert: {
          bot_id: string
          created_at?: string
          data?: Json
          expires_at?: string
          flow: string
          id?: string
          step: string
          telegram_id: number
          updated_at?: string
        }
        Update: {
          bot_id?: string
          created_at?: string
          data?: Json
          expires_at?: string
          flow?: string
          id?: string
          step?: string
          telegram_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_chat_state_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_credentials: {
        Row: {
          bot_id: string
          token_ciphertext: string
          token_iv: string
          updated_at: string
          webhook_secret_ciphertext: string | null
          webhook_secret_iv: string | null
        }
        Insert: {
          bot_id: string
          token_ciphertext: string
          token_iv: string
          updated_at?: string
          webhook_secret_ciphertext?: string | null
          webhook_secret_iv?: string | null
        }
        Update: {
          bot_id?: string
          token_ciphertext?: string
          token_iv?: string
          updated_at?: string
          webhook_secret_ciphertext?: string | null
          webhook_secret_iv?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_credentials_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: true
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_deployments: {
        Row: {
          bot_id: string
          compatibility: Database["public"]["Enums"]["compat_status"] | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          status: string
          steps: Json
          version_id: string | null
          webhook_status: string | null
        }
        Insert: {
          bot_id: string
          compatibility?: Database["public"]["Enums"]["compat_status"] | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          status: string
          steps?: Json
          version_id?: string | null
          webhook_status?: string | null
        }
        Update: {
          bot_id?: string
          compatibility?: Database["public"]["Enums"]["compat_status"] | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          status?: string
          steps?: Json
          version_id?: string | null
          webhook_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_deployments_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_deployments_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "bot_project_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_environment_variables: {
        Row: {
          bot_id: string
          created_at: string
          id: string
          is_secret: boolean
          key: string
          value_ciphertext: string
          value_iv: string
        }
        Insert: {
          bot_id: string
          created_at?: string
          id?: string
          is_secret?: boolean
          key: string
          value_ciphertext: string
          value_iv: string
        }
        Update: {
          bot_id?: string
          created_at?: string
          id?: string
          is_secret?: boolean
          key?: string
          value_ciphertext?: string
          value_iv?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_environment_variables_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_project_versions: {
        Row: {
          adapter_plan: Json
          analysis: Json
          bot_id: string
          compatibility: Database["public"]["Enums"]["compat_status"] | null
          created_at: string
          error: string | null
          file_count: number | null
          id: string
          project_hash: string | null
          project_id: string
          storage_path: string | null
          total_bytes: number | null
          version: number
        }
        Insert: {
          adapter_plan?: Json
          analysis?: Json
          bot_id: string
          compatibility?: Database["public"]["Enums"]["compat_status"] | null
          created_at?: string
          error?: string | null
          file_count?: number | null
          id?: string
          project_hash?: string | null
          project_id: string
          storage_path?: string | null
          total_bytes?: number | null
          version: number
        }
        Update: {
          adapter_plan?: Json
          analysis?: Json
          bot_id?: string
          compatibility?: Database["public"]["Enums"]["compat_status"] | null
          created_at?: string
          error?: string | null
          file_count?: number | null
          id?: string
          project_hash?: string | null
          project_id?: string
          storage_path?: string | null
          total_bytes?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bot_project_versions_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_project_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "bot_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_projects: {
        Row: {
          active_version_id: string | null
          bot_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active_version_id?: string | null
          bot_id: string
          created_at?: string
          id?: string
          name?: string
        }
        Update: {
          active_version_id?: string | null
          bot_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_projects_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: true
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_runtimes: {
        Row: {
          bot_id: string
          capabilities: Json
          created_at: string
          health_path: string | null
          host_id: string | null
          last_error: string | null
          last_health_at: string | null
          last_health_status: string | null
          manifest: Json
          mode: string
          port: number | null
          public_url: string | null
          state: string
          updated_at: string
          version_id: string | null
          webhook_path: string | null
        }
        Insert: {
          bot_id: string
          capabilities?: Json
          created_at?: string
          health_path?: string | null
          host_id?: string | null
          last_error?: string | null
          last_health_at?: string | null
          last_health_status?: string | null
          manifest?: Json
          mode?: string
          port?: number | null
          public_url?: string | null
          state?: string
          updated_at?: string
          version_id?: string | null
          webhook_path?: string | null
        }
        Update: {
          bot_id?: string
          capabilities?: Json
          created_at?: string
          health_path?: string | null
          host_id?: string | null
          last_error?: string | null
          last_health_at?: string | null
          last_health_status?: string | null
          manifest?: Json
          mode?: string
          port?: number | null
          public_url?: string | null
          state?: string
          updated_at?: string
          version_id?: string | null
          webhook_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_runtimes_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: true
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_runtimes_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "runtime_hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_runtimes_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "bot_project_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_settings: {
        Row: {
          allow_unknown_commands: boolean
          bot_id: string
          config: Json
          log_updates: boolean
          updated_at: string
        }
        Insert: {
          allow_unknown_commands?: boolean
          bot_id: string
          config?: Json
          log_updates?: boolean
          updated_at?: string
        }
        Update: {
          allow_unknown_commands?: boolean
          bot_id?: string
          config?: Json
          log_updates?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_settings_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: true
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_users: {
        Row: {
          bot_id: string
          created_at: string
          first_name: string | null
          id: string
          is_blocked: boolean
          joined_at: string
          last_name: string | null
          last_seen_at: string
          request_count: number
          search_count: number
          telegram_id: number
          updated_at: string
          username: string | null
        }
        Insert: {
          bot_id: string
          created_at?: string
          first_name?: string | null
          id?: string
          is_blocked?: boolean
          joined_at?: string
          last_name?: string | null
          last_seen_at?: string
          request_count?: number
          search_count?: number
          telegram_id: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          bot_id?: string
          created_at?: string
          first_name?: string | null
          id?: string
          is_blocked?: boolean
          joined_at?: string
          last_name?: string | null
          last_seen_at?: string
          request_count?: number
          search_count?: number
          telegram_id?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_users_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_webhooks: {
        Row: {
          bot_id: string
          is_registered: boolean
          last_error_date: string | null
          last_error_message: string | null
          last_verified_at: string | null
          pending_update_count: number | null
          updated_at: string
          url: string | null
        }
        Insert: {
          bot_id: string
          is_registered?: boolean
          last_error_date?: string | null
          last_error_message?: string | null
          last_verified_at?: string | null
          pending_update_count?: number | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          bot_id?: string
          is_registered?: boolean
          last_error_date?: string | null
          last_error_message?: string | null
          last_verified_at?: string | null
          pending_update_count?: number | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_webhooks_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: true
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      bots: {
        Row: {
          created_at: string
          id: string
          last_activity_at: string | null
          last_crash_at: string | null
          last_deployed_at: string | null
          last_error: string | null
          name: string
          owner_telegram_id: number | null
          restart_count: number
          status: Database["public"]["Enums"]["bot_status"]
          telegram_bot_id: number | null
          telegram_first_name: string | null
          telegram_username: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_activity_at?: string | null
          last_crash_at?: string | null
          last_deployed_at?: string | null
          last_error?: string | null
          name: string
          owner_telegram_id?: number | null
          restart_count?: number
          status?: Database["public"]["Enums"]["bot_status"]
          telegram_bot_id?: number | null
          telegram_first_name?: string | null
          telegram_username?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_activity_at?: string | null
          last_crash_at?: string | null
          last_deployed_at?: string | null
          last_error?: string | null
          name?: string
          owner_telegram_id?: number | null
          restart_count?: number
          status?: Database["public"]["Enums"]["bot_status"]
          telegram_bot_id?: number | null
          telegram_first_name?: string | null
          telegram_username?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cleanup_runs: {
        Row: {
          already_gone: number
          deleted: number
          error: string | null
          failed: number
          finished_at: string | null
          found: number
          id: string
          ok: boolean
          started_at: string
        }
        Insert: {
          already_gone?: number
          deleted?: number
          error?: string | null
          failed?: number
          finished_at?: string | null
          found?: number
          id?: string
          ok?: boolean
          started_at?: string
        }
        Update: {
          already_gone?: number
          deleted?: number
          error?: string | null
          failed?: number
          finished_at?: string | null
          found?: number
          id?: string
          ok?: boolean
          started_at?: string
        }
        Relationships: []
      }
      deployment_logs: {
        Row: {
          bot_id: string
          created_at: string
          deployment_id: string
          id: string
          message: string | null
          status: string
          step: string
        }
        Insert: {
          bot_id: string
          created_at?: string
          deployment_id: string
          id?: string
          message?: string | null
          status: string
          step: string
        }
        Update: {
          bot_id?: string
          created_at?: string
          deployment_id?: string
          id?: string
          message?: string | null
          status?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "deployment_logs_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deployment_logs_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "bot_deployments"
            referencedColumns: ["id"]
          },
        ]
      }
      force_join_channels: {
        Row: {
          bot_id: string
          chat_id: number
          created_at: string
          id: string
          invite_link: string | null
          is_required: boolean
          last_error: string | null
          title: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          bot_id: string
          chat_id: number
          created_at?: string
          id?: string
          invite_link?: string | null
          is_required?: boolean
          last_error?: string | null
          title?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          bot_id?: string
          chat_id?: number
          created_at?: string
          id?: string
          invite_link?: string | null
          is_required?: boolean
          last_error?: string | null
          title?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "force_join_channels_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          bot_id: string
          caption: string | null
          created_at: string
          file_id: string
          file_name: string | null
          file_size: number | null
          file_unique_id: string | null
          id: string
          media_type: string
          message_id: number
          storage_chat_id: number
        }
        Insert: {
          bot_id: string
          caption?: string | null
          created_at?: string
          file_id: string
          file_name?: string | null
          file_size?: number | null
          file_unique_id?: string | null
          id?: string
          media_type: string
          message_id: number
          storage_chat_id: number
        }
        Update: {
          bot_id?: string
          caption?: string | null
          created_at?: string
          file_id?: string
          file_name?: string | null
          file_size?: number | null
          file_unique_id?: string | null
          id?: string
          media_type?: string
          message_id?: number
          storage_chat_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "media_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      media_library: {
        Row: {
          added_by: number | null
          bot_id: string
          caption: string | null
          created_at: string
          description: string | null
          download_url: string | null
          file_id: string | null
          file_size: number | null
          file_unique_id: string | null
          genre: string | null
          id: string
          language: string | null
          media_type: string
          message_id: number | null
          normalized_title: string
          poster_file_id: string | null
          quality: string | null
          storage_channel_id: number | null
          title: string
          updated_at: string
          views: number
          watch_url: string | null
          year: number | null
        }
        Insert: {
          added_by?: number | null
          bot_id: string
          caption?: string | null
          created_at?: string
          description?: string | null
          download_url?: string | null
          file_id?: string | null
          file_size?: number | null
          file_unique_id?: string | null
          genre?: string | null
          id?: string
          language?: string | null
          media_type?: string
          message_id?: number | null
          normalized_title: string
          poster_file_id?: string | null
          quality?: string | null
          storage_channel_id?: number | null
          title: string
          updated_at?: string
          views?: number
          watch_url?: string | null
          year?: number | null
        }
        Update: {
          added_by?: number | null
          bot_id?: string
          caption?: string | null
          created_at?: string
          description?: string | null
          download_url?: string | null
          file_id?: string | null
          file_size?: number | null
          file_unique_id?: string | null
          genre?: string | null
          id?: string
          language?: string | null
          media_type?: string
          message_id?: number | null
          normalized_title?: string
          poster_file_id?: string | null
          quality?: string | null
          storage_channel_id?: number | null
          title?: string
          updated_at?: string
          views?: number
          watch_url?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_library_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      media_requests: {
        Row: {
          bot_id: string
          created_at: string
          display_name: string | null
          handled_at: string | null
          handled_by: number | null
          id: string
          status: string
          telegram_id: number
          title: string
          updated_at: string
          username: string | null
        }
        Insert: {
          bot_id: string
          created_at?: string
          display_name?: string | null
          handled_at?: string | null
          handled_by?: number | null
          id?: string
          status?: string
          telegram_id: number
          title: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          bot_id?: string
          created_at?: string
          display_name?: string | null
          handled_at?: string | null
          handled_by?: number | null
          id?: string
          status?: string
          telegram_id?: number
          title?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_requests_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          action: string
          created_at: string
          id: string
          subject: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          subject: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          subject?: string
        }
        Relationships: []
      }
      runtime_hosts: {
        Row: {
          agent_version: string | null
          base_url: string
          capabilities: Json
          created_at: string
          id: string
          kind: string
          last_error: string | null
          last_heartbeat_at: string | null
          name: string
          status: string
          token_sha256: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_version?: string | null
          base_url: string
          capabilities?: Json
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          last_heartbeat_at?: string | null
          name: string
          status?: string
          token_sha256: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_version?: string | null
          base_url?: string
          capabilities?: Json
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          last_heartbeat_at?: string | null
          name?: string
          status?: string
          token_sha256?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      runtime_jobs: {
        Row: {
          attempts: number
          bot_id: string
          claimed_at: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          host_id: string | null
          id: string
          payload: Json
          result: Json | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          bot_id: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          host_id?: string | null
          id?: string
          payload?: Json
          result?: Json | null
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          bot_id?: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          host_id?: string | null
          id?: string
          payload?: Json
          result?: Json | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "runtime_jobs_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runtime_jobs_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "runtime_hosts"
            referencedColumns: ["id"]
          },
        ]
      }
      runtime_locks: {
        Row: {
          bot_id: string | null
          created_at: string
          expires_at: string
          key: string
        }
        Insert: {
          bot_id?: string | null
          created_at?: string
          expires_at: string
          key: string
        }
        Update: {
          bot_id?: string | null
          created_at?: string
          expires_at?: string
          key?: string
        }
        Relationships: []
      }
      runtime_logs: {
        Row: {
          bot_id: string | null
          created_at: string
          event: string
          id: string
          level: string
          message: string | null
          meta: Json
          status: string | null
          update_id: number | null
          user_id: string | null
        }
        Insert: {
          bot_id?: string | null
          created_at?: string
          event: string
          id?: string
          level: string
          message?: string | null
          meta?: Json
          status?: string | null
          update_id?: number | null
          user_id?: string | null
        }
        Update: {
          bot_id?: string | null
          created_at?: string
          event?: string
          id?: string
          level?: string
          message?: string | null
          meta?: Json
          status?: string | null
          update_id?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "runtime_logs_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_deletions: {
        Row: {
          attempts: number
          bot_id: string
          chat_id: number
          created_at: string
          delete_at: string
          deleted_at: string | null
          expires_at: string
          id: string
          last_error: string | null
          link_message_id: number | null
          message_id: number
          status: string
          warning_message_id: number | null
        }
        Insert: {
          attempts?: number
          bot_id: string
          chat_id: number
          created_at?: string
          delete_at: string
          deleted_at?: string | null
          expires_at?: string
          id?: string
          last_error?: string | null
          link_message_id?: number | null
          message_id: number
          status?: string
          warning_message_id?: number | null
        }
        Update: {
          attempts?: number
          bot_id?: string
          chat_id?: number
          created_at?: string
          delete_at?: string
          deleted_at?: string | null
          expires_at?: string
          id?: string
          last_error?: string | null
          link_message_id?: number | null
          message_id?: number
          status?: string
          warning_message_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_deletions_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_channels: {
        Row: {
          bot_id: string
          bot_is_admin: boolean
          can_post_messages: boolean | null
          chat_id: number
          created_at: string
          id: string
          last_error: string | null
          title: string | null
          type: string | null
          verified_at: string | null
        }
        Insert: {
          bot_id: string
          bot_is_admin?: boolean
          can_post_messages?: boolean | null
          chat_id: number
          created_at?: string
          id?: string
          last_error?: string | null
          title?: string | null
          type?: string | null
          verified_at?: string | null
        }
        Update: {
          bot_id?: string
          bot_is_admin?: boolean
          can_post_messages?: boolean | null
          chat_id?: number
          created_at?: string
          id?: string
          last_error?: string | null
          title?: string | null
          type?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storage_channels_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_updates: {
        Row: {
          bot_id: string
          chat_id: number | null
          from_user_id: number | null
          handler: string | null
          id: string
          processed_at: string
          status: string | null
          update_id: number
          update_type: string | null
        }
        Insert: {
          bot_id: string
          chat_id?: number | null
          from_user_id?: number | null
          handler?: string | null
          id?: string
          processed_at?: string
          status?: string | null
          update_id: number
          update_type?: string | null
        }
        Update: {
          bot_id?: string
          chat_id?: number | null
          from_user_id?: number | null
          handler?: string | null
          id?: string
          processed_at?: string
          status?: string | null
          update_id?: number
          update_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_updates_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
        ]
      }
      user_history: {
        Row: {
          bot_id: string
          created_at: string
          id: string
          kind: string
          media_id: string | null
          query: string | null
          result_count: number | null
          telegram_id: number
        }
        Insert: {
          bot_id: string
          created_at?: string
          id?: string
          kind: string
          media_id?: string | null
          query?: string | null
          result_count?: number | null
          telegram_id: number
        }
        Update: {
          bot_id?: string
          created_at?: string
          id?: string
          kind?: string
          media_id?: string | null
          query?: string | null
          result_count?: number | null
          telegram_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_history_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_history_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_library"
            referencedColumns: ["id"]
          },
        ]
      }
      user_media_marks: {
        Row: {
          bot_id: string
          created_at: string
          id: string
          kind: string
          media_id: string
          telegram_id: number
        }
        Insert: {
          bot_id: string
          created_at?: string
          id?: string
          kind: string
          media_id: string
          telegram_id: number
        }
        Update: {
          bot_id?: string
          created_at?: string
          id?: string
          kind?: string
          media_id?: string
          telegram_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_media_marks_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_media_marks_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_library"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      bot_status:
        | "NOT_DEPLOYED"
        | "ANALYZING"
        | "NEEDS_ADAPTATION"
        | "DEPLOYING"
        | "RUNNING"
        | "STOPPED"
        | "ERROR"
        | "WEBHOOK_ERROR"
        | "STARTING"
        | "RESTARTING"
      compat_status: "READY" | "NEEDS_ADAPTATION" | "INCOMPATIBLE"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      bot_status: [
        "NOT_DEPLOYED",
        "ANALYZING",
        "NEEDS_ADAPTATION",
        "DEPLOYING",
        "RUNNING",
        "STOPPED",
        "ERROR",
        "WEBHOOK_ERROR",
        "STARTING",
        "RESTARTING",
      ],
      compat_status: ["READY", "NEEDS_ADAPTATION", "INCOMPATIBLE"],
    },
  },
} as const
