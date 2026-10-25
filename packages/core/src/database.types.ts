export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  concierge: {
    Tables: {
      accounts: {
        Row: {
          auto_topup_on: boolean | null;
          created_at: string;
          funding_mode: string;
          notification_prefs: NonNullable<Json>;
          over_budget_pct: number;
          updated_at: string;
          user_id: string;
          zinc_api_key_secret_id: string | null;
          zinc_connected_at: string | null;
          zinc_webhook_secret_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          auto_topup_on?: boolean | null;
          created_at?: string;
          funding_mode?: string;
          notification_prefs?: NonNullable<Json>;
          over_budget_pct?: number;
          updated_at?: string;
          user_id?: string;
          zinc_api_key_secret_id?: string | null;
          zinc_connected_at?: string | null;
          zinc_webhook_secret_id?: string | null;
        };
        Update: {
          auto_topup_on?: boolean | null;
          created_at?: string;
          funding_mode?: string;
          notification_prefs?: NonNullable<Json>;
          over_budget_pct?: number;
          updated_at?: string;
          user_id?: string;
          zinc_api_key_secret_id?: string | null;
          zinc_connected_at?: string | null;
          zinc_webhook_secret_id?: string | null;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          description: string | null;
          key: string;
          updated_at: string;
          value: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          description?: string | null;
          key: string;
          updated_at?: string;
          value: NonNullable<Json>;
        };
        Update: {
          description?: string | null;
          key?: string;
          updated_at?: string;
          value?: NonNullable<Json>;
        };
        Relationships: [];
      };
      budget_defaults: {
        Row: {
          base_amount_cents: number;
          created_at: string;
          id: string;
          relationship: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          base_amount_cents: number;
          created_at?: string;
          id?: string;
          relationship: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          base_amount_cents?: number;
          created_at?: string;
          id?: string;
          relationship?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      budgets: {
        Row: {
          amount_cents: number;
          created_at: string;
          id: string;
          occasion_kind: string;
          person_id: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount_cents: number;
          created_at?: string;
          id?: string;
          occasion_kind: string;
          person_id: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          id?: string;
          occasion_kind?: string;
          person_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      captures: {
        Row: {
          created_at: string;
          id: string;
          page_title: string | null;
          person_id: string;
          screenshot_path: string | null;
          source_url: string | null;
          status: string;
          text_excerpt: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          page_title?: string | null;
          person_id: string;
          screenshot_path?: string | null;
          source_url?: string | null;
          status?: string;
          text_excerpt?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          page_title?: string | null;
          person_id?: string;
          screenshot_path?: string | null;
          source_url?: string | null;
          status?: string;
          text_excerpt?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      gift_ideas: {
        Row: {
          arrive_by: string | null;
          created_at: string;
          delivery_days_max: number | null;
          delivery_days_min: number | null;
          est_shipping_cents: number;
          est_tax_cents: number;
          est_total_cents: number;
          first_party: boolean | null;
          handling_days_max: number | null;
          id: string;
          offer_id: string | null;
          over_budget: boolean;
          price_cents: number;
          product_url: string | null;
          rank: number;
          reason: string | null;
          retailer: string | null;
          retailer_product_id: string | null;
          round_id: string;
          seller_name: string | null;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          arrive_by?: string | null;
          created_at?: string;
          delivery_days_max?: number | null;
          delivery_days_min?: number | null;
          est_shipping_cents?: number;
          est_tax_cents?: number;
          est_total_cents: number;
          first_party?: boolean | null;
          handling_days_max?: number | null;
          id?: string;
          offer_id?: string | null;
          over_budget?: boolean;
          price_cents: number;
          product_url?: string | null;
          rank: number;
          reason?: string | null;
          retailer?: string | null;
          retailer_product_id?: string | null;
          round_id: string;
          seller_name?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          arrive_by?: string | null;
          created_at?: string;
          delivery_days_max?: number | null;
          delivery_days_min?: number | null;
          est_shipping_cents?: number;
          est_tax_cents?: number;
          est_total_cents?: number;
          first_party?: boolean | null;
          handling_days_max?: number | null;
          id?: string;
          offer_id?: string | null;
          over_budget?: boolean;
          price_cents?: number;
          product_url?: string | null;
          rank?: number;
          reason?: string | null;
          retailer?: string | null;
          retailer_product_id?: string | null;
          round_id?: string;
          seller_name?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gift_ideas_round_id_user_id_fkey";
            columns: ["round_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "gift_rounds";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      gift_rounds: {
        Row: {
          approved_at: string | null;
          attempts: number;
          budget_cents: number;
          created_at: string;
          id: string;
          late: boolean;
          locked_until: string | null;
          next_action_at: string | null;
          occasion_date: string;
          occasion_id: string;
          occasion_year: number;
          person_id: string;
          ship_by_deadline: string;
          status: Database["concierge"]["Enums"]["round_status"];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          approved_at?: string | null;
          attempts?: number;
          budget_cents: number;
          created_at?: string;
          id?: string;
          late?: boolean;
          locked_until?: string | null;
          next_action_at?: string | null;
          occasion_date: string;
          occasion_id: string;
          occasion_year: number;
          person_id: string;
          ship_by_deadline: string;
          status?: Database["concierge"]["Enums"]["round_status"];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          approved_at?: string | null;
          attempts?: number;
          budget_cents?: number;
          created_at?: string;
          id?: string;
          late?: boolean;
          locked_until?: string | null;
          next_action_at?: string | null;
          occasion_date?: string;
          occasion_id?: string;
          occasion_year?: number;
          person_id?: string;
          ship_by_deadline?: string;
          status?: Database["concierge"]["Enums"]["round_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gift_rounds_occasion_id_user_id_fkey";
            columns: ["occasion_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "occasions";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      inbound_messages: {
        Row: {
          attachments: NonNullable<Json>;
          body: string | null;
          created_at: string;
          from_address: string | null;
          id: string;
          matched_person_id: string | null;
          status: string;
          subject: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          attachments?: NonNullable<Json>;
          body?: string | null;
          created_at?: string;
          from_address?: string | null;
          id?: string;
          matched_person_id?: string | null;
          status?: string;
          subject?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          attachments?: NonNullable<Json>;
          body?: string | null;
          created_at?: string;
          from_address?: string | null;
          id?: string;
          matched_person_id?: string | null;
          status?: string;
          subject?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          action_token_hash: string | null;
          channel: string;
          created_at: string;
          id: string;
          kind: string;
          round_id: string | null;
          sent_at: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          action_token_hash?: string | null;
          channel?: string;
          created_at?: string;
          id?: string;
          kind: string;
          round_id?: string | null;
          sent_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          action_token_hash?: string | null;
          channel?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          round_id?: string | null;
          sent_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_round_id_user_id_fkey";
            columns: ["round_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "gift_rounds";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      occasions: {
        Row: {
          created_at: string;
          day: number | null;
          deleted_at: string | null;
          enabled: boolean;
          id: string;
          kind: string;
          month: number | null;
          person_id: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          day?: number | null;
          deleted_at?: string | null;
          enabled?: boolean;
          id?: string;
          kind: string;
          month?: number | null;
          person_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          day?: number | null;
          deleted_at?: string | null;
          enabled?: boolean;
          id?: string;
          kind?: string;
          month?: number | null;
          person_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          created_at: string;
          est_delivery_date: string | null;
          failure_type: string | null;
          fee_cents: number;
          funding_mode: string;
          gift_message: string | null;
          id: string;
          idea_id: string;
          idempotency_key: string;
          is_gift: boolean;
          max_price_cents: number;
          merchant_order_id: string | null;
          packages: NonNullable<Json>;
          provider: string;
          provider_order_id: string | null;
          round_id: string;
          shipping_cents: number | null;
          status: string;
          subtotal_cents: number | null;
          tax_cents: number | null;
          total_cents: number | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          est_delivery_date?: string | null;
          failure_type?: string | null;
          fee_cents: number;
          funding_mode: string;
          gift_message?: string | null;
          id?: string;
          idea_id: string;
          idempotency_key?: string;
          is_gift?: boolean;
          max_price_cents: number;
          merchant_order_id?: string | null;
          packages?: NonNullable<Json>;
          provider?: string;
          provider_order_id?: string | null;
          round_id: string;
          shipping_cents?: number | null;
          status?: string;
          subtotal_cents?: number | null;
          tax_cents?: number | null;
          total_cents?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          est_delivery_date?: string | null;
          failure_type?: string | null;
          fee_cents?: number;
          funding_mode?: string;
          gift_message?: string | null;
          id?: string;
          idea_id?: string;
          idempotency_key?: string;
          is_gift?: boolean;
          max_price_cents?: number;
          merchant_order_id?: string | null;
          packages?: NonNullable<Json>;
          provider?: string;
          provider_order_id?: string | null;
          round_id?: string;
          shipping_cents?: number | null;
          status?: string;
          subtotal_cents?: number | null;
          tax_cents?: number | null;
          total_cents?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_idea_id_round_id_user_id_fkey";
            columns: ["idea_id", "round_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "gift_ideas";
            referencedColumns: ["id", "round_id", "user_id"];
          },
          {
            foreignKeyName: "orders_round_id_user_id_fkey";
            columns: ["round_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "gift_rounds";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      profile_facts: {
        Row: {
          active: boolean;
          category: string;
          confirmed: boolean;
          created_at: string;
          id: string;
          person_id: string;
          source: string;
          source_id: string | null;
          updated_at: string;
          user_id: string;
          value: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          category: string;
          confirmed?: boolean;
          created_at?: string;
          id?: string;
          person_id: string;
          source: string;
          source_id?: string | null;
          updated_at?: string;
          user_id?: string;
          value: string;
        };
        Update: {
          active?: boolean;
          category?: string;
          confirmed?: boolean;
          created_at?: string;
          id?: string;
          person_id?: string;
          source?: string;
          source_id?: string | null;
          updated_at?: string;
          user_id?: string;
          value?: string;
        };
        Relationships: [];
      };
      questions: {
        Row: {
          answer: string | null;
          created_at: string;
          id: string;
          person_id: string;
          prompt: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          answer?: string | null;
          created_at?: string;
          id?: string;
          person_id: string;
          prompt: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          answer?: string | null;
          created_at?: string;
          id?: string;
          person_id?: string;
          prompt?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      reactions: {
        Row: {
          created_at: string;
          id: string;
          note: string | null;
          rating: string;
          round_id: string;
          source: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          note?: string | null;
          rating: string;
          round_id: string;
          source: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          note?: string | null;
          rating?: string;
          round_id?: string;
          source?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reactions_round_id_user_id_fkey";
            columns: ["round_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "gift_rounds";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      rejections: {
        Row: {
          created_at: string;
          id: string;
          idea_id: string | null;
          reason_code: string;
          reason_text: string | null;
          round_id: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          idea_id?: string | null;
          reason_code: string;
          reason_text?: string | null;
          round_id: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          idea_id?: string | null;
          reason_code?: string;
          reason_text?: string | null;
          round_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rejections_idea_id_round_id_user_id_fkey";
            columns: ["idea_id", "round_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "gift_ideas";
            referencedColumns: ["id", "round_id", "user_id"];
          },
          {
            foreignKeyName: "rejections_round_id_user_id_fkey";
            columns: ["round_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "gift_rounds";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      delete_occasion: { Args: { p_occasion_id: string }; Returns: undefined };
      enable_owner_rls: { Args: { p_table: unknown }; Returns: undefined };
      setting_int: { Args: { p_key: string }; Returns: number };
      skip_open_rounds: {
        Args: { p_occasion_id: string; p_person_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      round_status:
        | "scheduled"
        | "generating"
        | "awaiting_approval"
        | "ordered"
        | "delivered"
        | "complete"
        | "needs_address"
        | "needs_attention"
        | "skipped";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      gift_claims: {
        Row: {
          claimed_at: string;
          claimer_id: string | null;
          claimer_name: string;
          item_id: string;
        };
        ComputedFields: never;
        Insert: {
          claimed_at?: string;
          claimer_id?: string | null;
          claimer_name: string;
          item_id: string;
        };
        Update: {
          claimed_at?: string;
          claimer_id?: string | null;
          claimer_name?: string;
          item_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gift_claims_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: true;
            referencedRelation: "list_items";
            referencedColumns: ["id"];
          },
        ];
      };
      list_items: {
        Row: {
          added_at: string;
          asin: string | null;
          id: string;
          image_url: string | null;
          list_id: string;
          name: string;
          position: number;
          price_cents: number;
          product_url: string | null;
          source: string;
        };
        ComputedFields: never;
        Insert: {
          added_at?: string;
          asin?: string | null;
          id?: string;
          image_url?: string | null;
          list_id: string;
          name: string;
          position: number;
          price_cents: number;
          product_url?: string | null;
          source?: string;
        };
        Update: {
          added_at?: string;
          asin?: string | null;
          id?: string;
          image_url?: string | null;
          list_id?: string;
          name?: string;
          position?: number;
          price_cents?: number;
          product_url?: string | null;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "list_items_list_id_fkey";
            columns: ["list_id"];
            isOneToOne: false;
            referencedRelation: "lists";
            referencedColumns: ["id"];
          },
        ];
      };
      lists: {
        Row: {
          created_at: string;
          id: string;
          owner_id: string;
          share_token: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          owner_id?: string;
          share_token?: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          owner_id?: string;
          share_token?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      people: {
        Row: {
          address_checked_at: string | null;
          address_line1: string | null;
          address_line2: string | null;
          birthday: string | null;
          city: string | null;
          country: string;
          created_at: string;
          deleted_at: string | null;
          google_contact_id: string | null;
          id: string;
          linked_user_id: string | null;
          name: string;
          notes: string | null;
          phone: string | null;
          recipient_first_name: string | null;
          recipient_last_name: string | null;
          relationship: string;
          state: string | null;
          updated_at: string;
          user_id: string;
          zip: string | null;
        };
        ComputedFields: never;
        Insert: {
          address_checked_at?: string | null;
          address_line1?: string | null;
          address_line2?: string | null;
          birthday?: string | null;
          city?: string | null;
          country?: string;
          created_at?: string;
          deleted_at?: string | null;
          google_contact_id?: string | null;
          id?: string;
          linked_user_id?: string | null;
          name: string;
          notes?: string | null;
          phone?: string | null;
          recipient_first_name?: string | null;
          recipient_last_name?: string | null;
          relationship: string;
          state?: string | null;
          updated_at?: string;
          user_id?: string;
          zip?: string | null;
        };
        Update: {
          address_checked_at?: string | null;
          address_line1?: string | null;
          address_line2?: string | null;
          birthday?: string | null;
          city?: string | null;
          country?: string;
          created_at?: string;
          deleted_at?: string | null;
          google_contact_id?: string | null;
          id?: string;
          linked_user_id?: string | null;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          recipient_first_name?: string | null;
          recipient_last_name?: string | null;
          relationship?: string;
          state?: string | null;
          updated_at?: string;
          user_id?: string;
          zip?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          email: string | null;
          id: string;
          phone: string | null;
          timezone: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id: string;
          phone?: string | null;
          timezone?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id?: string;
          phone?: string | null;
          timezone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      backfill_profiles: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      claim_gift: {
        Args: { p_item_id: string; p_name: string; p_token: string };
        Returns: Json;
      };
      delete_person: { Args: { p_person_id: string }; Returns: undefined };
      get_shared_list: { Args: { p_token: string }; Returns: Json };
      save_list: {
        Args: { p_items: Json; p_list_id: string; p_title: string };
        Returns: string;
      };
      unclaim_gift: {
        Args: { p_item_id: string; p_token: string };
        Returns: boolean;
      };
      viewer_display_name: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  concierge: {
    Enums: {
      round_status: [
        "scheduled",
        "generating",
        "awaiting_approval",
        "ordered",
        "delivered",
        "complete",
        "needs_address",
        "needs_attention",
        "skipped",
      ],
    },
  },
  public: {
    Enums: {},
  },
} as const;
