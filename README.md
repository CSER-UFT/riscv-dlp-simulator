# Simulador de Paralelismo de Dados RISC-V

**Acesse:** [cser-uft.github.io/riscv-dlp-simulator](https://cser-uft.github.io/riscv-dlp-simulator/)

Simulador didático de arquiteturas que exploram o paralelismo em nível de dados (DLP, *data level parallelism*): processador vetorial, GPU e TPU, desenvolvido para o curso de **Ciência da Computação** da **Universidade Federal do Tocantins**. É o projeto irmão do [Simulador de Processadores RISC-V](https://github.com/CSER-UFT/riscv-cpu-simulator), do qual reaproveita o montador, a interface e as ferramentas para aula.

O simulador roda inteiramente no navegador (HTML e JavaScript, sem dependências nem etapa de compilação) e pode ser publicado diretamente no GitHub Pages. A interface está em português e em inglês, com tema claro e tema escuro.

## Modelos

* **Processador vetorial**: um núcleo escalar em ordem acoplado a uma unidade vetorial com lanes, no estilo do RV64V de Hennessy e Patterson, executando a extensão V do RISC-V (RVV 1.0, com LMUL 1, 2, 4 ou 8).
* **TPU**: um núcleo RISC-V escalar comandando uma unidade de multiplicação de matrizes com array sistólico N × N (pesos parados), Unified Buffer, fila de pesos, acumuladores e ativação, no estilo da TPU v1 do Google.
* **GPU**: um multiprocessador SIMT com grade de blocos e ocupação, warps, escalonador (rodízio ou GTO), scoreboard por warp, divergência com pilha SIMT e reconvergência no pós dominador imediato, barreira, coalescência dos acessos à memória, memória compartilhada com conflitos de banco e cache L1 opcional.

## Processador vetorial

* VLEN, número de lanes, encadeamento (chaining) e elementos por ciclo em acessos com passo ou indexados configuráveis.
* Unidades funcionais vetoriais configuráveis (nome, classes de instrução, com ou sem pipeline) e latências de partida por classe.
* Dependências verificadas bit a bit nos registradores vetoriais (RAW, WAR e WAW), por registrador nos escalares e por endereço na memória; reduções com árvore de soma entre as lanes.
* Diagrama de blocos no estilo das figuras do Patterson e Hennessy: a emissão (e o motivo de cada parada) e a unidade escalar no alto e, em cada lane (de 1 a 8), a fatia do banco de registradores vetoriais e um trecho de cada unidade funcional com os elementos nos estágios, ligadas à memória pela LSU; abaixo, os registradores escalares, a memória e as estatísticas (elementos e operações de ponto flutuante por ciclo, uso das lanes, paradas por motivo).

## Linguagem aceita

* **Escalar**: RV32I e RV64I, extensões M, F e D, pseudoinstruções usuais, rótulos, nomes da ABI, seções `.text` e `.data` e as diretivas de dados. Valores iniciais de registradores escalares em comentários sozinhos na linha: `# a0 = 10`.
* **Vetorial**: `vsetvli` e `vsetivli` (e8, e16, e32 e e64); loads e stores unitários, com passo e indexados; aritmética inteira e de ponto flutuante nas formas `.vv`, `.vx`, `.vf` e `.vi`; multiplicação e soma (`vmacc`, `vfmacc`...); comparações e operações com máscara (`v0.t`); reduções; movimentação entre escalar e vetor; `vmerge`, `vid.v`, `vcpop.m`, `vfirst.m` e pseudoinstruções como `vneg.v` e `vmnot.m`.

Simplificações: LMUL inteiro (sem frações), com a largura dos acessos à memória igual ao SEW; cauda e elementos inativos sempre preservados; memória com latência fixa.

## TPU

* Instruções `tpu.rdhost`, `tpu.rdw`, `tpu.matmul`, `tpu.matmul.acc`, `tpu.act` e `tpu.wrhost`, emitidas pelo núcleo escalar.
* Dimensão do array, linhas do Unified Buffer e dos acumuladores, tamanho da fila de pesos, latências e tipo de dado (int32 ou int8 com requantização por deslocamento e saturação, como na TPU v1) configuráveis.
* Array sistólico com entradas defasadas e somas parciais descendo pelas colunas (latência 2N menos 1), buffer duplo de pesos e dependências verificadas linha a linha, o que permite sobrepor multiplicação, ativação e a camada seguinte.
* Diagrama de blocos no estilo da TPU v1: memória externa, DMA e WDMA, Unified Buffer, preparação dos dados com as entradas defasadas, fila de pesos sobre o array sistólico com o peso, a entrada e a soma parcial de cada elemento (a frente diagonal de cálculo fica visível), acumuladores e ativação devolvendo os resultados ao Unified Buffer; estatísticas de MAC por ciclo e uso do array.

## GPU

* Kernel em RISC-V com `gpu.tid`, `gpu.ntid`, `gpu.bid`, `gpu.nbid`, `gpu.btid`, `gpu.bdim`, `gpu.wid`, `gpu.lane` e `gpu.bar`; cada thread com os seus registradores.
* Grade de blocos com até 1024 threads; o SM recebe quantos blocos couberem no limite de warps residentes e na memória compartilhada.
* Memória compartilhada por bloco (seção `.shared`) dividida em bancos de 4 bytes, com serialização dos conflitos; cache L1 associativa por conjunto, com LRU, que só afeta o tempo.
* Número de blocos e de warps, threads por warp, vias por unidade, escalonador, latência da memória, tamanho das transações, warps residentes, memória compartilhada, bancos e L1 configuráveis.
* Diagrama de blocos no estilo do processador SIMD multithreaded do Patterson e Hennessy: o escalonador de warps com o placar (PC, próxima instrução, máscara de threads ativas, situação e pilha SIMT), o registrador de instrução, as lanes SIMD (de 1 a 16) com os registradores das threads e as unidades ALU e FPU, mostrando as lanes desligadas pela máscara, a unidade de load e store com os endereços do último acesso coloridos pela linha ou pelo banco, a rede de interconexão e as memórias compartilhada e global; abaixo, os registradores de todas as threads. Estatísticas de eficiência SIMD, transações por acesso e ciclos sem emissão.

Exemplos da GPU: SAXPY (ocultação de latência com mais warps), divergência, coalescência, redução em árvore na memória compartilhada com barreira e conflitos de banco.

Exemplos da TPU: C = ReLU(A × B), lote de 12 linhas, lote pequeno limitado pelos pesos, K maior que o array (acumulação), rede de duas camadas, camada int8 quantizada e convolução 2D por im2col.

## Recursos para aula

* **Passo a passo** com uma explicação de cada acontecimento e **linha do tempo** por instrução.
* **Exercício**: o aluno preenche os ciclos dos eventos de cada instrução e responde perguntas próprias do modelo (transações, conflitos de banco, máscaras e reconvergência na GPU; MACs e ciclos dos pesos na TPU; vl e grupos nas lanes no processador vetorial), e o simulador corrige.
* **Comparar modelos**: SAXPY e GEMM 8 × 8 escritas para o processador vetorial, a GPU (com e sem memória compartilhada) e a TPU, com ciclos, tempo, operações úteis por ciclo e eficiência lado a lado.
* **Comparar**: o mesmo programa com outra configuração (por exemplo, sem encadeamento ou com mais lanes), com speedup, estatísticas e linhas do tempo lado a lado.
* **Exportar** linha do tempo e tabela de eventos em CSV e em LaTeX (cabeçalho com fundo `tabAzul` e texto branco, `\hline`, sem booktabs), e o estado do ciclo atual em LaTeX com figuras TikZ: lanes e estágios das unidades vetoriais, array sistólico da TPU, warps com a pilha SIMT e coalescência ou bancos da GPU; e a figura do ciclo atual em SVG (o diagrama de blocos do processador vetorial, da GPU ou da TPU, com as cores do tema claro).
* **Copiar link** que abre a mesma simulação, comparação ou exercício.

Exemplos prontos: SAXPY com strip mining, com LMUL = 4 e a versão escalar, encadeamento, lanes, produto escalar com redução, máscara, acesso com passo, acesso indexado e matriz vezes vetor.

## Como utilizar

Clique em **Nova simulação**, escolha um exemplo ou escreva o programa, ajuste a configuração e clique em **Executar** (ou `Ctrl` + `Enter`). O botão **Ajuda** abre o manual completo.

* `Seta direita` e `Seta esquerda`: avança ou volta um passo; com `Ctrl`, um ciclo.
* `Home` e `End`: início e fim da execução.
* Arrastar, roda do mouse e duplo clique: mover, ampliar e restaurar o diagrama.

## Estrutura do código

```
js/riscv/isa.js          tabela declarativa das instruções escalares
js/riscv/vector.js       instruções vetoriais e executor funcional (acessos por elemento)
js/riscv/tpu.js          instruções da TPU e executor funcional (acessos por linha)
js/riscv/gpu.js          instruções da GPU, pós dominadores e referência (threads em sequência)
js/riscv/parser.js       montador: rótulos, pseudoinstruções, diretivas, sintaxe vetorial, erros por linha
js/riscv/machine.js      estado inicial e simulador funcional de referência
js/models/host.js        núcleo escalar comum aos modelos
js/models/vector.js      modelo temporal do processador vetorial
js/models/tpu.js         modelo temporal da TPU
js/models/gpu.js         modelo temporal da GPU (SIMT)
js/core/config.js        configuração padrão e validação
js/core/recorder.js      passos, linha do tempo e instantâneos com compartilhamento estrutural
js/i18n/                 textos da interface em português e inglês
js/help/                 ajuda em português e inglês
js/ui/                   interface: diagrama, linha do tempo, editor, exercício, comparação, exportação
js/examples.js           programas de exemplo
test/                    testes automatizados (node --test)
```

## Testes

Requer Node.js 20 ou mais recente, sem dependências.

```
npm test
```

A suíte verifica o montador, a semântica das instruções escalares e vetoriais, os dicionários de tradução, a ajuda, os exemplos e o comportamento temporal em programas com ciclos calculados à mão (encadeamento, conflitos estruturais, unidades sem pipeline, acessos com passo, reduções, WAR, WAW, dependência pela memória e desvios). Os testes principais geram programas aleatórios (escalares e vetoriais, escalares e da TPU, ou kernels de GPU sem condição de corrida, com divergência, laços, barreiras e threads que terminam cedo) e, em várias configurações de hardware, compara o estado final com o do simulador funcional de referência e confere de forma independente, bit a bit, linha a linha e endereço a endereço, as regras de tempo de cada instrução. A quantidade de programas aleatórios pode ser alterada com a variável `RANDOM_PROGRAMS`.

## Execução local

Como o código usa módulos ES, abra o simulador por um servidor HTTP, por exemplo:

```
python3 -m http.server 8000
```

e acesse `http://localhost:8000`.
