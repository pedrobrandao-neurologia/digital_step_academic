# O Passo Digital — Análise Quantitativa da Marcha

![Status](https://img.shields.io/badge/status-v2.0-success.svg)
![PWA](https://img.shields.io/badge/PWA-offline-blue.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

**O Passo Digital** é um aplicativo web progressivo (PWA) que usa o acelerômetro e o giroscópio do smartphone fixado na região lombar (L5) para extrair parâmetros espaço-temporais, de variabilidade, assimetria, controle postural e suavidade da marcha, e gera um relatório clínico detalhado do período de marcha avaliado.

Todo o processamento ocorre no aparelho; nenhum dado sai do dispositivo.

---

## Sumário

1. [Como usar](#como-usar)
2. [Instalação como aplicativo (PWA)](#instalação-como-aplicativo-pwa)
3. [Pipeline de processamento](#pipeline-de-processamento)
4. [Revisão da literatura por parâmetro](#revisão-da-literatura-por-parâmetro)
5. [Erros da versão anterior corrigidos](#erros-da-versão-anterior-corrigidos)
6. [Relatório do período de marcha avaliado](#relatório-do-período-de-marcha-avaliado)
7. [Formatos de exportação](#formatos-de-exportação)
8. [Arquitetura e testes](#arquitetura-e-testes)
9. [Limitações](#limitações)
10. [Referências](#referências)

---

## Como usar

### Requisitos
- Smartphone com acelerômetro (o giroscópio é opcional, mas permite excluir curvas automaticamente).
- Safari (iOS 13+) ou Chrome/Firefox (Android). A página precisa ser servida por **HTTPS** (ou `localhost`) para acessar os sensores.
- Cinto elástico ou faixa para fixar o aparelho na região lombar baixa.

### Protocolo
1. **Posicionamento.** Fixe o aparelho em retrato (tela para fora) sobre L5, acima dos glúteos. O modo *bolso* fornece apenas parâmetros temporais.
2. **Testar sensores.** Toque em *Testar sensores* para conceder a permissão de movimento (obrigatória no iOS) e verificar a taxa de amostragem e a presença de giroscópio.
3. **Dados do participante.** Identificação, estatura (obrigatória no modo lombar), comprimento da perna (opcional; padrão 0,53 × estatura), idade e sexo (para as referências de velocidade).
4. **Coleta.** Escolha a duração (20 s a 2 min) e a contagem regressiva; toque em *Iniciar coleta*, permaneça parado durante a contagem e caminhe em linha reta ao sinal sonoro/vibratório. Curvas e passos atípicos são excluídos automaticamente.
5. **Relatório.** Revise os resultados por domínio, os gráficos e a interpretação automática; exporte em PDF, CSV ou JSON, ou compartilhe o PDF.

Sem sensores (computador), use *Demonstração com dados simulados* ou *Importar registro* (CSV/JSON exportados pelo próprio aplicativo).

---

## Instalação como aplicativo (PWA)

- **Android/Chrome:** toque em *Instalar* na barra superior (ou no menu do navegador, *Instalar aplicativo*).
- **iPhone/iPad:** em Safari, toque em *Compartilhar → Adicionar à Tela de Início*.

Depois de instalado, o aplicativo abre em tela cheia e funciona **offline**: o `sw.js` (service worker) pré-armazena a interface, o núcleo de análise e as bibliotecas locais (`vendor/`). O `manifest.webmanifest` define ícones, cores e orientação.

---

## Pipeline de processamento

```
DeviceMotion (acelerômetro ± giroscópio, 50–100 Hz, tempo irregular)
  → normalização de sinal (WebKit inverte accelerationIncludingGravity)
  → reamostragem uniforme a 100 Hz (interpolação linear) e controle de qualidade
  → eixos anatômicos por correção de inclinação (vetor gravitacional médio; Moe-Nilssen 1998)
  → Butterworth passa-baixas 20 Hz, fase zero
  → contatos iniciais/finais por wavelet gaussiana (McCamley 2012)
  → detecção de curvas pela velocidade angular vertical (Pham 2017) e exclusão de outliers
  → passos e passadas → tempos, cadência, variabilidade, assimetria
  → dupla integração + pêndulo invertido → comprimento do passo e velocidade (Zijlstra & Hof 2003)
  → harmonic ratio por passada (Menz 2003), autocorrelação (Moe-Nilssen & Helbostad 2004), RMS e jerk
  → classificação por faixas de referência e relatório estruturado
```

---

## Revisão da literatura por parâmetro

Abaixo, para cada cálculo implementado: o que a literatura recomenda, como o aplicativo implementa e quais valores de referência são usados. As referências completas (com DOI) estão no fim do documento.

### 1. Orientação do sensor e eixos anatômicos
- **Literatura.** Moe-Nilssen (1998) mostrou que a inclinação do acelerômetro lombar pode ser corrigida transformando os sinais para um sistema horizontal-vertical definido pelas componentes gravitacionais médias do próprio registro; este é o procedimento padrão da acelerometria de tronco e o usado por Moe-Nilssen & Helbostad (2004) e Zijlstra & Hof (2003).
- **Implementação.** A vertical (V) é o vetor gravitacional médio do trecho; ântero-posterior (AP) é a normal da tela projetada no plano horizontal; médio-lateral (ML) = V × AP. Como a projeção usa o próprio vetor médio, o resultado independe da convenção de sinal do navegador. O relatório informa a inclinação do aparelho como controle de qualidade da fixação.
- **Por que não Madgwick.** A versão anterior estimava a orientação com um filtro AHRS de Madgwick alimentado com o giroscópio em graus/s (o algoritmo exige rad/s) e inicializado sem convergência, o que produzia rotações erradas e dependia de giroscópio. A correção de Moe-Nilssen é o método validado na literatura de marcha e funciona apenas com acelerômetro.

### 2. Detecção de contatos iniciais (IC) e finais (FC)
- **Literatura.** McCamley et al. (2012) integraram a aceleração vertical e a derivaram com uma transformada wavelet contínua gaussiana (gaus1, escala ≈ 10 a 100 Hz); os IC correspondem aos extremos da primeira derivação e os FC aos extremos da segunda. Erro médio de 0,02 s (IC) e 0,03 s (FC) contra plataformas de força. Del Din et al. (2016) e Pham et al. (2017) validaram a abordagem em idosos e em Parkinson (acurácia de 99 % contra sistema optoeletrônico).
- **Implementação.** Integração da aceleração vertical seguida de derivada gaussiana (σ = 70 ms), equivalente à CWT gaus1; IC = máximos da aceleração suavizada; FC = mínimo do jerk suavizado entre 30 e 350 ms após cada IC. A distância mínima entre IC é adaptada ao período do passo estimado por autocorrelação e a proeminência mínima é adaptativa (25 % do percentil 90).
- **Validação interna.** Nos sinais sintéticos, todos os IC são detectados com desvio-padrão do erro temporal < 7 ms (viés constante de ≈ 5 ms, que se cancela nos intervalos).

### 3. Cadência, tempo do passo e da passada
- **Literatura.** Tempo do passo = IC(i+1) − IC(i); tempo da passada = IC(i+2) − IC(i); cadência = 60 / tempo do passo (Zijlstra & Hof 2003; Del Din 2016). Valores de referência para idosos saudáveis: cadência ≈ 105–115 passos/min, passada ≈ 1,0–1,2 s (Hollman 2011).
- **Implementação.** Idêntica à literatura; passadas sobrepostas são usadas (todas as combinações IC(i)→IC(i+2)), como em Del Din (2016). Passos durante curvas ou com duração fora de mediana ± 3·MAD são excluídos.

### 4. Variabilidade (DP e CV)
- **Literatura.** Hausdorff et al. (2001) mostraram que a DP do tempo da passada prediz quedas em idosos (106 ms em caidores vs. 49 ms em não caidores). Hausdorff (2005) recomenda reportar DP e CV; CV < 3 % em adultos saudáveis. Lord et al. (2013) identificam *variabilidade* como domínio independente da marcha.
- **Implementação.** DP amostral e CV (100·DP/média) dos tempos de passada e passo, CV do comprimento do passo. Faixas: CV < 3 % (normal), 3–5 % (limítrofe), > 5 % (alterado); DP > 60 ms limítrofe, > 90 ms alterado.

### 5. Assimetria
- **Literatura.** Del Din et al. (2016) definem assimetria como a diferença absoluta entre passos alternados (esquerdo/direito). Um sensor único lombar não identifica o lado com segurança; por isso os pés são rotulados A/B.
- **Implementação.** |média(passos A) − média(passos B)| para tempo (ms) e comprimento (cm); simetria por autocorrelação = |Ad1 − Ad2| (Moe-Nilssen & Helbostad 2004).

### 6. Comprimento do passo e velocidade (pêndulo invertido)
- **Literatura.** Zijlstra & Hof (2003): o centro de massa descreve um arco de raio ≈ comprimento da perna (l); a excursão vertical (h) por passo permite estimar o comprimento do passo por `S = 2·√(2·l·h − h²)`. O deslocamento vertical é obtido por dupla integração da aceleração vertical com passa-altas de 0,1 Hz após cada integração para remover deriva. O modelo subestima o passo real, e os autores aplicaram um fator de correção empírico de 1,25; Zijlstra (2004) confirmou a validade em idosos. O comprimento da perna pode ser aproximado por 0,53 × estatura (Winter 2009). Bohannon & Williams Andrews (2011) fornecem velocidades de referência por sexo e década (n = 23 111); Studenski et al. (2011) associam cada 0,1 m/s a 12 % menos mortalidade, com ≥ 1,0 m/s indicando envelhecimento saudável; Abellan van Kan et al. (2009) recomendam < 0,8 m/s como marcador de vulnerabilidade.
- **Implementação.** Passa-baixas 20 Hz → integração → passa-altas 0,1 Hz → integração → passa-altas 0,1 Hz; h = amplitude pico a pico do deslocamento dentro de cada passo; `S = 1,25 · 2 · √(2·l·h − h²)`; velocidade = comprimento da passada / tempo da passada. O comprimento da perna pode ser informado (medido do trocânter ao solo) ou estimado por 0,53 × estatura. O relatório compara a velocidade com a média ± DP da faixa etária/sexo (escore z).
- **Validação interna.** Erro de 2–4 % em sinais sintéticos com excursão vertical conhecida.

### 7. Harmonic ratio (HR)
- **Literatura.** Menz, Lord & Fitzpatrick (2003) definem o HR por passada como a soma das amplitudes das 10 primeiras harmônicas pares dividida pela soma das 10 primeiras ímpares (20 harmônicas) nas direções V e AP (dois ciclos por passada) e a razão invertida (ímpares/pares) em ML (um ciclo por passada). HR reduzido em V e AP identifica idosos com risco de queda (Menz et al. 2003, J Gerontol) e é sensível a Parkinson.
- **Implementação.** DFT direta nas 20 harmônicas da frequência da passada, segmento por segmento (IC(i)→IC(i+2)), média das passadas válidas. Faixas aproximadas: V/AP > 2, ML > 1,5.

### 8. Regularidade e simetria por autocorrelação
- **Literatura.** Moe-Nilssen & Helbostad (2004) usam o coeficiente de autocorrelação não enviesado do sinal vertical/AP: o primeiro pico dominante (Ad1, lag de um passo) expressa a regularidade do passo, o segundo (Ad2, lag de uma passada) a regularidade da passada, e a diferença entre eles a simetria.
- **Implementação.** Autocorrelação não enviesada no trecho contínuo válido mais longo; picos procurados em janelas de ± 30 % em torno do tempo médio de passo e de passada.

### 9. Controle postural e suavidade (RMS e jerk)
- **Literatura.** Moe-Nilssen (1998) demonstrou a confiabilidade teste-reteste do RMS da aceleração do tronco em V, AP e ML como medida de controle da marcha (ICC 0,79–0,94), dependente da velocidade. Melendez-Calderon et al. (2021) alertam que medidas de suavidade baseadas em jerk a partir de IMU devem ser interpretadas com cautela e recomendam normalização.
- **Implementação.** RMS por eixo e RMS do jerk 3D (derivada gaussiana da aceleração filtrada a 20 Hz), além de um jerk adimensional (jerk RMS × tempo da passada / RMS da aceleração). Reportados como informativos, sem faixas de referência, para comparação intraindividual.

### 10. Fases temporais (apoio, balanço, duplo apoio) — exploratório
- **Literatura.** Com IC e FC, Del Din et al. (2016) derivam tempos de apoio, balanço e duplo apoio; a concordância com passarela instrumentada é apenas moderada para estas variáveis.
- **Implementação.** Apoio = IC(i) → FC após IC(i+1); balanço = FC → IC(i+2); duplo apoio = soma dos dois intervalos IC→FC da passada. Só são reportadas quando fisiologicamente plausíveis (duplo apoio 8–45 %, balanço 25–50 % da passada) e são sinalizadas como *exploratórias*.

### 11. Detecção de curvas
- **Literatura.** Pham et al. (2017) validaram a detecção de curvas ≥ 90° pela velocidade angular vertical de um sensor lombar (sensibilidade 0,92–0,94); El-Gohary et al. (2014) usaram limiar de 15°/s e ângulo mínimo de 45°.
- **Implementação.** Componente do giroscópio alinhada à vertical, passa-baixas 1,5 Hz, limiar de 20°/s, união de segmentos separados por < 0,5 s, ângulo acumulado ≥ 45°; passos que tocam a curva ± 0,5 s são excluídos. Sem giroscópio, o relatório avisa que curvas não foram avaliadas.

### 12. Domínios da marcha e classificação
- **Literatura.** Lord et al. (2013) validaram um modelo de cinco domínios (passo/pace, ritmo, variabilidade, assimetria, controle postural) que explica 79,5 % da variância da marcha em idosos.
- **Implementação.** Os parâmetros são organizados por esses domínios; cada um recebe um status (dentro da referência / limítrofe / fora da referência / informativo) com base nas faixas citadas acima; a interpretação automática descreve os achados por domínio e emite uma síntese.

---

## Erros da versão anterior corrigidos

| Problema na versão 1 | Consequência | Correção na versão 2 |
|---|---|---|
| Diversas funções marcadas como *"omitido para brevidade"* (Madgwick, Butterworth, FFT, coleta, análise lombar, gráficos) | O aplicativo não executava | Reimplementação completa em `gait-analysis.js` e `app.js`, com testes |
| Giroscópio em graus/s passado ao filtro de Madgwick (que exige rad/s) | Orientação errada; aceleração vertical contaminada por gravidade | Correção de inclinação de Moe-Nilssen (1998), independente de giroscópio |
| Sinal invertido do `accelerationIncludingGravity` no iOS ignorado | Eixos trocados em iPhone | Normalização de sinal por plataforma + projeção sign-agnóstica |
| Coeficientes Butterworth fixos para 50 Hz, aplicados a dados de 60–100 Hz irregulares | Banda de filtro errada e deriva de fase (atraso nos eventos) | Reamostragem a 100 Hz e projeto Butterworth por transformação bilinear, filtragem de fase zero |
| FFT radix-2 aplicada a segmentos com N arbitrário | Harmonic ratio numericamente inválido | DFT direta nas 20 harmônicas da passada |
| Dupla integração por passo a partir de zero, sem remoção de deriva, usando o valor final da posição | Excursão vertical errada → comprimento do passo errado | Integração contínua com passa-altas 0,1 Hz e amplitude pico a pico por passo (Zijlstra & Hof 2003) |
| Ausência do fator de correção 1,25 do pêndulo invertido | Subestimação sistemática de ≈ 20 % do passo e da velocidade | Fator 1,25 aplicado e documentado |
| Detecção de passos por limiar fixo de 0,5 m/s² no sinal passa-banda | Passos perdidos/duplicados conforme o aparelho | Método de McCamley com limiar de proeminência adaptativo |
| Autocorrelação em lag fixo arredondado | Regularidade subestimada | Busca de pico em janela em torno do lag esperado |
| Calibração em superfície plana com subtração de 9,81 no eixo z | Viés incorreto para o aparelho em posição lombar | Removida; referência gravitacional obtida do próprio registro |
| Nenhuma exclusão de curvas ou outliers | Curvas no corredor contaminavam variabilidade e simetria | Detecção de curvas (giroscópio) e exclusão robusta (mediana ± 3·MAD) |
| Relatório sem descrição do período analisado | Impossível auditar o trecho usado | Seção *Período de marcha avaliado* com trechos, passos válidos/excluídos, curvas, qualidade do sinal |
| Dependência de CDN (Tailwind, Chart.js, jsPDF) e sem manifest/service worker | Não funcionava offline nem instalável | PWA completo com bibliotecas locais, manifest, service worker e ícones |

---

## Relatório do período de marcha avaliado

O relatório (na tela e em PDF) contém:

1. **Cabeçalho** — participante, data/hora, idade, sexo, estatura, comprimento da perna, posição do sensor, versões.
2. **Síntese** — velocidade, cadência, comprimento do passo e CV da passada com status.
3. **Período de marcha avaliado** — duração do registro, amostras e taxa de amostragem, intervalo analisado, tempo de marcha válida, número de trechos contínuos, contatos detectados, passos e passadas válidos/excluídos (curvas, duração atípica), distância estimada, inclinação do aparelho, parâmetros do modelo.
4. **Parâmetros por domínio** (Lord 2013) — valor, unidade, referência bibliográfica e status.
5. **Interpretação automática** — texto por domínio, comparação da velocidade com a norma etária/sexo (escore z), síntese dos achados.
6. **Qualidade do registro e limitações** — avisos (taxa de amostragem, interrupções, inclinação, giroscópio ausente) e limitações metodológicas.
7. **Sinais e eventos** — aceleração vertical com contatos iniciais e trechos excluídos, deslocamento vertical, tempo de cada passada, autocorrelação.
8. **Anexo passada a passada** — início, duração, tempos dos passos, comprimento, HR-V, duplo apoio, validade/motivo de exclusão.
9. **Metodologia e referências** com DOI.

---

## Formatos de exportação

| Arquivo | Conteúdo |
|---|---|
| `relatorio_marcha_<id>_<data>.pdf` | Relatório completo (acima) |
| `resultados_<id>_<data>.csv` | Formato longo: `metric_id, label, value, unit, flag, domain, reference` + metadados da sessão |
| `passadas_<id>_<data>.csv` | Uma linha por passada: tempos, comprimento, HR (V/AP/ML), fases, validade |
| `brutos_<id>_<data>.csv` | `t_s, acc_x, acc_y, acc_z, gyro_x, gyro_y, gyro_z` (m/s² e °/s, convenção W3C) |
| `sessao_<id>_<data>.json` | Tudo: participante, sessão, métricas, flags, passos, passadas, relatório e sinais brutos (reimportável) |

CSV com vírgula como separador e ponto decimal (`read.csv()` no R). Exemplo em R:

```r
res <- read.csv("resultados_P001_20260907_1030.csv")
passadas <- read.csv("passadas_P001_20260907_1030.csv")
subset(res, domain == "Variabilidade")
with(subset(passadas, valid == 1), c(media = mean(stride_time_s), cv = 100 * sd(stride_time_s) / mean(stride_time_s)))
```

---

## Arquitetura e testes

```
index.html            interface (HTML + CSS próprio, design system inspirado nas HIG da Apple)
app.js                coleta de sensores, gráficos (Chart.js), relatório, exportações, PWA
gait-analysis.js      núcleo de análise puro (browser e Node), simulador de marcha
sw.js                 service worker (offline)
manifest.webmanifest  manifesto do PWA
vendor/               Chart.js 4.4.1, jsPDF 2.5.1, jsPDF-AutoTable 3.5.23 (licenças incluídas)
icons/                ícones PNG (192, 512, maskable, apple-touch-icon)
tests/run-tests.js    testes do núcleo com sinais sintéticos (node tests/run-tests.js)
tests/smoke.js        teste de fumaça da interface em Chromium headless (Playwright)
tests/make-icons.js   geração dos ícones
```

```bash
node tests/run-tests.js          # 68 verificações: filtros, HR, autocorrelação, pipeline completo (Android/iOS, curvas, assimetria, sem giroscópio, bolso)
npx http-server -p 8080 . &      # servidor local
node tests/smoke.js              # demonstração, relatório, PDF, tema escuro, service worker, modo bolso
```

Design: fonte do sistema, listas agrupadas, controles segmentados com indicador deslizante, folha modal de coleta com anel de progresso, feedback no toque (escala 0,97), barra translúcida (`backdrop-filter`), tema claro/escuro automático e respeito a `prefers-reduced-motion`, `prefers-reduced-transparency` e `prefers-contrast`.

---

## Limitações

- Um único sensor lombar não identifica o lado (esquerdo/direito); assimetrias são reportadas entre pés alternados A/B.
- O modelo do pêndulo invertido assume marcha em linha reta, superfície plana e fixação firme; erros típicos de 5–10 % no comprimento do passo.
- As fases temporais (apoio/balanço/duplo apoio) são exploratórias.
- As faixas de referência provêm de populações específicas (idosos comunitários, adultos saudáveis) e não substituem normas locais.
- O aplicativo é um instrumento complementar de avaliação quantitativa; não realiza diagnóstico.

---

## Referências

1. McCamley J, Donati M, Grimpampi E, Mazzà C. An enhanced estimate of initial contact and final contact instants of time using lower trunk inertial sensor data. *Gait Posture*. 2012;36(2):316-8. https://doi.org/10.1016/j.gaitpost.2012.02.019
2. Zijlstra W, Hof AL. Assessment of spatio-temporal gait parameters from trunk accelerations during human walking. *Gait Posture*. 2003;18(2):1-10. https://doi.org/10.1016/S0966-6362(02)00190-X
3. Zijlstra W. Assessment of spatio-temporal parameters during unconstrained walking. *Eur J Appl Physiol*. 2004;92(1-2):39-44. https://doi.org/10.1007/s00421-004-1041-5
4. Moe-Nilssen R. Test-retest reliability of trunk accelerometry during standing and walking. *Arch Phys Med Rehabil*. 1998;79(11):1377-85. https://doi.org/10.1016/S0003-9993(98)90231-3
5. Moe-Nilssen R, Helbostad JL. Estimation of gait cycle characteristics by trunk accelerometry. *J Biomech*. 2004;37(1):121-6. https://doi.org/10.1016/S0021-9290(03)00233-1
6. Menz HB, Lord SR, Fitzpatrick RC. Acceleration patterns of the head and pelvis when walking on level and irregular surfaces. *Gait Posture*. 2003;18(1):35-46. https://doi.org/10.1016/S0966-6362(02)00159-5
7. Menz HB, Lord SR, Fitzpatrick RC. Acceleration patterns of the head and pelvis when walking are associated with risk of falling in community-dwelling older people. *J Gerontol A Biol Sci Med Sci*. 2003;58(5):M446-52. https://doi.org/10.1093/gerona/58.5.M446
8. Del Din S, Godfrey A, Rochester L. Validation of an accelerometer to quantify a comprehensive battery of gait characteristics in healthy older adults and Parkinson's disease: toward clinical and at home use. *IEEE J Biomed Health Inform*. 2016;20(3):838-47. https://doi.org/10.1109/JBHI.2015.2419317
9. Pham MH, Elshehabi M, Haertner L, et al. Validation of a step detection algorithm during straight walking and turning in patients with Parkinson's disease and older adults using an inertial measurement unit at the lower back. *Front Neurol*. 2017;8:457. https://doi.org/10.3389/fneur.2017.00457
10. Pham MH, Elshehabi M, Haertner L, et al. Algorithm for turning detection and analysis validated under home-like conditions in patients with Parkinson's disease and older adults using a 6 degree-of-freedom inertial measurement unit at the lower back. *Front Neurol*. 2017;8:135. https://doi.org/10.3389/fneur.2017.00135
11. Hausdorff JM, Rios DA, Edelberg HK. Gait variability and fall risk in community-living older adults: a 1-year prospective study. *Arch Phys Med Rehabil*. 2001;82(8):1050-6. https://doi.org/10.1053/apmr.2001.24893
12. Hausdorff JM. Gait variability: methods, modeling and meaning. *J Neuroeng Rehabil*. 2005;2:19. https://doi.org/10.1186/1743-0003-2-19
13. Lord S, Galna B, Verghese J, Coleman S, Burn D, Rochester L. Independent domains of gait in older adults and associated motor and nonmotor attributes: validation of a factor analysis approach. *J Gerontol A Biol Sci Med Sci*. 2013;68(7):820-7. https://doi.org/10.1093/gerona/gls255
14. Bohannon RW, Williams Andrews A. Normal walking speed: a descriptive meta-analysis. *Physiotherapy*. 2011;97(3):182-9. https://doi.org/10.1016/j.physio.2010.12.004
15. Hollman JH, McDade EM, Petersen RC. Normative spatiotemporal gait parameters in older adults. *Gait Posture*. 2011;34(1):111-8. https://doi.org/10.1016/j.gaitpost.2011.03.024
16. Studenski S, Perera S, Patel K, et al. Gait speed and survival in older adults. *JAMA*. 2011;305(1):50-8. https://doi.org/10.1001/jama.2010.1923
17. Abellan van Kan G, Rolland Y, Andrieu S, et al. Gait speed at usual pace as a predictor of adverse outcomes in community-dwelling older people: an IANA Task Force. *J Nutr Health Aging*. 2009;13(10):881-9. https://doi.org/10.1007/s12603-009-0246-z
18. Melendez-Calderon A, Shirota C, Balasubramanian S. Estimating movement smoothness from inertial measurement units. *Front Bioeng Biotechnol*. 2021;8:558771. https://doi.org/10.3389/fbioe.2020.558771
19. Del Din S, Godfrey A, Mazzà C, Lord S, Rochester L. Free-living monitoring of Parkinson's disease: lessons from the field. *Mov Disord*. 2016;31(9):1293-313. https://doi.org/10.1002/mds.26718
20. Winter DA. *Biomechanics and Motor Control of Human Movement*. 4th ed. Wiley; 2009 (tabelas antropométricas: comprimento da perna ≈ 0,53 × estatura).

---

## Licença

MIT. Bibliotecas de terceiros em `vendor/` mantêm suas licenças (MIT).
