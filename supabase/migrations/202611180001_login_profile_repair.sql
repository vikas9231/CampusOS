-- Recover valid authenticated accounts whose profile trigger was unavailable
-- during signup. This function can only repair the caller's own profile.
create or replace function public.ensure_current_profile()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  insert into public.profiles (id, full_name, email)
  select
    auth_user.id,
    coalesce(auth_user.raw_user_meta_data ->> 'full_name', ''),
    coalesce(auth_user.email, '')
  from auth.users auth_user
  where auth_user.id = auth.uid()
  on conflict (id) do update
    set email = excluded.email
    where public.profiles.email is distinct from excluded.email;
end;
$$;

revoke all on function public.ensure_current_profile() from public, anon;
grant execute on function public.ensure_current_profile() to authenticated;
