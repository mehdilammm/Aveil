-- "failed": the structured extraction did not work, so no competitor names are stored (no text guessing).
alter table public.visibility_results drop constraint visibility_results_extraction_check;
alter table public.visibility_results add constraint visibility_results_extraction_check
  check (extraction is null or extraction in ('model', 'heuristic', 'failed'));
