export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }
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
      comments: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: Database['public']['Enums']['comment_kind']
          listing_id: string
          photo_paths: string[]
          ratings: Json | null
          user_id: string
        }
        ComputedFields: never
        Insert: {
          body?: string
          created_at?: string
          id?: string
          kind?: Database['public']['Enums']['comment_kind']
          listing_id: string
          photo_paths?: string[]
          ratings?: Json | null
          user_id?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: Database['public']['Enums']['comment_kind']
          listing_id?: string
          photo_paths?: string[]
          ratings?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'comments_listing_id_fkey'
            columns: ['listing_id']
            isOneToOne: false
            referencedRelation: 'listings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      domain_fetch_slots: {
        Row: {
          domain: string
          next_slot_at: string
        }
        ComputedFields: never
        Insert: {
          domain: string
          next_slot_at?: string
        }
        Update: {
          domain?: string
          next_slot_at?: string
        }
        Relationships: []
      }
      geocode_cache: {
        Row: {
          created_at: string
          display_name: string | null
          lat: number | null
          lng: number | null
          query: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          display_name?: string | null
          lat?: number | null
          lng?: number | null
          query: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          lat?: number | null
          lng?: number | null
          query?: string
        }
        Relationships: []
      }
      hunt_invites: {
        Row: {
          created_by: string
          expires_at: string
          hunt_id: string
          id: string
          token: string
          used_at: string | null
          used_by: string | null
        }
        ComputedFields: never
        Insert: {
          created_by?: string
          expires_at?: string
          hunt_id: string
          id?: string
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          created_by?: string
          expires_at?: string
          hunt_id?: string
          id?: string
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'hunt_invites_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'hunt_invites_hunt_id_fkey'
            columns: ['hunt_id']
            isOneToOne: false
            referencedRelation: 'hunts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'hunt_invites_used_by_fkey'
            columns: ['used_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      hunt_members: {
        Row: {
          hunt_id: string
          joined_at: string
          role: Database['public']['Enums']['hunt_role']
          user_id: string
        }
        ComputedFields: never
        Insert: {
          hunt_id: string
          joined_at?: string
          role?: Database['public']['Enums']['hunt_role']
          user_id: string
        }
        Update: {
          hunt_id?: string
          joined_at?: string
          role?: Database['public']['Enums']['hunt_role']
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'hunt_members_hunt_id_fkey'
            columns: ['hunt_id']
            isOneToOne: false
            referencedRelation: 'hunts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'hunt_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      hunts: {
        Row: {
          city: string
          created_at: string
          created_by: string
          criteria: NonNullable<Json>
          id: string
          name: string
          reveal_votes_after_both: boolean
        }
        ComputedFields: never
        Insert: {
          city?: string
          created_at?: string
          created_by: string
          criteria?: NonNullable<Json>
          id?: string
          name: string
          reveal_votes_after_both?: boolean
        }
        Update: {
          city?: string
          created_at?: string
          created_by?: string
          criteria?: NonNullable<Json>
          id?: string
          name?: string
          reveal_votes_after_both?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'hunts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      listing_events: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          payload: NonNullable<Json>
          type: string
          user_id: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          payload?: NonNullable<Json>
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          payload?: NonNullable<Json>
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'listing_events_listing_id_fkey'
            columns: ['listing_id']
            isOneToOne: false
            referencedRelation: 'listings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'listing_events_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      listing_photos: {
        Row: {
          broken: boolean
          id: string
          is_cover: boolean
          listing_id: string
          original_url: string | null
          position: number
          storage_path: string | null
        }
        ComputedFields: never
        Insert: {
          broken?: boolean
          id?: string
          is_cover?: boolean
          listing_id: string
          original_url?: string | null
          position?: number
          storage_path?: string | null
        }
        Update: {
          broken?: boolean
          id?: string
          is_cover?: boolean
          listing_id?: string
          original_url?: string | null
          position?: number
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'listing_photos_listing_id_fkey'
            columns: ['listing_id']
            isOneToOne: false
            referencedRelation: 'listings'
            referencedColumns: ['id']
          },
        ]
      }
      listing_price_history: {
        Row: {
          admin_fee: number | null
          id: string
          listing_id: string
          observed_at: string
          rent: number | null
        }
        ComputedFields: never
        Insert: {
          admin_fee?: number | null
          id?: string
          listing_id: string
          observed_at?: string
          rent?: number | null
        }
        Update: {
          admin_fee?: number | null
          id?: string
          listing_id?: string
          observed_at?: string
          rent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'listing_price_history_listing_id_fkey'
            columns: ['listing_id']
            isOneToOne: false
            referencedRelation: 'listings'
            referencedColumns: ['id']
          },
        ]
      }
      listing_routes: {
        Row: {
          arrives_at: string | null
          computed_at: string
          departs_at: string | null
          duration_min: number | null
          legs: NonNullable<Json>
          listing_id: string
          pin_id: string
          provider: string
          status: string
          transfers: number | null
          walk_min: number | null
        }
        ComputedFields: never
        Insert: {
          arrives_at?: string | null
          computed_at?: string
          departs_at?: string | null
          duration_min?: number | null
          legs?: NonNullable<Json>
          listing_id: string
          pin_id: string
          provider?: string
          status: string
          transfers?: number | null
          walk_min?: number | null
        }
        Update: {
          arrives_at?: string | null
          computed_at?: string
          departs_at?: string | null
          duration_min?: number | null
          legs?: NonNullable<Json>
          listing_id?: string
          pin_id?: string
          provider?: string
          status?: string
          transfers?: number | null
          walk_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'listing_routes_listing_id_fkey'
            columns: ['listing_id']
            isOneToOne: false
            referencedRelation: 'listings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'listing_routes_pin_id_fkey'
            columns: ['pin_id']
            isOneToOne: false
            referencedRelation: 'pins'
            referencedColumns: ['id']
          },
        ]
      }
      listings: {
        Row: {
          added_by: string | null
          address: string | null
          admin_fee: number | null
          advertiser_type: Database['public']['Enums']['advertiser_type']
          area_m2: number | null
          available_from: string | null
          canonical_url: string | null
          created_at: string
          deposit: number | null
          description: string | null
          district: string | null
          features: NonNullable<Json>
          floor: number | null
          hunt_id: string
          id: string
          is_active: boolean
          last_checked_at: string | null
          lat: number | null
          lng: number | null
          merged_urls: string[]
          needs_details: boolean
          parse_confidence: number | null
          raw: Json | null
          rent: number | null
          rooms: number | null
          source: Database['public']['Enums']['listing_source']
          status: Database['public']['Enums']['listing_status']
          title: string | null
          total_floors: number | null
          updated_at: string
          url: string | null
          utilities_estimate: number | null
          viewing_at: string | null
        }
        ComputedFields: never
        Insert: {
          added_by?: string | null
          address?: string | null
          admin_fee?: number | null
          advertiser_type?: Database['public']['Enums']['advertiser_type']
          area_m2?: number | null
          available_from?: string | null
          canonical_url?: string | null
          created_at?: string
          deposit?: number | null
          description?: string | null
          district?: string | null
          features?: NonNullable<Json>
          floor?: number | null
          hunt_id: string
          id?: string
          is_active?: boolean
          last_checked_at?: string | null
          lat?: number | null
          lng?: number | null
          merged_urls?: string[]
          needs_details?: boolean
          parse_confidence?: number | null
          raw?: Json | null
          rent?: number | null
          rooms?: number | null
          source?: Database['public']['Enums']['listing_source']
          status?: Database['public']['Enums']['listing_status']
          title?: string | null
          total_floors?: number | null
          updated_at?: string
          url?: string | null
          utilities_estimate?: number | null
          viewing_at?: string | null
        }
        Update: {
          added_by?: string | null
          address?: string | null
          admin_fee?: number | null
          advertiser_type?: Database['public']['Enums']['advertiser_type']
          area_m2?: number | null
          available_from?: string | null
          canonical_url?: string | null
          created_at?: string
          deposit?: number | null
          description?: string | null
          district?: string | null
          features?: NonNullable<Json>
          floor?: number | null
          hunt_id?: string
          id?: string
          is_active?: boolean
          last_checked_at?: string | null
          lat?: number | null
          lng?: number | null
          merged_urls?: string[]
          needs_details?: boolean
          parse_confidence?: number | null
          raw?: Json | null
          rent?: number | null
          rooms?: number | null
          source?: Database['public']['Enums']['listing_source']
          status?: Database['public']['Enums']['listing_status']
          title?: string | null
          total_floors?: number | null
          updated_at?: string
          url?: string | null
          utilities_estimate?: number | null
          viewing_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'listings_added_by_fkey'
            columns: ['added_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'listings_hunt_id_fkey'
            columns: ['hunt_id']
            isOneToOne: false
            referencedRelation: 'hunts'
            referencedColumns: ['id']
          },
        ]
      }
      notification_prefs: {
        Row: {
          ad_removed: boolean
          listing_added: boolean
          match: boolean
          price_dropped: boolean
          reconsider_request: boolean
          status_changed: boolean
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          ad_removed?: boolean
          listing_added?: boolean
          match?: boolean
          price_dropped?: boolean
          reconsider_request?: boolean
          status_changed?: boolean
          updated_at?: string
          user_id?: string
        }
        Update: {
          ad_removed?: boolean
          listing_added?: boolean
          match?: boolean
          price_dropped?: boolean
          reconsider_request?: boolean
          status_changed?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notification_prefs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          event_id: string | null
          hunt_id: string
          id: string
          kind: Database['public']['Enums']['notification_kind']
          listing_id: string | null
          payload: NonNullable<Json>
          pushed_at: string | null
          read_at: string | null
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          event_id?: string | null
          hunt_id: string
          id?: string
          kind: Database['public']['Enums']['notification_kind']
          listing_id?: string | null
          payload?: NonNullable<Json>
          pushed_at?: string | null
          read_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          hunt_id?: string
          id?: string
          kind?: Database['public']['Enums']['notification_kind']
          listing_id?: string | null
          payload?: NonNullable<Json>
          pushed_at?: string | null
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'listing_events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_hunt_id_fkey'
            columns: ['hunt_id']
            isOneToOne: false
            referencedRelation: 'hunts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_listing_id_fkey'
            columns: ['listing_id']
            isOneToOne: false
            referencedRelation: 'listings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      pins: {
        Row: {
          arrive_time: string
          arrive_weekday: number
          hunt_id: string
          id: string
          kind: Database['public']['Enums']['pin_kind']
          label: string
          lat: number
          lng: number
        }
        ComputedFields: never
        Insert: {
          arrive_time?: string
          arrive_weekday?: number
          hunt_id: string
          id?: string
          kind?: Database['public']['Enums']['pin_kind']
          label: string
          lat: number
          lng: number
        }
        Update: {
          arrive_time?: string
          arrive_weekday?: number
          hunt_id?: string
          id?: string
          kind?: Database['public']['Enums']['pin_kind']
          label?: string
          lat?: number
          lng?: number
        }
        Relationships: [
          {
            foreignKeyName: 'pins_hunt_id_fkey'
            columns: ['hunt_id']
            isOneToOne: false
            referencedRelation: 'hunts'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
        }
        ComputedFields: never
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        ComputedFields: never
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id?: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'push_subscriptions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      reconsider_requests: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          note: string | null
          outcome: Database['public']['Enums']['swipe'] | null
          requested_by: string
          resolved_at: string | null
          target_user: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          note?: string | null
          outcome?: Database['public']['Enums']['swipe'] | null
          requested_by: string
          resolved_at?: string | null
          target_user: string
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          note?: string | null
          outcome?: Database['public']['Enums']['swipe'] | null
          requested_by?: string
          resolved_at?: string | null
          target_user?: string
        }
        Relationships: [
          {
            foreignKeyName: 'reconsider_requests_listing_id_fkey'
            columns: ['listing_id']
            isOneToOne: false
            referencedRelation: 'listings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reconsider_requests_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reconsider_requests_target_user_fkey'
            columns: ['target_user']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      signup_allowlist: {
        Row: {
          added_at: string
          entry: string
        }
        ComputedFields: never
        Insert: {
          added_at?: string
          entry: string
        }
        Update: {
          added_at?: string
          entry?: string
        }
        Relationships: []
      }
      votes: {
        Row: {
          listing_id: string
          stars: number | null
          swipe: Database['public']['Enums']['swipe']
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          listing_id: string
          stars?: number | null
          swipe: Database['public']['Enums']['swipe']
          updated_at?: string
          user_id?: string
        }
        Update: {
          listing_id?: string
          stars?: number | null
          swipe?: Database['public']['Enums']['swipe']
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'votes_listing_id_fkey'
            columns: ['listing_id']
            isOneToOne: false
            referencedRelation: 'listings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'votes_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_fetch_slot: { Args: { p_domain: string; p_interval_ms?: number }; Returns: number }
      create_hunt: {
        Args: { p_city?: string; p_criteria?: Json; p_name: string }
        Returns: {
          city: string
          created_at: string
          created_by: string
          criteria: NonNullable<Json>
          id: string
          name: string
          reveal_votes_after_both: boolean
        }
        SetofOptions: {
          from: '*'
          to: 'hunts'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      haversine_km: {
        Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }
        Returns: number
      }
      hunt_listing_summaries: {
        Args: { p_hunt_id: string }
        Returns: {
          combined_score: number
          criteria_violations: Json
          is_disagreement: boolean
          is_match: boolean
          is_maybe: boolean
          listing_id: string
          member_count: number
          member_votes: Json
          my_stars: number
          my_swipe: Database['public']['Enums']['swipe']
          reconsider_pending: boolean
          still_no: boolean
          total_monthly: number
          voted_count: number
          votes_revealed: boolean
        }[]
      }
      invite_preview: {
        Args: { p_token: string }
        Returns: {
          already_member: boolean
          expires_at: string
          hunt_id: string
          hunt_name: string
          invited_by: string
          is_valid: boolean
        }[]
      }
      is_hunt_member: { Args: { p_hunt_id: string }; Returns: boolean }
      is_hunt_owner: { Args: { p_hunt_id: string }; Returns: boolean }
      is_listing_member: { Args: { p_listing_id: string }; Returns: boolean }
      jsonb_date: { Args: { p: Json }; Returns: string }
      jsonb_number: { Args: { p: Json }; Returns: number }
      listing_criteria_violations: {
        Args: {
          p_criteria: Json
          p_listing: Omit<
            Database['public']['Tables']['listings']['Row'],
            Database['public']['Tables']['listings']['ComputedFields']
          >
        }
        Returns: Json
      }
      listing_possible_duplicates: {
        Args: { p_listing_id: string }
        Returns: {
          area_m2: number
          district: string
          id: string
          rent: number
          title: string
          url: string
        }[]
      }
      listings_due_for_check: {
        Args: { p_active_after?: string; p_inactive_after?: string; p_limit?: number }
        Returns: {
          hunt_id: string
          id: string
          is_active: boolean
          last_checked_at: string
          rent: number
          total_due: number
          url: string
        }[]
      }
      merge_listings: { Args: { p_drop: string; p_keep: string }; Returns: string }
      next_deck_cards: {
        Args: { p_hunt_id: string; p_limit?: number }
        Returns: {
          deck_group: number
          listing_id: string
          reconsider_note: string
          reconsider_pending: boolean
          reconsider_request_id: string
          reconsider_requested_by: string
          rejected_by: string[]
          still_no: boolean
        }[]
      }
      read_vault_secret: { Args: { p_name: string }; Returns: string }
      record_listing_check: {
        Args: { p_admin_fee?: number; p_listing_id: string; p_rent?: number; p_result: string }
        Returns: string[]
      }
      redeem_invite: { Args: { p_token: string }; Returns: string }
      request_reconsider: { Args: { p_listing_id: string; p_note?: string }; Returns: Json }
      save_push_subscription: {
        Args: { p_auth: string; p_endpoint: string; p_p256dh: string; p_user_agent?: string }
        Returns: string
      }
      shares_hunt_with: { Args: { p_user_id: string }; Returns: boolean }
      storage_hunt_id: { Args: { p_name: string }; Returns: string }
      valid_viewing_ratings: { Args: { p: Json }; Returns: boolean }
    }
    Enums: {
      advertiser_type: 'private' | 'agency' | 'unknown'
      comment_kind: 'comment' | 'viewing_note'
      hunt_role: 'owner' | 'member'
      listing_source:
        | 'otodom'
        | 'olx'
        | 'gratka'
        | 'morizon'
        | 'nieruchomosci_online'
        | 'domiporta'
        | 'facebook'
        | 'other'
      listing_status:
        'new' | 'contacted' | 'viewing_booked' | 'viewed' | 'applied' | 'won' | 'rejected' | 'gone'
      notification_kind:
        | 'match'
        | 'listing_added'
        | 'reconsider_request'
        | 'status_changed'
        | 'ad_removed'
        | 'price_dropped'
      pin_kind: 'work' | 'station' | 'family' | 'other'
      swipe: 'yes' | 'maybe' | 'no'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      advertiser_type: ['private', 'agency', 'unknown'],
      comment_kind: ['comment', 'viewing_note'],
      hunt_role: ['owner', 'member'],
      listing_source: [
        'otodom',
        'olx',
        'gratka',
        'morizon',
        'nieruchomosci_online',
        'domiporta',
        'facebook',
        'other',
      ],
      listing_status: [
        'new',
        'contacted',
        'viewing_booked',
        'viewed',
        'applied',
        'won',
        'rejected',
        'gone',
      ],
      notification_kind: [
        'match',
        'listing_added',
        'reconsider_request',
        'status_changed',
        'ad_removed',
        'price_dropped',
      ],
      pin_kind: ['work', 'station', 'family', 'other'],
      swipe: ['yes', 'maybe', 'no'],
    },
  },
} as const
