-- Names in AI Visibility answers can now be read by internal helper models (Groq, NVIDIA) before Gemini.
alter table public.visibility_results drop constraint visibility_results_extractor_check;
alter table public.visibility_results add constraint visibility_results_extractor_check
  check (extractor is null or extractor in ('gemini', 'mistral', 'groq', 'nvidia'));
