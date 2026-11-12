-- O ramo é definido pelo superadministrador, sem voltar ao formulário de cadastro.
CREATE OR REPLACE FUNCTION public.set_super_admin_company_segment(company_id uuid, new_segment text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  saved_segment text;
BEGIN
  IF auth.uid() IS NULL OR public.is_super_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'Apenas o superadministrador pode alterar o ramo.' USING ERRCODE = '42501';
  END IF;
  IF new_segment IS NULL OR new_segment NOT IN ('assistencia', 'varejo', 'servicos') THEN
    RAISE EXCEPTION 'Selecione um ramo válido.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.partner_profiles SET segment = new_segment
  WHERE id = company_id RETURNING segment INTO saved_segment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Mantém o cadastro comercial coerente com o perfil usado pelo painel e pelo ERP.
  UPDATE public.admin_lojistas SET segment = saved_segment WHERE user_id = company_id;
  RETURN saved_segment;
END;
$$;

REVOKE ALL ON FUNCTION public.set_super_admin_company_segment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_super_admin_company_segment(uuid, text) TO authenticated;
