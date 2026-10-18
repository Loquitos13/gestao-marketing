-- O fingerprint passou de "<type>:<fp>" para "<ruleId>:<fp>" (engine.ts). Reescreve os alertas existentes
-- para que a primeira avaliação não os resolva e reabra todos. Salta linhas sem regra, já migradas,
-- ou cujo novo valor colidiria com o índice único ("clientId", "fingerprint").
UPDATE "Alert" a
SET "fingerprint" = a."ruleId" || substring(a."fingerprint" from length(a."type") + 1)
WHERE a."ruleId" IS NOT NULL
  AND a."fingerprint" LIKE a."type" || ':%'
  AND a."fingerprint" NOT LIKE a."ruleId" || ':%'
  AND NOT EXISTS (
    SELECT 1 FROM "Alert" b
    WHERE b."clientId" = a."clientId"
      AND b."fingerprint" = a."ruleId" || substring(a."fingerprint" from length(a."type") + 1)
  );
