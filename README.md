# O Passo Digital - Análise de Marcha Clínica

![Status](https://img.shields.io/badge/status-active-success.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## 📋 Sobre o Projeto

**O Passo Digital** é uma aplicação web avançada para análise biomecânica da marcha humana utilizando os sensores inerciais (acelerômetro e giroscópio) de smartphones. Desenvolvido para uso clínico e de pesquisa, o aplicativo implementa algoritmos estado-da-arte para processamento de sinais e extração de parâmetros quantitativos da marcha.

### ✨ Características Principais

- 📱 **Coleta de dados em tempo real** usando sensores do smartphone
- 🧭 **Estimativa de orientação 3D** com filtro de Madgwick (AHRS)
- 🔍 **Processamento avançado de sinais** com filtros Butterworth
- 📊 **Múltiplos parâmetros biomecânicos** (temporais, espaciais, qualidade)
- 📈 **Visualização interativa** com gráficos de aceleração e trajetória
- 📄 **Exportação completa** em CSV, JSON e PDF com metodologia detalhada

---

## 🚀 Como Usar

### Requisitos
- Smartphone ou tablet com sensores de movimento (acelerômetro e giroscópio)
- Navegador web moderno (Chrome, Safari, Firefox)
- Cinto ou suporte para fixação do dispositivo

### Protocolo de Coleta

1. **Posicionamento (CRÍTICO)**: 
   - Fixe o smartphone firmemente na região lombar, sobre a vértebra L5 (acima dos glúteos)
   - Use um cinto elástico ou suporte apropriado
   - A orientação correta é essencial para a validade dos cálculos

2. **Calibração**:
   - Com o dispositivo já posicionado, permaneça parado em pé por 3 segundos
   - Clique em **"Calibrar Sensores"** e conceda permissão de acesso aos sensores
   - A calibração remove o bias dos sensores

3. **Configuração**:
   - Insira um ID para identificação do participante
   - Digite a altura em centímetros (necessária para cálculos biomecânicos)
   - Selecione a duração da coleta (20, 40 ou 60 segundos)

4. **Coleta de Dados**:
   - Pressione **"Iniciar Coleta"**
   - Caminhe em linha reta em um corredor plano
   - Mantenha velocidade natural e confortável
   - A coleta parará automaticamente

5. **Análise e Exportação**:
   - Os resultados são processados e exibidos automaticamente
   - Visualize gráficos de aceleração e trajetória estimada
   - Exporte os dados brutos ou resultados nos formatos desejados
   - O relatório PDF inclui metodologia completa e referências

---

## 🧮 Parâmetros Calculados

### Parâmetros Temporais

#### **Cadência (passos/min)**
- **Método**: Contagem de passos detectados por unidade de tempo
- **Fórmula**: `Cadência = 120 / Tempo do Ciclo`
- **Valor Típico**: 110 - 120 passos/min
- **Significado Clínico**: Redução associada a declínio funcional, risco de quedas e patologias neurológicas

#### **Tempo do Ciclo de Marcha (s)**
- **Método**: Intervalo entre contatos iniciais consecutivos do mesmo pé (2 passos)
- **Fórmula**: `Tempo do Ciclo = t(IC_i+2) - t(IC_i)`
- **Valor Típico**: 1,0 - 1,2 segundos
- **Significado Clínico**: Aumentado em marcha lenta ou patológica

### Parâmetros de Variabilidade

#### **Coeficiente de Variação do Tempo do Ciclo (CV %)**
- **Método**: Variabilidade temporal entre ciclos consecutivos
- **Fórmula**: `CV = 100 × (σ / μ)` onde σ = desvio padrão e μ = média
- **Valor Típico**: < 3%
- **Significado Clínico**: Valores elevados (>3%) indicam instabilidade, risco de quedas e disfunção neuromotora
- **Referência**: Lord et al. (2013) - biomarcador sensível para Parkinson

### Parâmetros Espaciais

#### **Comprimento do Passo (m)**
- **Método**: Modelo do Pêndulo Invertido (Zijlstra & Hof, 2003)
- **Fórmula**: `S = 2√(2hΔz - Δz²)`
  - `h` = altura do centro de massa (0,53 × altura corporal)
  - `Δz` = deslocamento vertical do tronco obtido por dupla integração da aceleração vertical
- **Procedimento**:
  1. Integração da aceleração vertical → velocidade vertical
  2. Integração da velocidade vertical → deslocamento vertical (Δz)
  3. Aplicação do modelo geométrico do pêndulo invertido
- **Valor Típico**: 0,7 - 0,8 metros
- **Significado Clínico**: Redução indica limitação funcional

#### **Velocidade da Marcha (m/s)**
- **Método**: Relação entre comprimento e tempo do ciclo
- **Fórmula**: `Velocidade = Comprimento do Ciclo / Tempo do Ciclo`
- **Valor Típico**: 1,2 - 1,4 m/s
- **Significado Clínico**: Preditor forte de mortalidade, hospitalização e declínio funcional em idosos

### Parâmetros de Qualidade da Marcha

#### **Jerk Médio (m/s³)**
- **Método**: Taxa de variação da aceleração 3D
- **Fórmula**: `Jerk(t) = dA/dt` onde A é o vetor de aceleração 3D
- **Cálculo**: `|Jerk| = √(Jx² + Jy² + Jz²)`
- **Significado Clínico**: Valores elevados indicam movimentos bruscos e descoordenação. Relacionado à suavidade do movimento

#### **Harmonic Ratio (HR)**
- **Método**: Análise de Fourier do sinal de aceleração vertical (Menz et al., 2003)
- **Fórmula**: `HR = Σ(Amplitudes Pares) / Σ(Amplitudes Ímpares)`
- **Procedimento**:
  1. FFT do sinal de aceleração vertical por ciclo de marcha
  2. Soma das amplitudes das primeiras 20 harmônicas pares
  3. Soma das amplitudes das primeiras 20 harmônicas ímpares
  4. Cálculo da razão
- **Valor Típico**: > 2,0
- **Significado Clínico**: Quantifica a simetria e suavidade da marcha. Valores reduzidos indicam assimetria e instabilidade

#### **Autocorrelação (C1 e C2)**
- **Método**: Análise da periodicidade do sinal de aceleração vertical
- **Fórmula**: `AC(m) = Σ[(x_i - μ)(x_{i+m} - μ)] / [(N-m)σ²]`
  - `m` = lag temporal
  - `μ` = média do sinal
  - `σ²` = variância
- **Parâmetros**:
  - **C1**: Autocorrelação no lag correspondente a 1 passo (meio ciclo)
  - **C2**: Autocorrelação no lag correspondente a 1 passada (ciclo completo)
- **Significado Clínico**: Avalia consistência e regularidade do padrão de marcha

---

## 🔬 Metodologia Técnica

### Pipeline de Processamento

markdown# O Passo Digital - Análise de Marcha Clínica

![Status](https://img.shields.io/badge/status-active-success.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## 📋 Sobre o Projeto

**O Passo Digital** é uma aplicação web avançada para análise biomecânica da marcha humana utilizando os sensores inerciais (acelerômetro e giroscópio) de smartphones. Desenvolvido para uso clínico e de pesquisa, o aplicativo implementa algoritmos estado-da-arte para processamento de sinais e extração de parâmetros quantitativos da marcha.

### ✨ Características Principais

- 📱 **Coleta de dados em tempo real** usando sensores do smartphone
- 🧭 **Estimativa de orientação 3D** com filtro de Madgwick (AHRS)
- 🔍 **Processamento avançado de sinais** com filtros Butterworth
- 📊 **Múltiplos parâmetros biomecânicos** (temporais, espaciais, qualidade)
- 📈 **Visualização interativa** com gráficos de aceleração e trajetória
- 📄 **Exportação completa** em CSV, JSON e PDF com metodologia detalhada

---

## 🚀 Como Usar

### Requisitos
- Smartphone ou tablet com sensores de movimento (acelerômetro e giroscópio)
- Navegador web moderno (Chrome, Safari, Firefox)
- Cinto ou suporte para fixação do dispositivo

### Protocolo de Coleta

1. **Posicionamento (CRÍTICO)**: 
   - Fixe o smartphone firmemente na região lombar, sobre a vértebra L5 (acima dos glúteos)
   - Use um cinto elástico ou suporte apropriado
   - A orientação correta é essencial para a validade dos cálculos

2. **Calibração**:
   - Com o dispositivo já posicionado, permaneça parado em pé por 3 segundos
   - Clique em **"Calibrar Sensores"** e conceda permissão de acesso aos sensores
   - A calibração remove o bias dos sensores

3. **Configuração**:
   - Insira um ID para identificação do participante
   - Digite a altura em centímetros (necessária para cálculos biomecânicos)
   - Selecione a duração da coleta (20, 40 ou 60 segundos)

4. **Coleta de Dados**:
   - Pressione **"Iniciar Coleta"**
   - Caminhe em linha reta em um corredor plano
   - Mantenha velocidade natural e confortável
   - A coleta parará automaticamente

5. **Análise e Exportação**:
   - Os resultados são processados e exibidos automaticamente
   - Visualize gráficos de aceleração e trajetória estimada
   - Exporte os dados brutos ou resultados nos formatos desejados
   - O relatório PDF inclui metodologia completa e referências

---

## 🧮 Parâmetros Calculados

### Parâmetros Temporais

#### **Cadência (passos/min)**
- **Método**: Contagem de passos detectados por unidade de tempo
- **Fórmula**: `Cadência = 120 / Tempo do Ciclo`
- **Valor Típico**: 110 - 120 passos/min
- **Significado Clínico**: Redução associada a declínio funcional, risco de quedas e patologias neurológicas

#### **Tempo do Ciclo de Marcha (s)**
- **Método**: Intervalo entre contatos iniciais consecutivos do mesmo pé (2 passos)
- **Fórmula**: `Tempo do Ciclo = t(IC_i+2) - t(IC_i)`
- **Valor Típico**: 1,0 - 1,2 segundos
- **Significado Clínico**: Aumentado em marcha lenta ou patológica

### Parâmetros de Variabilidade

#### **Coeficiente de Variação do Tempo do Ciclo (CV %)**
- **Método**: Variabilidade temporal entre ciclos consecutivos
- **Fórmula**: `CV = 100 × (σ / μ)` onde σ = desvio padrão e μ = média
- **Valor Típico**: < 3%
- **Significado Clínico**: Valores elevados (>3%) indicam instabilidade, risco de quedas e disfunção neuromotora
- **Referência**: Lord et al. (2013) - biomarcador sensível para Parkinson

### Parâmetros Espaciais

#### **Comprimento do Passo (m)**
- **Método**: Modelo do Pêndulo Invertido (Zijlstra & Hof, 2003)
- **Fórmula**: `S = 2√(2hΔz - Δz²)`
  - `h` = altura do centro de massa (0,53 × altura corporal)
  - `Δz` = deslocamento vertical do tronco obtido por dupla integração da aceleração vertical
- **Procedimento**:
  1. Integração da aceleração vertical → velocidade vertical
  2. Integração da velocidade vertical → deslocamento vertical (Δz)
  3. Aplicação do modelo geométrico do pêndulo invertido
- **Valor Típico**: 0,7 - 0,8 metros
- **Significado Clínico**: Redução indica limitação funcional

#### **Velocidade da Marcha (m/s)**
- **Método**: Relação entre comprimento e tempo do ciclo
- **Fórmula**: `Velocidade = Comprimento do Ciclo / Tempo do Ciclo`
- **Valor Típico**: 1,2 - 1,4 m/s
- **Significado Clínico**: Preditor forte de mortalidade, hospitalização e declínio funcional em idosos

### Parâmetros de Qualidade da Marcha

#### **Jerk Médio (m/s³)**
- **Método**: Taxa de variação da aceleração 3D
- **Fórmula**: `Jerk(t) = dA/dt` onde A é o vetor de aceleração 3D
- **Cálculo**: `|Jerk| = √(Jx² + Jy² + Jz²)`
- **Significado Clínico**: Valores elevados indicam movimentos bruscos e descoordenação. Relacionado à suavidade do movimento

#### **Harmonic Ratio (HR)**
- **Método**: Análise de Fourier do sinal de aceleração vertical (Menz et al., 2003)
- **Fórmula**: `HR = Σ(Amplitudes Pares) / Σ(Amplitudes Ímpares)`
- **Procedimento**:
  1. FFT do sinal de aceleração vertical por ciclo de marcha
  2. Soma das amplitudes das primeiras 20 harmônicas pares
  3. Soma das amplitudes das primeiras 20 harmônicas ímpares
  4. Cálculo da razão
- **Valor Típico**: > 2,0
- **Significado Clínico**: Quantifica a simetria e suavidade da marcha. Valores reduzidos indicam assimetria e instabilidade

#### **Autocorrelação (C1 e C2)**
- **Método**: Análise da periodicidade do sinal de aceleração vertical
- **Fórmula**: `AC(m) = Σ[(x_i - μ)(x_{i+m} - μ)] / [(N-m)σ²]`
  - `m` = lag temporal
  - `μ` = média do sinal
  - `σ²` = variância
- **Parâmetros**:
  - **C1**: Autocorrelação no lag correspondente a 1 passo (meio ciclo)
  - **C2**: Autocorrelação no lag correspondente a 1 passada (ciclo completo)
- **Significado Clínico**: Avalia consistência e regularidade do padrão de marcha

---

## 🔬 Metodologia Técnica

### Pipeline de Processamento
```
Dados Brutos (IMU)
    ↓
Calibração (Remoção de Bias)
    ↓
Filtro de Madgwick AHRS (Estimativa de Orientação)
    ↓
Rotação para Referencial Global
    ↓
Remoção da Gravidade
    ↓
Filtro Butterworth Band-Pass (0.5-3.0 Hz)
    ↓
Detecção de Eventos de Marcha
    ↓
Cálculo de Parâmetros Biomecânicos
    ↓
Análise Frequencial (FFT)
    ↓
Resultados Finais
```

### 1. Estimativa de Orientação - Filtro de Madgwick

O **filtro de Madgwick** é um algoritmo AHRS (Attitude and Heading Reference System) que estima a orientação 3D do dispositivo usando dados de acelerômetro e giroscópio.

**Princípio**:
- Representa orientação como quaternions `q = [q₀, q₁, q₂, q₃]`
- Combina integração do giroscópio com correção do acelerômetro
- Usa gradiente descendente para minimizar erro de orientação

**Parâmetros**:
- Taxa de amostragem: ~50 Hz
- Ganho β: 0.1 (controla convergência vs. estabilidade)

**Aplicação**:
```javascript
// Rotação da aceleração para referencial global
ax_world = Rotação(ax_local, quaternion)
ay_world = Rotação(ay_local, quaternion)
az_world = Rotação(az_local, quaternion) - 9.81  // Remove gravidade
```

### 2. Filtragem Digital - Butterworth Band-Pass

**Especificações do Filtro**:
- Tipo: Butterworth de 2ª ordem
- Banda passante: 0.5 - 3.0 Hz
- Frequência de amostragem: 50 Hz
- Propósito: Isolar componentes da marcha e remover ruídos

**Justificativa das Frequências**:
- Marcha humana típica: 0,8 - 2,0 Hz (48 - 120 passos/min)
- Frequência de corte inferior (0.5 Hz): Remove deriva de baixa frequência
- Frequência de corte superior (3.0 Hz): Remove ruídos de alta frequência

### 3. Detecção de Eventos de Marcha

**Método**: Detecção de picos no sinal filtrado de aceleração vertical

**Critérios**:
- Altura mínima do pico: 0.5 m/s²
- Distância mínima entre picos: 0.3 s (evita falsos positivos)
- Tipo de evento: Initial Contact (IC) - contato inicial do pé com o solo

**Algoritmo**:
```
Para cada ponto i no sinal:
  Se (sinal[i] > sinal[i-1]) E (sinal[i] > sinal[i+1]) E (sinal[i] > threshold):
    Se (distância do último pico > distância_mínima):
      Registra pico como evento IC
```

### 4. Dupla Integração para Trajetória

**Objetivo**: Estimar deslocamento 3D do tronco

**Procedimento**:
1. **Primeira integração**: aceleração → velocidade
   - `v(t) = v(t-1) + a(t)·Δt`
   - Correção de deriva linear aplicada

2. **Segunda integração**: velocidade → posição
   - `s(t) = s(t-1) + v(t)·Δt`
   - Correção de deriva por ciclo de marcha

**Limitações**:
- Erros acumulativos (deriva) em integrações numéricas
- Mitigado por: correções de deriva, filtragem adequada, análise por ciclos curtos

### 5. Transformada Rápida de Fourier (FFT)

**Aplicação**: Análise espectral para Harmonic Ratio

**Procedimento**:
1. Segmentação do sinal por ciclo de marcha
2. Aplicação da FFT: domínio do tempo → domínio da frequência
3. Cálculo da magnitude: `Magnitude(k) = √(Real(k)² + Imag(k)²)`
4. Separação de harmônicas pares e ímpares
5. Cálculo da razão

**Implementação**: Algoritmo Cooley-Tukey (radix-2)

---

## 📚 Fundamentação Científica

### Referências Principais

1. **Del Din, S., et al. (2016)**
   - *"Gait analysis with wearables predicts conversion to Parkinson disease"*
   - IEEE Journal of Biomedical and Health Informatics
   - Valida bateria de parâmetros de marcha em populações neurológicas

2. **Zijlstra, W., & Hof, A. L. (2003)**
   - *"Assessment of spatio-temporal gait parameters from trunk accelerations during human walking"*
   - Gait & Posture, 18(2), 1-10
   - Modelo do pêndulo invertido para estimativa de comprimento do passo

3. **McCamley, J., et al. (2012)**
   - *"An enhanced estimate of initial contact and final contact instants of time using lower trunk inertial sensor data"*
   - Gait & Posture, 36(2), 316-318
   - Métodos robustos para detecção de eventos de marcha

4. **Menz, H. B., et al. (2003)**
   - *"Acceleration patterns of the head and pelvis when walking on level and irregular surfaces"*
   - Gait & Posture, 18(1), 35-46
   - Harmonic Ratio como medida de qualidade da marcha

5. **Lord, S., et al. (2013)**
   - *"Independent domains of gait in older adults and associated motor and nonmotor attributes"*
   - Journals of Gerontology Series A
   - Variabilidade temporal como biomarcador clínico

### Validação Clínica

Os métodos implementados são baseados em protocolos validados cientificamente:
- ✅ Sensibilidade para detectar alterações sutis em Parkinson
- ✅ Correlação com testes clínicos padrão (TUG, 6MWT)
- ✅ Reprodutibilidade teste-reteste comprovada
- ✅ Aplicabilidade em diferentes populações (idosos, neurológicos, saudáveis)

---

## ⚠️ Limitações e Considerações

### Limitações Técnicas

1. **Dependência de Posicionamento**:
   - A precisão é criticamente dependente da fixação correta na região lombar (L5)
   - Deslocamento do dispositivo compromete a validade dos dados

2. **Deriva de Integração**:
   - Dupla integração para trajetória acumula erros
   - Mitigada por análises de curto prazo e correções de deriva

3. **Condições de Teste**:
   - Otimizado para caminhada em linha reta em superfície plana
   - Precisão reduzida em: curvas, rampas, escadas, terrenos irregulares

4. **Características do Sensor**:
   - Variabilidade entre dispositivos
   - Taxa de amostragem não uniforme em alguns smartphones

### Uso Apropriado

✅ **Adequado para**:
- Avaliação quantitativa da marcha em pesquisa
- Monitoramento longitudinal de parâmetros
- Triagem e acompanhamento clínico complementar
- Estudos comparativos (pré/pós intervenção)

❌ **NÃO adequado para**:
- Diagnóstico clínico isolado
- Decisões médicas sem avaliação complementar
- Substituição de análise de marcha laboratorial 3D
- Contextos forenses ou médico-legais

---

## 🛠️ Tecnologias Utilizadas

### Frontend
- **HTML5/CSS3**: Interface responsiva
- **Tailwind CSS**: Estilização moderna
- **JavaScript (ES6+)**: Lógica de aplicação

### Processamento de Sinais
- **Implementações Customizadas**:
  - Filtro de Madgwick (AHRS)
  - Filtro Butterworth Band-Pass
  - FFT (Cooley-Tukey)
  - Autocorrelação

### APIs Web
- **DeviceMotion API**: Acesso a sensores inerciais
- **Canvas API**: Renderização de gráficos

### Bibliotecas
- **Chart.js**: Visualização de dados
- **jsPDF**: Geração de relatórios PDF
- **jsPDF-AutoTable**: Tabelas em PDF

---

## 📊 Formato dos Dados Exportados

### CSV de Dados Brutos
```csv
timestamp,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z,acc_v_raw,acc_v_filt
0.000,0.15,-0.23,9.95,0.02,-0.01,0.00,0.14,0.00
0.020,0.18,-0.25,10.12,0.03,-0.02,0.01,0.31,0.05
...
```

### CSV de Resultados
```csv
categoria,parametro,valor,valor_tipico
Temporais,Cadência (passos/min),115.2,110 - 120
Temporais,Tempo do Ciclo (s),1.04,1,0 - 1,2
...
```

### JSON de Resultados
```json
{
  "Temporais": {
    "Cadência (passos/min)": {
      "value": 115.2,
      "typical": "110 - 120"
    }
  }
}
```

---

## 🔒 Privacidade e Segurança

- ✅ **Processamento local**: Todos os dados são processados no dispositivo
- ✅ **Sem servidor**: Nenhum dado é enviado para servidores externos
- ✅ **Sem armazenamento**: Dados não são salvos automaticamente
- ✅ **Controle total**: Usuário decide quando e o que exportar

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Áreas de interesse:

- 🔬 Validação com sistemas de análise de marcha padrão-ouro
- 📱 Testes em diferentes modelos de smartphones
- 🧪 Expansão para outras condições de marcha
- 🌐 Traduções e internacionalização
- 📊 Novos parâmetros biomecânicos

---

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.

---

## 📧 Contato

Para questões, sugestões ou colaborações:
- Abra uma *issue* no GitHub
- Entre em contato com a equipe de desenvolvimento

---

