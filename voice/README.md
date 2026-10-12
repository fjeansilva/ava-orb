# Ava Voice — conversa por voz com GPT-Live-1

Aba web, um usuário, sem teclado nem mouse depois do primeiro toque. O browser abre o microfone, faz WebRTC direto com a OpenAI e o orbe reage ao áudio dos dois lados; o servidor local só troca o SDP e guarda a chave.

## Rodar

```bash
cd ava-orb/voice
cp .env.example .env        # coloque OPENAI_API_KEY
node --env-file=.env server.mjs
# abra http://localhost:3000 e toque em "Conversar"
```

Requisitos: Node 22+, Chrome ou Safari, microfone. `localhost` já conta como contexto seguro para o mic.

Variáveis (todas opcionais, menos a chave):

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | Chave do projeto; nunca vai ao browser |
| `AVA_VOICE_MODEL` | `gpt-live-1` | Modelo de voz (camada full-duplex) |
| `AVA_BACKEND_MODEL` | `gpt-5.6-terra` | Modelo de raciocínio delegado (troque por Astra para tarefas complexas) |
| `AVA_VOICE` | `Vesper` | Uma das 12 vozes de estoque |
| `PORT` | `3000` | Porta local |

## Como está montado

- `server.mjs` — `POST /api/session` recebe o SDP do browser e chama `POST /v1/live/sessions` com a configuração da sessão (modelo de voz, instruções de `prompt-ava.md`, delegação `responses` com `web_search` e a função `get_local_time`). Devolve o SDP de resposta e o id da sessão. Só aceita origem `localhost`.
- `voice.js` — abre o mic, cria o `RTCPeerConnection` com o canal `oai-events`, espera o ICE, troca o SDP, toca o áudio remoto e escuta os eventos. Executa as function calls do backend (`response.output_item.done` → `response.item.create` → `response.create`).
- `prompt-ava.md` — personalidade e regras de fala da Ava. Edite à vontade; o servidor lê a cada boot.

### Mapa de eventos → estado do orbe

Full-duplex significa que os dois podem falar ao mesmo tempo, então o estado é resolvido por prioridade a cada frame:

| Sinal | Como é detectado | Estado |
| --- | --- | --- |
| Ava falando | RMS da faixa de áudio remota (WebRTC) acima de 0,015 nos últimos 350 ms | `speaking`, nível = amplitude |
| Jean falando | RMS do microfone acima de 0,02 nos últimos 600 ms (e `session.input_transcript.delta`) | `listening`, nível = amplitude |
| Backend trabalhando | `session.delegation.created` sem `response.completed` correspondente | `thinking` |
| Conectada, em silêncio | `session.started` recebido | `listening` |
| Desconectada | antes de conectar, `session.closed`, queda de conexão | `sleeping` |

A transcrição usa `session.input_transcript.delta` e `session.output_transcript.delta`; a API não marca fim de turno, então o app agrupa por quem fala.

### Expressões do rosto

Três caminhos, do mais automático ao mais deliberado:

1. **Estado de turno** (padrão): ouvindo → atenta, pensando → pensativa, falando → feliz, desconectada → sonolenta.
2. **Léxico da fala** (`EXPR_RULES` em `voice.js`): a cada frase da Ava, uma expressão temporária é escolhida pelas palavras ("que bom" → feliz, "uau" → surpresa, "deixa eu ver" → pensativa, "infelizmente" → triste, "será?" → desconfiada, "boa noite" → sonolenta, "fica entre nós" → piscadinha, frase terminando em "?" → atenta). Edite as regras à vontade.
3. **Ferramenta `set_expression`** (declarada em `server.mjs`): o backend pode pedir uma expressão explícita com nome em português e duração. Útil para momentos precisos.

Erros de API viram "triste" e delegações viram "pensativa" automaticamente.

## Próximos passos naturais

1. Trocar `get_local_time` pelas suas ferramentas de verdade: DataHub (`woba-datahub`), calendário, escalações. A assinatura entra em `server.mjs` (`tools`) e a execução em `voice.js` (`runTool`), ou num endpoint do servidor se precisar de segredo.
2. Delegação `client` em vez de `responses` quando quiser o COS/Pi como backend: o app recebe `session.delegation.created`, roda seu agente e devolve com `session.commentary.append` (falar) ou `session.thinking.append` (contexto silencioso).
3. Medir latência voz-a-voz: marque `lastUser` no último delta de entrada e o primeiro RMS remoto acima do limiar; alvo 800 ms, p95 abaixo de 1,2 s.

## Avisos

- A API do GPT-Live é de setembro de 2026; nomes de campos foram tirados da documentação pública em outubro de 2026 (`developers.openai.com/api/docs/guides/live`). Se a OpenAI mudar algo, o erro aparece na transcrição com o corpo da resposta.
- Criar uma sessão WebRTC cobra 15 s de voz na inicialização (creditados depois). A camada de voz custa US$ 0,05/min; o backend é cobrado à parte.
