-- How competitor names were read from the answer: a second structured-output request ("model") or the text heuristic.
alter table public.visibility_results add column extraction text
  check (extraction is null or extraction in ('model', 'heuristic'));
