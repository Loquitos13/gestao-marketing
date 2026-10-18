# Configuração das APIs oficiais

As credenciais podem ser introduzidas em **Integrações → Configuração** (guardadas encriptadas com AES-256-GCM na base de dados; os segredos nunca voltam ao browser, só os últimos 4 caracteres) ou no `.env` do servidor. O valor guardado na interface sobrepõe-se ao `.env`. Com `SETTINGS_ENV_ONLY=1` só o `.env` é usado e a edição fica bloqueada. Nunca coloque credenciais no repositório nem no frontend. Depois de alterar o `.env`, reinicie a aplicação e o worker.

Uma integração só é considerada funcional quando a página **Integrações** mostra «Verificada», ou seja, quando pelo menos uma fonte real concluiu uma sincronização com sucesso. «Configurada» ou «Ligada» não chegam.

## Google (Google Ads, Search Console, GA4)

Uma única ligação OAuth Google cobre os três serviços.

1. Em [Google Cloud Console](https://console.cloud.google.com/), crie (ou escolha) um projeto.
2. Em **APIs e serviços → Biblioteca**, ative a **Google Ads API**, a **Google Search Console API**, a **Google Analytics Data API** e a **Google Analytics Admin API** (usada para descobrir as propriedades GA4).
3. Configure o **Ecrã de consentimento OAuth**. Enquanto a app estiver em modo «Testing», adicione o seu email como utilizador de teste. Os refresh tokens de apps em «Testing» expiram ao fim de 7 dias. Para uso contínuo, publique a app (pode exigir verificação da Google por causa do âmbito `adwords`).
4. Em **Credenciais → Criar credenciais → ID de cliente OAuth → Aplicação Web**, adicione o URI de redirecionamento autorizado:
   `${APP_URL}/api/oauth/google/callback` (ex.: `http://localhost:3100/api/oauth/google/callback`).
5. Copie para o `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

Âmbitos pedidos (só leitura, exceto `adwords`, que a Google não divide): `openid`, `email`, `https://www.googleapis.com/auth/adwords`, `https://www.googleapis.com/auth/webmasters.readonly`, `https://www.googleapis.com/auth/analytics.readonly`. A aplicação só escreve na Google Ads API quando a gestão está ativa para o cliente (Cliente → Gestão → Definições) e um utilizador com permissão confirma explicitamente cada proposta. Antes de aplicar, cada alteração é validada com `validate_only` e o estado atual é relido; se mudou fora do hub, é abortada.

### Developer token da Google Ads

1. Numa conta gestora (MCC) do Google Ads, abra **Ferramentas → Centro de API**.
2. Peça um developer token. Inicialmente fica com acesso a **contas de teste** apenas; para contas reais é preciso pedir **Basic access** (revisão da Google, alguns dias). O Basic access é também necessário para o **Keyword Planner** (`generateKeywordIdeas`) e para aplicar alterações; sem ele, a fonte aparece como «Credenciais em falta» na página Concorrência.
3. `.env`: `GOOGLE_ADS_DEVELOPER_TOKEN`. Se as contas dos clientes estiverem sob a sua MCC, defina `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (ID da MCC sem hífenes).
4. `GOOGLE_ADS_API_VERSION` deve ser uma versão suportada (ver [notas de versão](https://developers.google.com/google-ads/api/docs/release-notes)); versões antigas são desativadas pela Google.

## Meta (Marketing API, Páginas e Instagram)

1. Em [developers.facebook.com](https://developers.facebook.com/), crie uma app do tipo **Empresa**.
2. Adicione os produtos **Facebook Login for Business** e **Marketing API**.
3. Em Facebook Login → Definições, adicione o URI de redirecionamento OAuth válido:
   `${APP_URL}/api/oauth/meta/callback`.
4. `.env`: `META_APP_ID`, `META_APP_SECRET`, e `META_GRAPH_VERSION` (versão atual do Graph API).
5. Permissões pedidas: `ads_read`, `read_insights`, `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights`, `business_management`. Em modo de desenvolvimento só funcionam para utilizadores com papel na app; para outras contas é necessária a **App Review** da Meta.

O token de curta duração é trocado imediatamente por um de longa duração (~60 dias). A Meta não fornece refresh token: perto da expiração aparece um alerta e é preciso voltar a autorizar.

### Gestão de anúncios na Meta (opcional)

A permissão `ads_management` é pedida num botão separado («Ligar com gestão de anúncios» em Integrações), para que a ligação normal continue só de leitura. Para contas de clientes, a app precisa de **App Review** com **acesso avançado** a `ads_management` e de **Business Verification**. Sem esta permissão, as propostas Meta não podem ser aplicadas e a Gestão indica que é preciso voltar a autorizar.

### Biblioteca de Anúncios da Meta (pesquisa de concorrência)

A Ad Library API usa o mesmo token Meta, mas exige que o utilizador que autorizou tenha **confirmado a identidade** em [facebook.com/ID](https://www.facebook.com/ID) e aceite os termos em [facebook.com/ads/library/api](https://www.facebook.com/ads/library/api). Só são pedidos anúncios ativos com alcance em Portugal. O campo `ad_snapshot_url` não é pedido porque inclui o token de acesso; a interface liga à página pública da Biblioteca.

## Semrush (opcional)

1. Requer um plano Semrush com acesso à API e unidades disponíveis.
2. `.env`: `SEMRUSH_API_KEY` e `SEMRUSH_DATABASE` (ex.: `pt`).
3. Na página **Fontes** do cliente, associe o domínio. Cada sincronização consome unidades da sua conta.

## Pesquisa de concorrência

Usa apenas fontes gratuitas ou incluídas nas contas Google Ads e Meta. Não há scraping dos resultados da Google nem APIs de SERP pagas; Auction Insights e o Centro de Transparência de Anúncios da Google não têm API pública e não estão disponíveis.

| Fonte | Requisito |
| --- | --- |
| Páginas públicas | Nenhum. Rastreio próprio com `User-Agent: MarketingIntelligenceHub/1.0 (+APP_URL)`, respeita o `robots.txt` (incluindo `Crawl-delay`), 1 pedido/s, até 50 páginas por domínio, só HTML até 2 MB. Bloqueia IPs privados, portas não-standard e DNS rebinding |
| Keyword Planner | Google Ads ligada ao cliente e developer token com Basic access. Atualizado no máximo uma vez por 30 dias por semente |
| Biblioteca de Anúncios da Meta | Token Meta com identidade confirmada (ver acima) |
| PageSpeed Insights | Funciona sem chave com quota partilhada baixa. Para uso regular, crie uma chave em Google Cloud (API **PageSpeed Insights**) e guarde-a como `PAGESPEED_API_KEY` |

Com Redis configurado, a atualização corre na fila `mih-research` do worker (semanal às segundas 02:00; palavras-chave mensal no dia 1 às 03:00). Sem Redis, o botão «Atualizar» corre no pedido, limitado a 10 páginas por concorrente.

## Agente de IA local (Ollama)

O agente corre neste servidor; nenhum dado é enviado para fornecedores externos de IA.

1. Instale o [Ollama](https://ollama.com/download) e descarregue o modelo: `ollama pull qwen2.5:7b-instruct` (≈ 4,7 GB; corre em CPU, mais depressa com GPU).
2. `OLLAMA_URL` (por omissão `http://127.0.0.1:11434`; só são aceites endereços locais) e `AGENT_MODEL`. Depois de cada pedido o modelo permanece cerca de 30 minutos e liberta a memória a seguir. Chat, texto de relatório e worker entram um de cada vez. A janela (`AGENT_CONTEXT_TOKENS`, por omissão 8192; 2048 a 32768) reparte-se entre regras, ferramentas pedidas pela pergunta, histórico recente e resultados; o Ollama reserva memória para a janela inteira, por isso valores maiores aumentam a latência. A parte fixa do prompt vem antes dos dados do cliente para a cache do Ollama servir entre perguntas; cada execução regista tokens de entrada/saída e duração.
3. No perfil Docker (`docker compose --profile full`), a app e o worker correm com `MIH_IN_DOCKER=1`: um URL de loopback é reescrito para `host.docker.internal`, onde está o Ollama deste PC.
4. Sem Ollama, os modelos estatísticos próprios (previsão Holt-Winters, curvas de resposta, anomalias) continuam a funcionar; só o chat e os textos gerados ficam indisponíveis. O worker anuncia-se no Redis; se não estiver a correr, a página do agente e os botões que enfileiram trabalho avisam.
5. Opcional: `npm run agent:export` gera `exports/agent-dataset.jsonl` com as decisões aprovadas, para afinação LoRA fora da aplicação (ex.: Unsloth) e importação no Ollama com um `Modelfile`. A pasta `exports/` está no `.gitignore`.

O agente nunca aplica alterações: cria propostas que um utilizador tem de confirmar na Gestão.

## Email (opcional)

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Sem `SMTP_HOST`, relatórios e alertas **não são enviados**; cada tentativa fica registada como «Não enviado: SMTP não configurado».

Com SMTP e Redis, os proprietários e administradores recebem um email quando o worker está parado há mais de 15 minutos (verificado em `/api/health`, uma vez por paragem).

## Taxas de câmbio (BCE)

O worker importa todos os dias às 16:30 UTC as taxas de referência do Banco Central Europeu (`eurofxref-daily.xml`, base EUR, ~30 moedas, sem chave) e grava-as com a fonte «ECB». As taxas introduzidas manualmente em Definições para o mesmo dia nunca são substituídas. Liga-se e desliga-se em **Integrações → Configuração → Taxas de câmbio (BCE)** (ligada por omissão; o botão «Testar» confirma que o BCE responde).

## Depois de ligar

1. **Integrações → Ligar Google/Meta.** São descobertas as contas a que a sua conta tem acesso.
2. **Cliente → Fontes → Associar conta**, escolhendo quantos dias de histórico importar (até ~3 anos; os limites reais dependem de cada API: Search Console ≈ 16 meses, Meta insights ≈ 37 meses).
3. Acompanhe o job em **Cliente → Histórico**. Erros de permissão ou de token aparecem ali e em **Alertas**.

## Revogar

**Integrações → Revogar** revoga o token no fornecedor, apaga-o da base de dados e desliga as fontes associadas. Os dados já importados mantêm-se, a não ser que os elimine na página Fontes.
