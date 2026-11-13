-- Grava documento e cadastro na mesma transação, reutilizando a autorização e validação existentes.
CREATE FUNCTION public.save_company_registration_with_document(p_company_id uuid,p_registration jsonb,
  p_expected_registration jsonb,p_document text,p_expected_document text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE normalized text := nullif(regexp_replace(coalesce(p_document,''),'[. /-]','','g'),'');
  base_length integer; position integer; weight integer; total integer; remainder integer; digit integer;
BEGIN
  IF normalized IS NOT NULL AND normalized !~ '^([0-9]{11}|[0-9]{14})$' THEN
    RAISE EXCEPTION 'Informe CPF com 11 dígitos ou CNPJ numérico com 14 dígitos.';
  END IF;
  IF length(normalized)=14 THEN
    IF normalized ~ '^([0-9])\1{13}$' THEN RAISE EXCEPTION 'CNPJ inválido.'; END IF;
    FOR base_length IN 12..13 LOOP
      weight := base_length-7; total := 0;
      FOR position IN 1..base_length LOOP
        total := total + substring(normalized,position,1)::integer * weight;
        weight := weight-1; IF weight<2 THEN weight := 9; END IF;
      END LOOP;
      remainder := total % 11; digit := CASE WHEN remainder<2 THEN 0 ELSE 11-remainder END;
      IF digit<>substring(normalized,base_length+1,1)::integer THEN RAISE EXCEPTION 'CNPJ inválido.'; END IF;
    END LOOP;
  END IF;
  PERFORM public.save_company_registration(p_company_id,p_registration,p_expected_registration);
  UPDATE public.partner_profiles SET document=normalized
  WHERE id=p_company_id AND document IS NOT DISTINCT FROM p_expected_document;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento alterado em outra tela. Recarregue o cadastro.' USING ERRCODE='40001'; END IF;
  RETURN public.get_company_registration(p_company_id);
END $$;
REVOKE ALL ON FUNCTION public.save_company_registration_with_document(uuid,jsonb,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_company_registration_with_document(uuid,jsonb,jsonb,text,text) TO authenticated;
