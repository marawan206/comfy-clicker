/**
 * Row types mirroring `supabase/migrations/0001_init.sql` + `0003_hub_integrity.sql`, shaped like the output of
 * `supabase gen types` so they plug into `SupabaseClient<Database>` generics.
 *
 * Keep this file in sync with the migration by hand (the schema is small).
 * Rows are type aliases, not interfaces: supabase-js constrains `Row` to `Record<string, unknown>`,
 * which an interface never satisfies, and the whole schema would silently collapse to `never`.
 * `numeric` columns arrive as JSON numbers; timestamps as ISO strings; `date` as YYYY-MM-DD.
 */
import type { Precision } from '@/game/types'

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export type ProfileRow = {
  id: string
  handle: string
  avatar_seed: number
  created_at: string
}

export type SaveRow = {
  user_id: string
  version: number
  /** Serialized GameState (see src/game/save.ts). Opaque to the server. */
  state: Json
  cps: number
  lifetime_credits: number
  followers: number
  season: number
  saved_at: string
}

export type DailyLoginRow = {
  user_id: string
  /** UTC day key, YYYY-MM-DD. */
  day: string
  streak: number
}

export type HubWorkflowRow = {
  id: string
  author_id: string
  name: string
  model_id: string
  precision: Precision
  lora_tag: string | null
  upscaler: boolean
  hashtags: string[]
  runs_24h: number
  runs_total: number
  rep: number
  /** Sum of hub_runs.royalty, maintained by the insert trigger (0003). */
  royalties_total: number
  created_at: string
}

export type HubRunRow = {
  id: string
  workflow_id: string
  runner_id: string
  credits_paid: number
  royalty: number
  /** Rep the author earned from this run (0003). */
  rep: number
  /** When the author's game collected this run; null = unclaimed (0003). */
  claimed_at: string | null
  created_at: string
}

export type FeedItemRow = {
  id: string
  source: string
  author: string
  handle: string
  avatar_url: string | null
  url: string
  text: string
  date: string
  likes: number | null
  media_url: string | null
  tags: string[]
  verified: boolean
  fetched_at: string
}

export type TrendingTagsRow = {
  id: number
  tags: string[]
  computed_at: string
}

export type FeedMetaRow = {
  key: string
  updated_at: string
  errors: Json
}

export type LeaderboardRow = {
  user_id: string
  handle: string
  cps: number
  lifetime_credits: number
  followers: number
  season: number
}

// ---------------------------------------------------------------------------
// Database (supabase-js generic)
// ---------------------------------------------------------------------------
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow
        Insert: { id: string; handle: string; avatar_seed?: number; created_at?: string }
        Update: Partial<ProfileRow>
        Relationships: []
      }
      saves: {
        Row: SaveRow
        Insert: {
          user_id: string
          version: number
          state: Json
          cps?: number
          lifetime_credits?: number
          followers?: number
          season?: number
          saved_at?: string
        }
        Update: Partial<SaveRow>
        Relationships: []
      }
      daily_logins: {
        Row: DailyLoginRow
        Insert: { user_id: string; day: string; streak?: number }
        Update: Partial<DailyLoginRow>
        Relationships: []
      }
      hub_workflows: {
        Row: HubWorkflowRow
        Insert: {
          id?: string
          author_id: string
          name: string
          model_id: string
          precision: Precision
          lora_tag?: string | null
          upscaler?: boolean
          hashtags?: string[]
          runs_24h?: number
          runs_total?: number
          rep?: number
          royalties_total?: number
          created_at?: string
        }
        Update: Partial<HubWorkflowRow>
        Relationships: [
          {
            foreignKeyName: 'hub_workflows_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      hub_runs: {
        Row: HubRunRow
        Insert: {
          id?: string
          workflow_id: string
          runner_id: string
          credits_paid?: number
          royalty?: number
          rep?: number
          claimed_at?: string | null
          created_at?: string
        }
        Update: Partial<HubRunRow>
        Relationships: [
          {
            foreignKeyName: 'hub_runs_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'hub_workflows'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'hub_runs_runner_id_fkey'
            columns: ['runner_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      feed_items: {
        Row: FeedItemRow
        Insert: {
          id: string
          source: string
          author: string
          handle: string
          avatar_url?: string | null
          url: string
          text: string
          date: string
          likes?: number | null
          media_url?: string | null
          tags?: string[]
          verified?: boolean
          fetched_at?: string
        }
        Update: Partial<FeedItemRow>
        Relationships: []
      }
      trending_tags: {
        Row: TrendingTagsRow
        Insert: { id?: number; tags: string[]; computed_at?: string }
        Update: Partial<TrendingTagsRow>
        Relationships: []
      }
      feed_meta: {
        Row: FeedMetaRow
        Insert: { key: string; updated_at?: string; errors?: Json }
        Update: Partial<FeedMetaRow>
        Relationships: []
      }
    }
    Views: {
      leaderboard: {
        Row: LeaderboardRow
        Relationships: []
      }
    }
    Functions: {
      /** Service role only. Returns the number of hub_workflows rows whose runs_24h changed. */
      refresh_hub_runs_24h: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      /** Service role only. Marks the author's unclaimed hub_runs as claimed; one summary row. */
      claim_hub_royalties: {
        Args: { p_author: string }
        Returns: { runs: number; royalty: number; rep: number }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export type TableName = keyof Database['public']['Tables']
export type Tables<T extends TableName> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends TableName> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends TableName> = Database['public']['Tables'][T]['Update']
export type ViewName = keyof Database['public']['Views']
export type Views<V extends ViewName> = Database['public']['Views'][V]['Row']
