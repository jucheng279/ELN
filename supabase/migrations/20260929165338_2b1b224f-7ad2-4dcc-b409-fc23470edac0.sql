-- Remove obsolete 4-arg replace_attachment overload: already non-client-callable,
-- unused by app code, and it makes 4-argument calls ambiguous with the canonical
-- 7-arg function (which has defaults for the trailing metadata parameters).
DROP FUNCTION IF EXISTS public.replace_attachment(uuid, text, bigint, text);
