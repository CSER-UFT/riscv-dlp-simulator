# Simulador de Paralelismo de Dados RISC-V

**Acesse:** [cser-uft.github.io/riscv-dlp-simulator](https://cser-uft.github.io/riscv-dlp-simulator/)

Simulador didático de arquiteturas que exploram o paralelismo em nível de dados (DLP, *data level parallelism*), desenvolvido para o curso de **Ciência da Computação** da **Universidade Federal do Tocantins**. É o projeto irmão do [Simulador de Processadores RISC-V](https://github.com/CSER-UFT/riscv-simulator), do qual reaproveita o montador, a interface e as ferramentas para aula.

O simulador roda inteiramente no navegador (HTML e JavaScript, sem dependências nem etapa de compilação) e pode ser publicado diretamente no GitHub Pages. A interface está em português e em inglês, com tema claro e tema escuro.

## Modelos

* **Processador vetorial**: um núcleo escalar em ordem acoplado a uma unidade vetorial com lanes, no estilo do RV64V de Hennessy e Patterson, executando a extensão V do RISC-V (RVV 1.0, LMUL = 1).
* **GPU** (SIMT, com warps, divergência e escalonamento) e **TPU** (array sistólico): planejados.

## Processador vetorial

* VLEN, número de lanes, encadeamento (chaining) e elementos por ciclo em acessos com passo ou indexados configuráveis.
* Unidades funcionais vetoriais configuráveis (nome, classes de instrução, com ou sem pipeline) e latências de partida por classe.
* Dependências verificadas bit a bit nos registradores vetoriais (RAW, WAR e WAW), por registrador nos escalares e por endereço na memória; reduções com árvore de soma entre as lanes.
* Diagrama com a emissão (e o motivo de cada parada), a unidade escalar, a grade lanes × estágios de cada unidade funcional, os registradores vetoriais com a lane de cada elemento, os registradores escalares, a memória e as estatísticas (elementos e operações de ponto flutuante por ciclo, uso das lanes, paradas por motivo).

## Linguagem aceita

* **Escalar**: RV32I e RV64I, extensões M, F e D, pseudoinstruções usuais, rótulos, nomes da ABI, seções `.text` e `.data` e as diretivas de dados. Valores iniciais de registradores escalares em comentários sozinhos na linha: `# a0 = 10`.
* **Vetorial**: `vsetvli` e `vsetivli` (e8, e16, e32 e e64); loads e stores unitários, com passo e indexados; aritmética inteira e de ponto flutuante nas formas `.vv`, `.vx`, `.vf` e `.vi`; multiplicação e soma (`vmacc`, `vfmacc`...); comparações e operações com máscara (`v0.t`); reduções; movimentação entre escalar e vetor; `vmerge`, `vid.v`, `vcpop.m`, `vfirst.m` e pseudoinstruções como `vneg.v` e `vmnot.m`.

Simplificações: apenas LMUL = 1, com a largura dos acessos à memória igual ao SEW; cauda e elementos inativos sempre preservados; memória com latência fixa.

## Recursos para aula

* **Passo a passo** com uma explicação de cada acontecimento e **linha do tempo** por instrução.
* **Exercício**: o aluno preenche o ciclo de emissão, do primeiro resultado e de conclusão de cada instrução vetorial, e o simulador corrige.
* **Comparar**: o mesmo programa com outra configuração (por exemplo, sem encadeamento ou com mais lanes), com speedup, estatísticas e linhas do tempo lado a lado.
* **Exportar** linha do tempo e tabela de eventos em CSV e em LaTeX (cabeçalho com fundo `tabAzul` e texto branco, `\hline`, sem booktabs).
* **Copiar link** que abre a mesma simulação, comparação ou exercício.

Exemplos prontos: SAXPY com strip mining e a versão escalar, encadeamento, lanes, produto escalar com redução, máscara, acesso com passo, acesso indexado e matriz vezes vetor.

## Como utilizar

Clique em **Nova simulação**, escolha um exemplo ou escreva o programa, ajuste a configuração e clique em **Executar** (ou `Ctrl` + `Enter`). O botão **Ajuda** abre o manual completo.

* `Seta direita` e `Seta esquerda`: avança ou volta um passo; com `Ctrl`, um ciclo.
* `Home` e `End`: início e fim da execução.
* Arrastar, roda do mouse e duplo clique: mover, ampliar e restaurar o diagrama.

## Estrutura do código

```
js/riscv/isa.js          tabela declarativa das instruções escalares
js/riscv/vector.js       instruções vetoriais e executor funcional (acessos por elemento)
js/riscv/parser.js       montador: rótulos, pseudoinstruções, diretivas, sintaxe vetorial, erros por linha
js/riscv/machine.js      estado inicial e simulador funcional de referência
js/models/vector.js      modelo temporal do processador vetorial
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

A suíte verifica o montador, a semântica das instruções escalares e vetoriais, os dicionários de tradução, a ajuda, os exemplos e o comportamento temporal em programas com ciclos calculados à mão (encadeamento, conflitos estruturais, unidades sem pipeline, acessos com passo, reduções, WAR, WAW, dependência pela memória e desvios). O teste principal gera programas aleatórios com instruções escalares e vetoriais e, em dez configurações de hardware, compara o estado final com o do simulador funcional de referência e confere de forma independente, bit a bit e endereço a endereço, as regras de tempo de cada instrução. A quantidade de programas aleatórios pode ser alterada com a variável `RANDOM_PROGRAMS`.

## Execução local

Como o código usa módulos ES, abra o simulador por um servidor HTTP, por exemplo:

```
python3 -m http.server 8000
```

e acesse `http://localhost:8000`.
