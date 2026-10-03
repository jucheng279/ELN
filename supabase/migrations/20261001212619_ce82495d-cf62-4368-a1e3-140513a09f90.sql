-- Cycle 22: tenant-boundary integrity for experiment-linked edges.

CREATE OR REPLACE FUNCTION public._enforce_experiment_edge_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_ws uuid; v_other uuid;
BEGIN
  IF TG_TABLE_NAME = 'experiment_tags' THEN
    SELECT workspace_id INTO v_ws FROM public.experiments WHERE id = NEW.experiment_id;
    SELECT workspace_id INTO v_other FROM public.tags WHERE id = NEW.tag_id;
    IF v_ws IS NULL OR v_other IS NULL OR v_ws <> v_other THEN
      RAISE EXCEPTION 'Tag belongs to a different workspace than the experiment'
        USING ERRCODE = '23514', HINT = 'tenant_boundary:experiment_tags';
    END IF;
  ELSIF TG_TABLE_NAME = 'experiment_contributors' THEN
    -- Admission invariant only: checked when the link is created or re-pointed.
    IF TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.experiment_id IS DISTINCT FROM OLD.experiment_id THEN
      SELECT workspace_id INTO v_ws FROM public.experiments WHERE id = NEW.experiment_id;
      IF v_ws IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspace_members m
                                     WHERE m.workspace_id = v_ws AND m.user_id = NEW.user_id) THEN
        RAISE EXCEPTION 'Contributor must be a current member of the experiment workspace'
          USING ERRCODE = '23514', HINT = 'tenant_boundary:experiment_contributors';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'experiment_relations' THEN
    IF NEW.source_experiment_id = NEW.target_experiment_id THEN
      RAISE EXCEPTION 'An experiment cannot be related to itself'
        USING ERRCODE = '23514', HINT = 'tenant_boundary:experiment_relations';
    END IF;
    SELECT workspace_id INTO v_ws FROM public.experiments WHERE id = NEW.source_experiment_id;
    SELECT workspace_id INTO v_other FROM public.experiments WHERE id = NEW.target_experiment_id;
    IF v_ws IS NULL OR v_other IS NULL OR v_ws <> v_other THEN
      RAISE EXCEPTION 'Related experiments must belong to the same workspace'
        USING ERRCODE = '23514', HINT = 'tenant_boundary:experiment_relations';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._enforce_experiment_edge_tenant() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_experiment_tags_tenant BEFORE INSERT OR UPDATE ON public.experiment_tags
  FOR EACH ROW EXECUTE FUNCTION public._enforce_experiment_edge_tenant();
CREATE TRIGGER trg_experiment_contributors_tenant BEFORE INSERT OR UPDATE ON public.experiment_contributors
  FOR EACH ROW EXECUTE FUNCTION public._enforce_experiment_edge_tenant();
CREATE TRIGGER trg_experiment_relations_tenant BEFORE INSERT OR UPDATE ON public.experiment_relations
  FOR EACH ROW EXECUTE FUNCTION public._enforce_experiment_edge_tenant();

-- RLS defense in depth (DELETE policies intentionally unchanged).
DROP POLICY IF EXISTS insert_et ON public.experiment_tags;
CREATE POLICY insert_et ON public.experiment_tags FOR INSERT TO authenticated
  WITH CHECK (public.can_mutate_experiment_content(experiment_id) AND EXISTS (
    SELECT 1 FROM public.experiments e JOIN public.tags t ON t.workspace_id = e.workspace_id
    WHERE e.id = experiment_tags.experiment_id AND t.id = experiment_tags.tag_id));

DROP POLICY IF EXISTS insert_ec ON public.experiment_contributors;
CREATE POLICY insert_ec ON public.experiment_contributors FOR INSERT TO authenticated
  WITH CHECK (public.can_mutate_experiment_content(experiment_id) AND EXISTS (
    SELECT 1 FROM public.experiments e JOIN public.workspace_members m ON m.workspace_id = e.workspace_id
    WHERE e.id = experiment_contributors.experiment_id AND m.user_id = experiment_contributors.user_id));
-- UPDATE keeps experiment-level authorization; the trigger checks membership only when user_id changes,
-- so role edits on historical contributors remain possible.

DROP POLICY IF EXISTS insert_erl ON public.experiment_relations;
CREATE POLICY insert_erl ON public.experiment_relations FOR INSERT TO authenticated
  WITH CHECK (public.can_mutate_experiment_content(source_experiment_id)
    AND source_experiment_id <> target_experiment_id AND EXISTS (
    SELECT 1 FROM public.experiments s JOIN public.experiments t ON t.workspace_id = s.workspace_id
    WHERE s.id = experiment_relations.source_experiment_id AND t.id = experiment_relations.target_experiment_id));
DROP POLICY IF EXISTS update_erl ON public.experiment_relations;
CREATE POLICY update_erl ON public.experiment_relations FOR UPDATE TO authenticated
  USING (public.can_mutate_experiment_content(source_experiment_id))
  WITH CHECK (public.can_mutate_experiment_content(source_experiment_id)
    AND source_experiment_id <> target_experiment_id AND EXISTS (
    SELECT 1 FROM public.experiments s JOIN public.experiments t ON t.workspace_id = s.workspace_id
    WHERE s.id = experiment_relations.source_experiment_id AND t.id = experiment_relations.target_experiment_id));

-- Fail-closed: no new revision may hash tenant-crossing tag/relation edges.
CREATE OR REPLACE FUNCTION public._assert_experiment_edges_tenant_valid(p_experiment_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.experiment_tags et
             JOIN public.experiments e ON e.id = et.experiment_id
             JOIN public.tags t ON t.id = et.tag_id
             WHERE et.experiment_id = p_experiment_id AND t.workspace_id <> e.workspace_id)
  OR EXISTS (SELECT 1 FROM public.experiment_relations r
             JOIN public.experiments s ON s.id = r.source_experiment_id
             JOIN public.experiments t ON t.id = r.target_experiment_id
             WHERE r.source_experiment_id = p_experiment_id
               AND (t.workspace_id <> s.workspace_id OR r.source_experiment_id = r.target_experiment_id)) THEN
    RAISE EXCEPTION 'Experiment has cross-workspace tag or relation links; remove them before creating a revision'
      USING ERRCODE = '23514', HINT = 'tenant_boundary:snapshot';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._assert_experiment_edges_tenant_valid(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._create_revision_internal(p_experiment_id uuid, p_change_summary text, p_change_type text, p_created_by uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_rev_number int; v_rev_id uuid; v_snapshot jsonb; v_hash text;
BEGIN
  PERFORM 1 FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  PERFORM public._assert_experiment_edges_tenant_valid(p_experiment_id);

  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_rev_number
  FROM public.experiment_revisions WHERE experiment_id = p_experiment_id;

  v_snapshot := public._build_experiment_snapshot(p_experiment_id);
  v_hash := encode(sha256(convert_to(v_snapshot::text, 'UTF8')), 'hex');

  INSERT INTO public.experiment_revisions (
    experiment_id, revision_number, snapshot, content_hash,
    change_summary, change_type, created_by, metadata
  ) VALUES (
    p_experiment_id, v_rev_number, v_snapshot, v_hash,
    p_change_summary, p_change_type, p_created_by, p_metadata
  ) RETURNING id INTO v_rev_id;

  UPDATE public.experiments SET current_revision = v_rev_number, updated_at = now()
  WHERE id = p_experiment_id;

  RETURN jsonb_build_object('revision_id', v_rev_id, 'revision_number', v_rev_number, 'content_hash', v_hash);
END; $function$;
REVOKE ALL ON FUNCTION public._create_revision_internal(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
