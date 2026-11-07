\pset tuples_only on
-- board_snapshot: members see the board, others see empty lists.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ declare j jsonb := public.board_snapshot(); begin
  assert jsonb_array_length(j -> 'listings') > 0, 'member sees listings';
  assert jsonb_array_length(j -> 'sources') > 0, 'member sees sources';
  assert not ((j -> 'listings' -> 0) ? 'private_notes'), 'no private notes in snapshot';
end $$;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin assert jsonb_array_length(public.board_snapshot() -> 'listings') = 0, 'non-member sees nothing'; end $$;
reset role;
\echo 'snapshot tests passed'
