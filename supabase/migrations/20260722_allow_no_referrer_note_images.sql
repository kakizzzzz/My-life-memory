begin;

-- Browser and Edge sanitizers add this exact policy to every note image. Keep
-- the database validator aligned without accepting any other referrer policy.
create or replace function public.memory_html_is_safe(p_html text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_tag text[];
  v_opening text[];
  v_attribute text[];
  v_rule text;
  v_property text;
  v_value text;
  v_tag_name text;
  v_attributes text;
  v_attribute_name text;
  v_unparsed_attributes text;
begin
  if p_html is null then return true; end if;
  if length(p_html) > 240000 then return false; end if;
  if p_html ~* '<\s*(script|style|iframe|object|embed|link|meta|svg|math)(\s|>|/)' then return false; end if;
  if p_html ~* '\son[a-z0-9_-]+\s*=' then return false; end if;
  if p_html ~* '(javascript\s*:|data\s*:\s*text/html)' then return false; end if;
  for v_tag in select regexp_matches(p_html, '<\s*/?\s*([a-zA-Z0-9]+)', 'g') loop
    if lower(v_tag[1]) <> all(array['p', 'br', 'span', 'u', 'figure', 'img']) then
      return false;
    end if;
  end loop;
  for v_opening in select regexp_matches(p_html, '<\s*([a-zA-Z0-9]+)([^>]*)>', 'g') loop
    v_tag_name := lower(v_opening[1]);
    v_attributes := coalesce(v_opening[2], '');
    for v_attribute in select regexp_matches(v_attributes, '([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|''([^'']*)'')', 'g') loop
      v_attribute_name := lower(v_attribute[1]);
      v_value := coalesce(v_attribute[2], v_attribute[3], '');
      if v_attribute_name ~ '^on' then return false; end if;
      if v_tag_name in ('p', 'span', 'u') then
        if v_attribute_name <> 'style' then return false; end if;
      elsif v_tag_name = 'figure' then
        if v_attribute_name not in ('class', 'contenteditable', 'data-note-image') then return false; end if;
        if v_attribute_name = 'class' and v_value <> 'note-inline-image' then return false; end if;
        if v_attribute_name = 'contenteditable' and lower(v_value) <> 'false' then return false; end if;
        if v_attribute_name = 'data-note-image' and lower(v_value) <> 'true' then return false; end if;
      elsif v_tag_name = 'img' then
        if v_attribute_name = 'referrerpolicy' then
          if lower(btrim(v_value)) <> 'no-referrer' then return false; end if;
        elsif v_attribute_name not in ('src', 'alt') and v_attribute_name !~ '^data-media-[a-z0-9-]+$' then
          return false;
        end if;
        if length(v_value) > 2048 and v_attribute_name <> 'src' then return false; end if;
        if v_attribute_name = 'src' and (
          lower(ltrim(v_value)) ~ '^(javascript:|data:text/html)'
          or lower(ltrim(v_value)) !~ '^(https?://|blob:|storage://|data:image/(jpeg|jpg|png|webp|gif);|/|\./)'
        ) then return false; end if;
      elsif v_tag_name = 'br' and length(trim(v_attributes, ' /')) > 0 then
        return false;
      end if;
    end loop;
    v_unparsed_attributes := regexp_replace(
      v_attributes,
      '([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"[^"]*"|''[^'']*'')',
      '',
      'g'
    );
    if length(btrim(v_unparsed_attributes, ' /' || chr(9) || chr(10) || chr(13))) > 0 then return false; end if;
    if v_attributes ~* '\bstyle\s*=' then
      for v_attribute in select regexp_matches(v_attributes, 'style\s*=\s*(?:"([^"]*)"|''([^'']*)'')', 'gi') loop
        foreach v_rule in array regexp_split_to_array(coalesce(v_attribute[1], v_attribute[2], ''), ';') loop
          if length(trim(v_rule)) = 0 then continue; end if;
          v_property := lower(trim(split_part(v_rule, ':', 1)));
          v_value := trim(substr(v_rule, strpos(v_rule, ':') + 1));
          if v_property not in ('color', 'font-size', 'text-decoration-line') then return false; end if;
          if v_value ~* '(url|expression|javascript)' then return false; end if;
          if v_property = 'font-size' and v_value !~ '^([8-9]|[1-6][0-9]|7[0-2])(\.[0-9]{1,2})?px$' then return false; end if;
          if v_property = 'text-decoration-line' and lower(v_value) not in ('underline', 'none') then return false; end if;
        end loop;
      end loop;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.memory_html_is_safe(text) from public, anon, authenticated;

commit;
