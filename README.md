# Operaon Entitlements & Session Credits

Standalone responsável pela **titularidade de sessões**, emissão de créditos, reserva para agendamentos, liberação, consumo, reembolso, anulação administrativa, extrato auditável e políticas de cancelamento. O serviço possui banco próprio e não mantém foreign keys físicas para o banco do gateway, Agenda, Catálogo, Pacientes ou qualquer outro módulo.

> **Fronteira do domínio:** o serviço administra o saldo e o ledger dos direitos de sessão. Ele não autentica usuários, não agenda consultas, não processa pagamentos e não cadastra pacientes. Esses domínios integram-se por identificadores estáveis e contratos HTTP autenticados.

## Execução

O serviço usa Node.js 18 ou superior, Express, Sequelize 6 e PostgreSQL 16. A porta local padronizada é `4770`, e os bancos próprios são `operaon_entitlements` e `operaon_entitlements_test`.

| Comando | Finalidade |
| --- | --- |
| `npm install` | Instala dependências |
| `npm start` | Inicia o serviço |
| `npm run dev` | Inicia com recarregamento por Nodemon |
| `npm run migrate` | Aplica migrations pendentes |
| `npm test` | Executa a suíte Jest/Supertest |
| `npm run lint:syntax` | Verifica a sintaxe de `src`, `scripts` e `tests` |
| `npm run backfill:legacy` | Executa o backfill legado em dry-run por padrão |

A aplicação expõe `GET /health` para liveness e `GET /ready` para readiness com autenticação no banco. O prefixo das rotas de negócio é `/api`.

## Configuração

Copie `.env.example` para o ambiente de execução e substitua as credenciais de desenvolvimento. O `.env` versionado contém somente valores locais padronizados; nenhuma chave de produção deve ser commitada.

| Variável | Desenvolvimento | Observação |
| --- | --- | --- |
| `PORT` | `4770` | Porta HTTP do standalone |
| `DB_NAME` | `operaon_entitlements` | Banco próprio do serviço |
| `DB_USER` / `DB_PASSWORD` | `dbadmin` / valor local | Credenciais locais do PostgreSQL |
| `SERVICE_API_KEY` | placeholder local | Deve ser substituída no ambiente de execução |
| `JWT_ALGORITHM` | `HS256` | Em produção, pode usar chave pública conforme o Identity |
| `JWT_ISSUER` | `operaon-identity` | Issuer aceito pelo Identity |
| `JWT_AUDIENCE` | `operaon-api,operaon-identity,operaon-entitlements` | Audiências aceitas |
| `BACKFILL_WRITE_ENABLED` | `false` | Mantém o backfill em dry-run por padrão |

## Segurança e escopo

Todas as rotas de negócio exigem autenticação **dual**: o header `X-Service-Key` precisa corresponder à chave de serviço configurada, e `Authorization` precisa conter um bearer token JWT de acesso emitido pelo Identity. O JWT é validado por algoritmo, issuer, audience, expiração e `tokenType=access`.

O contexto autorizado é derivado dos claims do JWT. O claim `tenantId` define o tenant principal; `organizationIds` restringe o acesso às organizações permitidas; `sub` identifica o usuário que será registrado nos movimentos administrativos. Se `X-Tenant-Id` for informado, ele precisa ser igual ao tenant do JWT. Tokens de serviço podem operar com o escopo explicitamente fornecido pelo chamador interno, sem regras baseadas em nomes fixos de roles.

| Permissão dinâmica | Operações |
| --- | --- |
| `entitlements:read` | Consulta de entitlement, movimentos, extrato e política |
| `entitlements:write` | Emissão, reserva, liberação e consumo |
| `entitlements:admin` | Reembolso, anulação e alteração de política |

A autorização aceita apenas permissões presentes nos claims — ou `*:*` — e o bypass de escopo ocorre somente para tokens de serviço reconhecidos pelo próprio JWT. Nenhuma regra depende do nome de uma role.

## Modelo de saldo e ledger

Cada entitlement representa uma concessão independente de créditos para um paciente dentro de um tenant e, opcionalmente, organização. A unidade suportada nesta versão é `SESSION`: cada crédito corresponde a uma sessão/appointment, e não a minutos ou horas. O saldo é materializado para consultas rápidas e cada alteração é acompanhada por uma linha imutável em `entitlement_movements`.

> **Invariante:** `totalCredits = availableCredits + reservedCredits + consumedCredits + voidedCredits`.

A reserva move uma unidade de disponível para reservado; a liberação faz o movimento inverso; o consumo move uma unidade reservada para consumida; o reembolso move uma unidade consumida para disponível; e o void move o saldo disponível ou reservado para anulado, sem classificá-lo como consumo. Toda operação mutável é transacional e falha inteira quando a regra de saldo ou escopo não é satisfeita.

| Entidade | Finalidade |
| --- | --- |
| `entitlements` | Concessão, unidade `SESSION`, saldo materializado, estado e origem idempotente |
| `entitlement_movements` | Ledger auditável e imutável de deltas |
| `tenant_entitlement_policies` | Política efetiva de cancelamento por tenant e organização |

Os estados suportados são `ACTIVE`, `EXHAUSTED` e `CANCELLED`. Os tipos de movimento incluem `ISSUE`, `RESERVE`, `RELEASE`, `COMPLETE_CONSUME`, `LATE_CANCEL_CONSUME`, `NO_SHOW_CONSUME`, `ADMIN_REFUND`, `VOID` e `MIGRATED_OPENING_BALANCE`.

## Contrato HTTP

Os endpoints de mutação usam JSON e exigem `Idempotency-Key`, exceto a emissão, cuja chave de negócio é formada por `sourceSystem` e `sourceId`. Repetições da mesma operação devolvem o estado já persistido com `idempotent: true`, sem duplicar saldo ou movimento.

| Método e caminho | Permissão | Finalidade |
| --- | --- | --- |
| `POST /api/internal/entitlements/issue` | `entitlements:write` | Emite uma concessão idempotente |
| `POST /api/internal/entitlements/:id/reserve` | `entitlements:write` | Reserva uma unidade para um agendamento |
| `POST /api/internal/entitlements/:id/release` | `entitlements:write` | Libera uma reserva |
| `POST /api/internal/entitlements/:id/consume` | `entitlements:write` | Consome uma reserva por conclusão, cancelamento tardio ou no-show |
| `POST /api/internal/entitlements/:id/refund` | `entitlements:admin` | Reembolsa uma unidade consumida |
| `POST /api/internal/entitlements/:id/void` | `entitlements:admin` | Anula o saldo ainda não consumido |
| `GET /api/entitlements/:id` | `entitlements:read` | Consulta o entitlement dentro do escopo |
| `GET /api/entitlements/:id/movements` | `entitlements:read` | Consulta o ledger paginado |
| `GET /api/entitlements/patients/:patientId/statement` | `entitlements:read` | Lista concessões e saldos do paciente |
| `GET /api/entitlements/policy` | `entitlements:read` | Consulta a política efetiva |
| `PUT /api/entitlements/policy` | `entitlements:admin` | Cria ou atualiza a política do escopo |

O payload de emissão contém `tenantId`, `organizationId` opcional, `patientId`, `productId` opcional, `sourceSystem`, `sourceId`, `totalCredits`, `creditUnit` opcional com default `SESSION`, `expiresAt` opcional e `metadata`. Unidades `HOUR` e `MINUTE` são rejeitadas até que exista implementação explícita de fracionamento, arredondamento, reserva e consumo. As mutações podem receber `appointmentId` e `reason`. O consumo exige `type` com um dos valores `COMPLETE_CONSUME`, `LATE_CANCEL_CONSUME` ou `NO_SHOW_CONSUME`.

As respostas de mutação retornam `success`, o entitlement serializado, o movimento criado quando aplicável e o indicador `idempotent`. Erros de autenticação, autorização, escopo, saldo, conflito de idempotência e validação são retornados pelo handler operacional com código estável e `requestId`.

## Políticas de cancelamento

A política possui chave de escopo `${tenantId}:${organizationId || '*'}` e somente uma política efetiva por tenant ou organização. Os defaults compatíveis com o legado são janela de cancelamento de 24 horas, consumo em cancelamento tardio habilitado e consumo em no-show habilitado.

| Campo | Default | Significado |
| --- | ---: | --- |
| `cancellationWindowHours` | `24` | Limite para cancelamento sem perda de crédito |
| `lateCancellationConsumesCredit` | `true` | Define consumo em cancelamento tardio |
| `noShowConsumesCredit` | `true` | Define consumo em ausência |
| `isActive` | `true` | Habilita a política no escopo |

## Backfill e migração gradual

`scripts/backfill-legacy.js` lê somente as tabelas legadas `session_credits`, `session_credit_movements` e `tenant_cancellation_policies`. O script é **somente-aditivo**: não atualiza, remove ou bloqueia tabelas do monólito. O modo padrão é dry-run; a escrita exige `BACKFILL_WRITE_ENABLED=true` e aprovação operacional explícita.

O backfill preserva a origem `legacy-api`, usa chaves determinísticas para impedir duplicação e migra entitlements antes dos movimentos. Movimentos cujo entitlement de origem não foi encontrado são contabilizados como ignorados para revisão, sem inventar uma concessão. A migração não cria foreign keys entre bancos.

O cutover recomendado é criar o ledger próprio, executar dry-run e reconciliação, habilitar a ingestão dual, comparar saldos e somente então apontar o gateway para o namespace standalone. Durante a transição, os contratos legados de consulta podem permanecer no gateway, enquanto os fluxos de Agenda e Catálogo passam a usar os endpoints internos autenticados. A remoção do código legado deve ocorrer apenas após reconciliação e observabilidade estáveis.

## Desenvolvimento e validação

A suíte atual utiliza banco PostgreSQL de teste e valida emissão idempotente, reserva/liberação/consumo, isolamento de tenant, anulação sem confusão com consumo e RBAC dinâmico. Antes de publicar alterações, execute `npm run lint:syntax`, `npm test` e `npm run migrate` no banco correto.

O serviço registra `X-Request-Id` em todas as respostas, usa logs estruturados com Pino, aplica Helmet, compressão, CORS configurável e rate limit operacional. O readiness verifica a conexão efetiva ao banco próprio.

<!-- OPERAON-DOCUMENTATION-LINK -->
## Documentação

A documentação técnica padronizada está em [docs/INDEX.md](docs/INDEX.md). Ela inclui arquitetura, responsabilidades, segurança, contratos, operação, testes, runbooks e decisões.
