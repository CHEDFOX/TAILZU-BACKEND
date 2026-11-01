-- The project book (src/code/project/book.ts): the part of it that is not read from the code, GitHub or the checks, the owner's own answers
-- (who the project is for, what comes next, what must not change). Kept with the project's brain, and gone with it.
alter table public.code_brain add column if not exists book jsonb;
