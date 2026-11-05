-- Conversational agents can update the board directly (every change is logged and undoable).
-- The research agent only reads.
update public.agents set scopes = '{capture:write,board:read,board:write}' where slug in ('grok-piyush', 'instinct', 'notion-ai');
alter table public.agents alter column scopes set default '{capture:write,board:read,board:write}';
