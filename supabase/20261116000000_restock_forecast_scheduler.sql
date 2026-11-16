-- =============================================================================
-- Migration: 20261116000000_restock_forecast_scheduler.sql
-- Description: Advisory-only Salon Restock Forecasting tables, RPCs, and scheduler.
--
-- MANDATORY ARCHITECTURAL SAFEGUARD:
-- Salon Restock Alerts are advisory recommendations ONLY.
-- A forecast must NEVER create an official sales order, invoice, receivable,
-- or financial obligation automatically. Only an authorized Manager or Owner
-- may convert a recommendation into an official order via app.office_create_order
-- after explicit customer confirmation.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.salon_restock_recommendation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salon(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES public.sku(id) ON DELETE CASCADE,
  urgency text NOT NULL CHECK (urgency IN ('urgent', 'soon', 'adequate')),
  runout_days integer NOT NULL CHECK (runout_days >= 0),
  suggested_qty integer NOT NULL CHECK (suggested_qty > 0),
  reason text NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'insufficient_data')),
  has_historical_deliveries boolean NOT NULL DEFAULT false,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_salon_sku_recommendation UNIQUE (salon_id, sku_id)
);

CREATE TABLE IF NOT EXISTS public.forecast_scheduler_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  recommendations_computed integer NOT NULL DEFAULT 0,
  salons_evaluated integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  triggered_by text NOT NULL DEFAULT 'scheduler',
  error text
);

-- Enable RLS
ALTER TABLE public.salon_restock_recommendation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_scheduler_run ENABLE ROW LEVEL SECURITY;

-- Policies for salon_restock_recommendation
DROP POLICY IF EXISTS "Staff can read restock recommendations" ON public.salon_restock_recommendation;
CREATE POLICY "Staff can read restock recommendations"
  ON public.salon_restock_recommendation
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profile
      WHERE user_profile.id = auth.uid()
        AND user_profile.role IN ('rep', 'manager', 'owner')
    )
  );

DROP POLICY IF EXISTS "Office can manage restock recommendations" ON public.salon_restock_recommendation;
CREATE POLICY "Office can manage restock recommendations"
  ON public.salon_restock_recommendation
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profile
      WHERE user_profile.id = auth.uid()
        AND user_profile.role IN ('manager', 'owner')
    )
  );

-- Policies for forecast_scheduler_run
DROP POLICY IF EXISTS "Office can view forecast scheduler runs" ON public.forecast_scheduler_run;
CREATE POLICY "Office can view forecast scheduler runs"
  ON public.forecast_scheduler_run
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profile
      WHERE user_profile.id = auth.uid()
        AND user_profile.role IN ('manager', 'owner')
    )
  );

-- RPC: Refresh Restock Forecasts (strictly advisory — computes from delivered orders only)
CREATE OR REPLACE FUNCTION app.refresh_restock_forecasts(
  p_triggered_by text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_duration integer;
  v_salons_count integer := 0;
  v_recs_count integer := 0;
  v_salon RECORD;
  v_sku RECORD;
  v_delivery_count integer;
  v_total_qty integer;
  v_days_span integer;
  v_daily_burn numeric;
  v_runout integer;
  v_urgency text;
  v_suggested integer;
BEGIN
  -- Count total salons evaluated
  SELECT count(*) INTO v_salons_count FROM public.salon WHERE active = true;

  -- Clear previous recommendations to ensure no stale advisory records persist
  DELETE FROM public.salon_restock_recommendation;

  -- Loop through active salons and active SKUs
  FOR v_salon IN SELECT id, name FROM public.salon WHERE active = true LOOP
    FOR v_sku IN SELECT id, code FROM public.sku WHERE active = true LOOP
      -- Check ONLY real delivered orders
      SELECT
        count(*),
        coalesce(sum(sol.qty), 0),
        coalesce(extract(day from (max(d.delivered_at) - min(d.delivered_at)))::integer, 0)
      INTO
        v_delivery_count,
        v_total_qty,
        v_days_span
      FROM public.sales_order so
      JOIN public.delivery d ON d.order_id = so.id
      JOIN public.sales_order_line sol ON sol.order_id = so.id
      WHERE so.salon_id = v_salon.id
        AND sol.sku_id = v_sku.id
        AND d.status = 'delivered'
        AND d.delivered_at IS NOT NULL;

      -- Strictly require real historical deliveries (never invent data)
      IF v_delivery_count >= 1 THEN
        IF v_days_span > 0 THEN
          v_daily_burn := v_total_qty::numeric / v_days_span::numeric;
        ELSE
          v_daily_burn := v_total_qty::numeric / 30.0;
        END IF;

        IF v_daily_burn > 0 THEN
          v_runout := round(v_total_qty::numeric / v_daily_burn)::integer;
        ELSE
          v_runout := 45;
        END IF;

        IF v_runout <= 7 THEN
          v_urgency := 'urgent';
          v_suggested := greatest(2, round(v_daily_burn * 21)::integer);
        ELSIF v_runout <= 21 THEN
          v_urgency := 'soon';
          v_suggested := greatest(2, round(v_daily_burn * 14)::integer);
        ELSE
          v_urgency := 'adequate';
          v_suggested := greatest(1, round(v_daily_burn * 7)::integer);
        END IF;

        INSERT INTO public.salon_restock_recommendation (
          salon_id,
          sku_id,
          urgency,
          runout_days,
          suggested_qty,
          reason,
          confidence,
          has_historical_deliveries,
          computed_at
        ) VALUES (
          v_salon.id,
          v_sku.id,
          v_urgency,
          v_runout,
          v_suggested,
          format('Advisory based on %s delivered units across %s orders.', v_total_qty, v_delivery_count),
          CASE WHEN v_delivery_count >= 3 THEN 'high' ELSE 'medium' END,
          true,
          now()
        )
        ON CONFLICT (salon_id, sku_id) DO UPDATE SET
          urgency = EXCLUDED.urgency,
          runout_days = EXCLUDED.runout_days,
          suggested_qty = EXCLUDED.suggested_qty,
          reason = EXCLUDED.reason,
          confidence = EXCLUDED.confidence,
          has_historical_deliveries = true,
          computed_at = now();

        v_recs_count := v_recs_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  v_duration := (extract(epoch from (clock_timestamp() - v_start)) * 1000)::integer;

  INSERT INTO public.forecast_scheduler_run (
    ran_at,
    recommendations_computed,
    salons_evaluated,
    duration_ms,
    triggered_by
  ) VALUES (
    now(),
    v_recs_count,
    v_salons_count,
    v_duration,
    p_triggered_by
  );

  RETURN jsonb_build_object(
    'ok', true,
    'salons_evaluated', v_salons_count,
    'recommendations_computed', v_recs_count,
    'duration_ms', v_duration
  );
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION app.refresh_restock_forecasts(text) TO authenticated;

-- Optional pg_cron scheduling block if pg_cron extension is present
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.schedule(
        'refresh-salon-restock-forecasts-nightly',
        '0 2 * * *',
        $$SELECT app.refresh_restock_forecasts('pg_cron');$$
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron schedule setup skipped: %', SQLERRM;
    END;
  END IF;
END;
$cron$;
