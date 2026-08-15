# API e endpoints — Entitlements / Session Credits

A API HTTP deste módulo deve ser tratada como contrato versionado. Rotas públicas e internas devem ser separadas, com middleware de autenticação, tenant, validação de entrada, idempotência e tratamento de erros.

## Padrão de endpoint

| Camada | Responsabilidade |
| --- | --- |
| Route | Método, caminho, middleware e status HTTP |
| Controller | Validação de entrada e composição da resposta |
| Service | Regra de negócio e transação |
| Repository/Model | Persistência local e índices únicos |
| Integration client | Headers, timeout, retry e correlação |

## Endpoints internos

Endpoints internos devem utilizar "Authorization" de serviço, audience do destino, scopes mínimos, "X-Service-Id", "X-Correlation-Id", tenant/organization, origem e idempotência conforme o comando. Não devem ser publicados diretamente na Internet.

## Evolução

Toda alteração incompatível exige versão nova ou compatibilidade explícita. O README e este documento devem apontar para OpenAPI/AsyncAPI quando esses artefatos forem adicionados.

## Referências

[1]: https://github.com/operaon/entitlements "Repositório Entitlements / Session Credits"
[2]: https://github.com/operaon/api "API Gateway Operaon"
[3]: https://github.com/operaon/identity "Identity Operaon"

## Capacidades comerciais por tenant

| Método | Caminho | Permissão | Objetivo |
| --- | --- | --- | --- |
| `POST` | `/api/internal/feature-grants` | `entitlements:admin` | Conceder uma feature booleana ou quota a um tenant. |
| `PATCH` | `/api/internal/feature-grants/:id/status` | `entitlements:admin` | Suspender, expirar, reativar ou revogar um grant. |
| `GET` | `/api/features/check?featureKey=...` | `entitlements:read` | Consultar se uma capability está ativa e o saldo agregado da quota. |
| `POST` | `/api/internal/quotas/consume` | `entitlements:write` | Consumir quota com `Idempotency-Key` obrigatório. |
| `POST` | `/api/internal/quotas/release` | `entitlements:write` | Reverter consumo de quota com idempotência. |

O endpoint de concessão exige `featureKey`, `sourceSystem` e `sourceId`. Grants `BOOLEAN` habilitam uma capability; grants `QUOTA` exigem `limitValue` positivo e `unit`. A vigência é controlada por `startsAt`, `expiresAt` e `status`.

O endpoint de consulta é somente leitura e não concede acesso por si só. Cada módulo owner deve repetir a autorização no ponto de execução da operação, utilizando a resposta do Entitlements e mantendo o tenant do JWT como escopo obrigatório.

Consumo e liberação são operações transacionais. O mesmo `Idempotency-Key` dentro do tenant retorna o resultado anterior e não cria um segundo movimento. A origem comercial deve ser registrada no grant, enquanto eventos e correlação devem acompanhar os movimentos quando fornecidos.
