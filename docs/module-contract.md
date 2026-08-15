# Contrato do módulo — entitlements

Este documento resume o contrato local de entitlements. O contrato transversal de headers e webhooks está em [communication-contract.md](communication-contract.md).

## Entrada

Chamadas internas devem utilizar JWT de serviço com audience do destino, scopes mínimos, contexto de tenant, correlação, origem, idempotência e os headers canônicos. Rotas públicas, quando existirem, passam pelo API Gateway.

## Saída

Chamadas a outros módulos devem utilizar o builder de headers padronizado, timeout, retry limitado, correlação e idempotência. Eventos devem utilizar envelope versionado e ser publicados após commit via outbox quando dependerem de transação local.

## Compatibilidade

Mudanças incompatíveis exigem nova versão ou período de compatibilidade documentado. Nenhum consumidor deve depender de tabelas internas ou de estados que pertencem a outro owner.

## Segurança

O módulo não deve ser exposto diretamente à Internet. O tenant deve ser validado, segredos devem permanecer fora do Git e webhooks devem validar assinatura, timestamp, nonce e identificador de entrega.

## Referências

[1]: https://github.com/operaon "Organização Operaon"

## Capacidades comerciais por tenant

O Entitlements mantém dois subdomínios separados. O ledger de `SESSION` continua responsável por créditos de sessão de pacientes, reservas, consumo, reembolso e anulação. O subdomínio comercial é responsável por concessões declarativas de funcionalidades e quotas técnicas do tenant.

As feature keys seguem o formato minúsculo com separadores, por exemplo `module:clinical`, `module:branding`, `capability:payments.online` e `quota:professionals`. Grants booleanos habilitam funcionalidades; grants do tipo `QUOTA` concedem uma quantidade e unidade, como `PROFESSIONAL`, `UNIT`, `GB` ou `MESSAGE`.

Cada grant possui tenant, organização opcional, origem idempotente, estado, janela de vigência e metadata. O consumo de quotas é registrado em `feature_grant_movements`; operações de consumo e liberação exigem `Idempotency-Key` e nunca devem ser inferidas somente pelo frontend.

O campo legado `Tenant.maxProfessionals` permanece compatível durante a migração, mas a fonte de verdade planejada para novos fluxos é `quota:professionals`. Nenhum módulo deve criar sua própria tabela de planos ou replicar grants do Entitlements.
