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
          buyer_phone: string | null;
          created_at: string;
          funding_mode: string;
          notification_prefs: NonNullable<Json>;
          over_budget_pct: number;
          paid_features: boolean;
          updated_at: string;
          user_id: string;
          zinc_api_key_secret_id: string | null;
          zinc_connected_at: string | null;
          zinc_env: string | null;
          zinc_wallet_event_at: string | null;
          zinc_webhook_id: string | null;
          zinc_webhook_secret_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          auto_topup_on?: boolean | null;
          buyer_phone?: string | null;
          created_at?: string;
          funding_mode?: string;
          notification_prefs?: NonNullable<Json>;
          over_budget_pct?: number;
          paid_features?: boolean;
          updated_at?: string;
          user_id?: string;
          zinc_api_key_secret_id?: string | null;
          zinc_connected_at?: string | null;
          zinc_env?: string | null;
          zinc_wallet_event_at?: string | null;
          zinc_webhook_id?: string | null;
          zinc_webhook_secret_id?: string | null;
        };
        Update: {
          auto_topup_on?: boolean | null;
          buyer_phone?: string | null;
          created_at?: string;
          funding_mode?: string;
          notification_prefs?: NonNullable<Json>;
          over_budget_pct?: number;
          paid_features?: boolean;
          updated_at?: string;
          user_id?: string;
          zinc_api_key_secret_id?: string | null;
          zinc_connected_at?: string | null;
          zinc_env?: string | null;
          zinc_wallet_event_at?: string | null;
          zinc_webhook_id?: string | null;
          zinc_webhook_secret_id?: string | null;
        };
        Relationships: [];
      };
      action_links: {
        Row: {
          action: string;
          created_at: string;
          expires_at: string;
          id: string;
          notification_id: string | null;
          round_id: string | null;
          token_hash: string;
          updated_at: string;
          used_at: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          notification_id?: string | null;
          round_id?: string | null;
          token_hash: string;
          updated_at?: string;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          notification_id?: string | null;
          round_id?: string | null;
          token_hash?: string;
          updated_at?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "action_links_notification_id_fkey";
            columns: ["notification_id"];
            isOneToOne: false;
            referencedRelation: "notifications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "action_links_round_id_user_id_fkey";
            columns: ["round_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "gift_rounds";
            referencedColumns: ["id", "user_id"];
          },
        ];
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
          amount_cents: number | null;
          created_at: string;
          id: string;
          occasion_kind: string;
          person_id: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount_cents?: number | null;
          created_at?: string;
          id?: string;
          occasion_kind: string;
          person_id: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          amount_cents?: number | null;
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
          note: string | null;
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
          note?: string | null;
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
          note?: string | null;
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
          list_item_id: string | null;
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
          source: string;
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
          list_item_id?: string | null;
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
          source?: string;
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
          list_item_id?: string | null;
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
          source?: string;
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
          attention_reason: string | null;
          budget_cents: number | null;
          closed_at: string | null;
          created_at: string;
          emailed_balance_cents: number | null;
          heads_up_on: string | null;
          hold_count: number;
          id: string;
          last_emailed_reason: string | null;
          late: boolean;
          locked_until: string | null;
          next_action_at: string | null;
          occasion_date: string;
          occasion_id: string;
          occasion_year: number;
          person_id: string;
          seen_balance_cents: number | null;
          ship_by_deadline: string;
          status: Database["concierge"]["Enums"]["round_status"];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          approved_at?: string | null;
          attempts?: number;
          attention_reason?: string | null;
          budget_cents?: number | null;
          closed_at?: string | null;
          created_at?: string;
          emailed_balance_cents?: number | null;
          heads_up_on?: string | null;
          hold_count?: number;
          id?: string;
          last_emailed_reason?: string | null;
          late?: boolean;
          locked_until?: string | null;
          next_action_at?: string | null;
          occasion_date: string;
          occasion_id: string;
          occasion_year: number;
          person_id: string;
          seen_balance_cents?: number | null;
          ship_by_deadline: string;
          status?: Database["concierge"]["Enums"]["round_status"];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          approved_at?: string | null;
          attempts?: number;
          attention_reason?: string | null;
          budget_cents?: number | null;
          closed_at?: string | null;
          created_at?: string;
          emailed_balance_cents?: number | null;
          heads_up_on?: string | null;
          hold_count?: number;
          id?: string;
          last_emailed_reason?: string | null;
          late?: boolean;
          locked_until?: string | null;
          next_action_at?: string | null;
          occasion_date?: string;
          occasion_id?: string;
          occasion_year?: number;
          person_id?: string;
          seen_balance_cents?: number | null;
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
          channel: string;
          created_at: string;
          error: string | null;
          id: string;
          kind: string;
          provider_message_id: string | null;
          round_id: string | null;
          sent_at: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          channel?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          kind: string;
          provider_message_id?: string | null;
          round_id?: string | null;
          sent_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          channel?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          kind?: string;
          provider_message_id?: string | null;
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
      order_addresses: {
        Row: {
          address_line1: string;
          address_line2: string | null;
          city: string;
          country: string;
          created_at: string;
          order_id: string;
          phone: string | null;
          recipient_first_name: string;
          recipient_last_name: string;
          state: string;
          updated_at: string;
          user_id: string;
          zip: string;
        };
        ComputedFields: never;
        Insert: {
          address_line1: string;
          address_line2?: string | null;
          city: string;
          country: string;
          created_at?: string;
          order_id: string;
          phone?: string | null;
          recipient_first_name: string;
          recipient_last_name: string;
          state: string;
          updated_at?: string;
          user_id: string;
          zip: string;
        };
        Update: {
          address_line1?: string;
          address_line2?: string | null;
          city?: string;
          country?: string;
          created_at?: string;
          order_id?: string;
          phone?: string | null;
          recipient_first_name?: string;
          recipient_last_name?: string;
          state?: string;
          updated_at?: string;
          user_id?: string;
          zip?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_addresses_order_id_user_id_fkey";
            columns: ["order_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      orders: {
        Row: {
          address_source: string | null;
          created_at: string;
          est_delivery_date: string | null;
          failed_after_close: boolean;
          failure_type: string | null;
          fee_cents: number;
          funding_mode: string;
          gift_message: string | null;
          hold_reason: string | null;
          id: string;
          idea_id: string;
          idempotency_key: string;
          is_gift: boolean;
          max_price_cents: number;
          merchant_order_id: string | null;
          packages: NonNullable<Json>;
          provider: string;
          provider_order_id: string | null;
          resolved: boolean;
          round_id: string;
          ship_city: string;
          ship_state: string;
          ship_to: string;
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
          address_source?: string | null;
          created_at?: string;
          est_delivery_date?: string | null;
          failed_after_close?: boolean;
          failure_type?: string | null;
          fee_cents: number;
          funding_mode: string;
          gift_message?: string | null;
          hold_reason?: string | null;
          id?: string;
          idea_id: string;
          idempotency_key?: string;
          is_gift?: boolean;
          max_price_cents: number;
          merchant_order_id?: string | null;
          packages?: NonNullable<Json>;
          provider?: string;
          provider_order_id?: string | null;
          resolved?: boolean;
          round_id: string;
          ship_city: string;
          ship_state: string;
          ship_to: string;
          shipping_cents?: number | null;
          status?: string;
          subtotal_cents?: number | null;
          tax_cents?: number | null;
          total_cents?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          address_source?: string | null;
          created_at?: string;
          est_delivery_date?: string | null;
          failed_after_close?: boolean;
          failure_type?: string | null;
          fee_cents?: number;
          funding_mode?: string;
          gift_message?: string | null;
          hold_reason?: string | null;
          id?: string;
          idea_id?: string;
          idempotency_key?: string;
          is_gift?: boolean;
          max_price_cents?: number;
          merchant_order_id?: string | null;
          packages?: NonNullable<Json>;
          provider?: string;
          provider_order_id?: string | null;
          resolved?: boolean;
          round_id?: string;
          ship_city?: string;
          ship_state?: string;
          ship_to?: string;
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
          value_key: string | null;
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
          value_key?: never;
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
          value_key?: never;
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
          question_key: string | null;
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
          question_key?: string | null;
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
          question_key?: string | null;
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
      round_sends: {
        Row: {
          created_at: string;
          round_id: string;
          step: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          round_id: string;
          step: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          round_id?: string;
          step?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "round_sends_round_id_user_id_fkey";
            columns: ["round_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "gift_rounds";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      zinc_connect_attempts: {
        Row: {
          created_at: string;
          device_code: string;
          expires_at: string;
          interval_sec: number;
          polling_until: string | null;
          user_code: string;
          user_id: string;
          verification_url: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          device_code: string;
          expires_at: string;
          interval_sec: number;
          polling_until?: string | null;
          user_code: string;
          user_id: string;
          verification_url: string;
        };
        Update: {
          created_at?: string;
          device_code?: string;
          expires_at?: string;
          interval_sec?: number;
          polling_until?: string | null;
          user_code?: string;
          user_id?: string;
          verification_url?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_person: {
        Args: {
          p_address_line1?: string;
          p_address_line2?: string;
          p_anniversary_day?: number;
          p_anniversary_month?: number;
          p_birth_year?: number;
          p_birthday_day?: number;
          p_birthday_month?: number;
          p_city?: string;
          p_country?: string;
          p_google_contact_id?: string;
          p_kinds: string[];
          p_name: string;
          p_recipient_first_name?: string;
          p_recipient_last_name?: string;
          p_relationship: string;
          p_state?: string;
          p_zip?: string;
        };
        Returns: string;
      };
      answer_questions: {
        Args: { p_answers: Json; p_person_id: string };
        Returns: number;
      };
      approve_round: {
        Args: {
          p_lock: string;
          p_orders: Json;
          p_round_id: string;
          p_user_id: string;
        };
        Returns: {
          address_source: string | null;
          created_at: string;
          est_delivery_date: string | null;
          failed_after_close: boolean;
          failure_type: string | null;
          fee_cents: number;
          funding_mode: string;
          gift_message: string | null;
          hold_reason: string | null;
          id: string;
          idea_id: string;
          idempotency_key: string;
          is_gift: boolean;
          max_price_cents: number;
          merchant_order_id: string | null;
          packages: NonNullable<Json>;
          provider: string;
          provider_order_id: string | null;
          resolved: boolean;
          round_id: string;
          ship_city: string;
          ship_state: string;
          ship_to: string;
          shipping_cents: number | null;
          status: string;
          subtotal_cents: number | null;
          tax_cents: number | null;
          total_cents: number | null;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      begin_placing: {
        Args: {
          p_lock: string;
          p_orders: Json;
          p_round_id: string;
          p_today: string;
        };
        Returns: {
          address_source: string | null;
          created_at: string;
          est_delivery_date: string | null;
          failed_after_close: boolean;
          failure_type: string | null;
          fee_cents: number;
          funding_mode: string;
          gift_message: string | null;
          hold_reason: string | null;
          id: string;
          idea_id: string;
          idempotency_key: string;
          is_gift: boolean;
          max_price_cents: number;
          merchant_order_id: string | null;
          packages: NonNullable<Json>;
          provider: string;
          provider_order_id: string | null;
          resolved: boolean;
          round_id: string;
          ship_city: string;
          ship_state: string;
          ship_to: string;
          shipping_cents: number | null;
          status: string;
          subtotal_cents: number | null;
          tax_cents: number | null;
          total_cents: number | null;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      cancel_held: {
        Args: { p_context: string; p_round_id: string };
        Returns: Database["concierge"]["Enums"]["round_status"];
      };
      claim_due_money_rounds: {
        Args: { p_now: string };
        Returns: {
          approved_at: string | null;
          attempts: number;
          attention_reason: string | null;
          budget_cents: number | null;
          closed_at: string | null;
          created_at: string;
          emailed_balance_cents: number | null;
          heads_up_on: string | null;
          hold_count: number;
          id: string;
          last_emailed_reason: string | null;
          late: boolean;
          locked_until: string | null;
          next_action_at: string | null;
          occasion_date: string;
          occasion_id: string;
          occasion_year: number;
          person_id: string;
          seen_balance_cents: number | null;
          ship_by_deadline: string;
          status: Database["concierge"]["Enums"]["round_status"];
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "gift_rounds";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_due_rounds: {
        Args: { p_now: string };
        Returns: {
          approved_at: string | null;
          attempts: number;
          attention_reason: string | null;
          budget_cents: number | null;
          closed_at: string | null;
          created_at: string;
          emailed_balance_cents: number | null;
          heads_up_on: string | null;
          hold_count: number;
          id: string;
          last_emailed_reason: string | null;
          late: boolean;
          locked_until: string | null;
          next_action_at: string | null;
          occasion_date: string;
          occasion_id: string;
          occasion_year: number;
          person_id: string;
          seen_balance_cents: number | null;
          ship_by_deadline: string;
          status: Database["concierge"]["Enums"]["round_status"];
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "gift_rounds";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_round: {
        Args: { p_now: string; p_round_id: string };
        Returns: {
          approved_at: string | null;
          attempts: number;
          attention_reason: string | null;
          budget_cents: number | null;
          closed_at: string | null;
          created_at: string;
          emailed_balance_cents: number | null;
          heads_up_on: string | null;
          hold_count: number;
          id: string;
          last_emailed_reason: string | null;
          late: boolean;
          locked_until: string | null;
          next_action_at: string | null;
          occasion_date: string;
          occasion_id: string;
          occasion_year: number;
          person_id: string;
          seen_balance_cents: number | null;
          ship_by_deadline: string;
          status: Database["concierge"]["Enums"]["round_status"];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "gift_rounds";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      claim_round_now: {
        Args: { p_now: string; p_round_id: string };
        Returns: {
          approved_at: string | null;
          attempts: number;
          attention_reason: string | null;
          budget_cents: number | null;
          closed_at: string | null;
          created_at: string;
          emailed_balance_cents: number | null;
          heads_up_on: string | null;
          hold_count: number;
          id: string;
          last_emailed_reason: string | null;
          late: boolean;
          locked_until: string | null;
          next_action_at: string | null;
          occasion_date: string;
          occasion_id: string;
          occasion_year: number;
          person_id: string;
          seen_balance_cents: number | null;
          ship_by_deadline: string;
          status: Database["concierge"]["Enums"]["round_status"];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "gift_rounds";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      clear_rejected_addresses: {
        Args: { p_round_id: string };
        Returns: undefined;
      };
      delete_occasion: { Args: { p_occasion_id: string }; Returns: undefined };
      enable_owner_rls: { Args: { p_table: unknown }; Returns: undefined };
      fail_order: {
        Args: { p_failure_type: string; p_order_id: string };
        Returns: Database["concierge"]["Enums"]["round_status"];
      };
      fail_order_row: {
        Args: {
          p_failure_type: string;
          p_order: Omit<
            Database["concierge"]["Tables"]["orders"]["Row"],
            Database["concierge"]["Tables"]["orders"]["ComputedFields"]
          >;
        };
        Returns: undefined;
      };
      finish_round: {
        Args: {
          p_heads_up_on: string;
          p_lock: string;
          p_next_action_at: string;
          p_round_id: string;
          p_status: Database["concierge"]["Enums"]["round_status"];
        };
        Returns: boolean;
      };
      gate_held_orders: {
        Args: { p_reason: string; p_round_id: string };
        Returns: Database["concierge"]["Enums"]["round_status"];
      };
      has_paid_features: { Args: { p_user_id: string }; Returns: boolean };
      held_rounds_for_user: {
        Args: { p_user_id: string };
        Returns: {
          approved_at: string | null;
          attempts: number;
          attention_reason: string | null;
          budget_cents: number | null;
          closed_at: string | null;
          created_at: string;
          emailed_balance_cents: number | null;
          heads_up_on: string | null;
          hold_count: number;
          id: string;
          last_emailed_reason: string | null;
          late: boolean;
          locked_until: string | null;
          next_action_at: string | null;
          occasion_date: string;
          occasion_id: string;
          occasion_year: number;
          person_id: string;
          seen_balance_cents: number | null;
          ship_by_deadline: string;
          status: Database["concierge"]["Enums"]["round_status"];
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "gift_rounds";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      hold_orders: {
        Args: { p_reason: string; p_round_id: string };
        Returns: Database["concierge"]["Enums"]["round_status"];
      };
      lookahead_rounds: {
        Args: { p_until: string; p_user_id: string };
        Returns: {
          budget_cents: number;
          orders: Json;
          round_id: string;
          ship_by_deadline: string;
          status: Database["concierge"]["Enums"]["round_status"];
        }[];
      };
      mark_unconfirmed: {
        Args: { p_order_id: string };
        Returns: Database["concierge"]["Enums"]["round_status"];
      };
      order_by_reference: {
        Args: { p_order_id: string; p_user_id: string };
        Returns: {
          address_source: string | null;
          created_at: string;
          est_delivery_date: string | null;
          failed_after_close: boolean;
          failure_type: string | null;
          fee_cents: number;
          funding_mode: string;
          gift_message: string | null;
          hold_reason: string | null;
          id: string;
          idea_id: string;
          idempotency_key: string;
          is_gift: boolean;
          max_price_cents: number;
          merchant_order_id: string | null;
          packages: NonNullable<Json>;
          provider: string;
          provider_order_id: string | null;
          resolved: boolean;
          round_id: string;
          ship_city: string;
          ship_state: string;
          ship_to: string;
          shipping_cents: number | null;
          status: string;
          subtotal_cents: number | null;
          tax_cents: number | null;
          total_cents: number | null;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      reapprove_order: {
        Args: {
          p_lock: string;
          p_max_price_cents: number;
          p_order_id: string;
          p_round_id: string;
          p_user_id: string;
        };
        Returns: {
          address_source: string | null;
          created_at: string;
          est_delivery_date: string | null;
          failed_after_close: boolean;
          failure_type: string | null;
          fee_cents: number;
          funding_mode: string;
          gift_message: string | null;
          hold_reason: string | null;
          id: string;
          idea_id: string;
          idempotency_key: string;
          is_gift: boolean;
          max_price_cents: number;
          merchant_order_id: string | null;
          packages: NonNullable<Json>;
          provider: string;
          provider_order_id: string | null;
          resolved: boolean;
          round_id: string;
          ship_city: string;
          ship_state: string;
          ship_to: string;
          shipping_cents: number | null;
          status: string;
          subtotal_cents: number | null;
          tax_cents: number | null;
          total_cents: number | null;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      reconcile_round: {
        Args: { p_context?: string; p_round_id: string };
        Returns: Database["concierge"]["Enums"]["round_status"];
      };
      record_outcomes: {
        Args: { p_results: Json; p_round_id: string };
        Returns: Database["concierge"]["Enums"]["round_status"];
      };
      release_round: {
        Args: { p_lock: string; p_round_id: string };
        Returns: boolean;
      };
      remove_zinc_secrets: {
        Args: { p_api_key_secret_id: string; p_webhook_secret_id: string };
        Returns: undefined;
      };
      round_candidates: {
        Args: { p_today: string };
        Returns: {
          budget_cents: number;
          day: number;
          kind: string;
          month: number;
          occasion_id: string;
          person_id: string;
          user_id: string;
        }[];
      };
      round_fail_count: { Args: { p_round_id: string }; Returns: number };
      rounds_missing_late_failure_email: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      rounds_with_rejected_addresses: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      set_emailed_balance: {
        Args: { p_cents: number; p_round_id: string };
        Returns: undefined;
      };
      set_last_emailed_reason: {
        Args: { p_reason: string; p_round_id: string };
        Returns: undefined;
      };
      set_seen_balance: {
        Args: { p_cents: number; p_round_id: string };
        Returns: undefined;
      };
      setting_int: { Args: { p_key: string }; Returns: number };
      settle_order: {
        Args: {
          p_failure_type: string;
          p_order_id: string;
          p_price: Json;
          p_status: string;
          p_user_id: string;
        };
        Returns: Database["concierge"]["Enums"]["round_status"];
      };
      shared_address_owner_to_tell: {
        Args: { p_round_id: string };
        Returns: string;
      };
      skip_open_rounds: {
        Args: { p_occasion_id: string; p_person_id: string };
        Returns: undefined;
      };
      stale_placing_orders: {
        Args: { p_now: string };
        Returns: {
          address_source: string | null;
          created_at: string;
          est_delivery_date: string | null;
          failed_after_close: boolean;
          failure_type: string | null;
          fee_cents: number;
          funding_mode: string;
          gift_message: string | null;
          hold_reason: string | null;
          id: string;
          idea_id: string;
          idempotency_key: string;
          is_gift: boolean;
          max_price_cents: number;
          merchant_order_id: string | null;
          packages: NonNullable<Json>;
          provider: string;
          provider_order_id: string | null;
          resolved: boolean;
          round_id: string;
          ship_city: string;
          ship_state: string;
          ship_to: string;
          shipping_cents: number | null;
          status: string;
          subtotal_cents: number | null;
          tax_cents: number | null;
          total_cents: number | null;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      zinc_claim_poll: {
        Args: { p_now: string; p_user_id: string };
        Returns: {
          created_at: string;
          device_code: string;
          expires_at: string;
          interval_sec: number;
          polling_until: string | null;
          user_code: string;
          user_id: string;
          verification_url: string;
        };
        SetofOptions: {
          from: "*";
          to: "zinc_connect_attempts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      zinc_drop_attempt: { Args: { p_user_id: string }; Returns: undefined };
      zinc_forget: { Args: { p_user_id: string }; Returns: string };
      zinc_release_poll: {
        Args: {
          p_device_code: string;
          p_interval_sec: number;
          p_user_id: string;
        };
        Returns: undefined;
      };
      zinc_secret_by_webhook: {
        Args: { p_webhook_id: string };
        Returns: {
          user_id: string;
          webhook_secret: string;
        }[];
      };
      zinc_secrets: {
        Args: { p_user_id: string };
        Returns: {
          api_key: string;
          webhook_id: string;
          webhook_secret: string;
          zinc_env: string;
        }[];
      };
      zinc_store_secrets: {
        Args: {
          p_api_key: string;
          p_user_id: string;
          p_webhook_id: string;
          p_webhook_secret: string;
          p_zinc_env: string;
        };
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
  lists: {
    Tables: {
      gift_claims: {
        Row: {
          claimed_at: string;
          claimer_id: string | null;
          claimer_name: string;
          for_order: boolean;
          item_id: string;
        };
        ComputedFields: never;
        Insert: {
          claimed_at?: string;
          claimer_id?: string | null;
          claimer_name: string;
          for_order?: boolean;
          item_id: string;
        };
        Update: {
          claimed_at?: string;
          claimer_id?: string | null;
          claimer_name?: string;
          for_order?: boolean;
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
      person_links: {
        Row: {
          buyer_id: string;
          created_at: string;
          list_id: string;
          person_id: string;
          share_token: string;
        };
        ComputedFields: never;
        Insert: {
          buyer_id: string;
          created_at?: string;
          list_id: string;
          person_id: string;
          share_token: string;
        };
        Update: {
          buyer_id?: string;
          created_at?: string;
          list_id?: string;
          person_id?: string;
          share_token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "person_links_list_id_fkey";
            columns: ["list_id"];
            isOneToOne: false;
            referencedRelation: "lists";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      active_link: {
        Args: { p_person_id: string };
        Returns: {
          list_id: string;
          owner_id: string;
        }[];
      };
      claim_for_order: {
        Args: { p_item_id: string; p_user_id: string };
        Returns: boolean;
      };
      claim_gift: {
        Args: { p_item_id: string; p_name: string; p_token: string };
        Returns: Json;
      };
      get_shared_list: { Args: { p_token: string }; Returns: Json };
      link_person: {
        Args: { p_person_id: string; p_token: string };
        Returns: undefined;
      };
      person_list: { Args: { p_person_id: string }; Returns: Json };
      release_for_order: {
        Args: { p_item_id: string; p_user_id: string };
        Returns: boolean;
      };
      save_list: {
        Args: { p_items: Json; p_list_id: string; p_title: string };
        Returns: string;
      };
      unclaim_gift: {
        Args: { p_item_id: string; p_token: string };
        Returns: boolean;
      };
      unlink_person: { Args: { p_person_id: string }; Returns: boolean };
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
  public: {
    Tables: {
      account_addresses: {
        Row: {
          address_checked_at: string | null;
          address_line1: string;
          address_line2: string | null;
          city: string;
          country: string;
          created_at: string;
          phone: string | null;
          recipient_first_name: string;
          recipient_last_name: string;
          share_for_gifts: boolean;
          state: string;
          updated_at: string;
          user_id: string;
          zip: string;
        };
        ComputedFields: never;
        Insert: {
          address_checked_at?: string | null;
          address_line1: string;
          address_line2?: string | null;
          city: string;
          country?: string;
          created_at?: string;
          phone?: string | null;
          recipient_first_name: string;
          recipient_last_name: string;
          share_for_gifts?: boolean;
          state: string;
          updated_at?: string;
          user_id?: string;
          zip: string;
        };
        Update: {
          address_checked_at?: string | null;
          address_line1?: string;
          address_line2?: string | null;
          city?: string;
          country?: string;
          created_at?: string;
          phone?: string | null;
          recipient_first_name?: string;
          recipient_last_name?: string;
          share_for_gifts?: boolean;
          state?: string;
          updated_at?: string;
          user_id?: string;
          zip?: string;
        };
        Relationships: [];
      };
      people: {
        Row: {
          address_checked_at: string | null;
          address_line1: string | null;
          address_line2: string | null;
          birth_year: number | null;
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
          photo_path: string | null;
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
          birth_year?: number | null;
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
          photo_path?: string | null;
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
          birth_year?: number | null;
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
          photo_path?: string | null;
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
      delete_person: { Args: { p_person_id: string }; Returns: undefined };
      shared_address_for_person: {
        Args: { p_person_id: string };
        Returns: Json;
      };
      shared_city_for_person: { Args: { p_person_id: string }; Returns: Json };
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
  lists: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
