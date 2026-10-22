-- v0.9 Brand profile: per answer, how it describes the store and each named competitor (sentiment, description,
-- features), read by an internal helper model and checked against the answer.
alter table public.visibility_results add column profile jsonb;
alter table public.visibility_results add column profiler text check (profiler is null or profiler in ('groq', 'nvidia', 'gemini'));
