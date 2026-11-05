-- Tailzu — a bot's answer can be reported, as a message, a shared thing or a person can (src/botsBots/safety.ts).
--
-- App Review 1.2 counts AI content creation apps with the apps where people post, and 4.7.1 asks the same of chatbots: a way to
-- report what was made. "Report" under a bot's answer files a report of kind 'answer': its ref is the bot, its snapshot the answer
-- as the person saw it and what they asked. Acted on within 24 hours like every report, in the console's Reports tab.
--
-- Run in your Supabase SQL editor. It needs 0057 (content_reports) and can be run again. Without it a report of an answer is
-- refused by the database (the app says it couldn't send the report); every other report works as before.

alter table public.content_reports drop constraint if exists content_reports_kind_check;
alter table public.content_reports add constraint content_reports_kind_check
  check (kind in ('message', 'item', 'person', 'answer'));
