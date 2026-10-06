/**
 * Ajuda do simulador, em português. Cada seção vira um item do índice.
 * O texto evita hífens e travessões por padrão de estilo do projeto.
 */
export default {
    title: 'Simulador de Paralelismo de Dados RISC-V',
    lead: 'Simulador didático de arquiteturas que exploram o paralelismo em nível de dados, começando pelo processador vetorial da extensão V do RISC-V. Desenvolvido para o curso de <strong>Ciência da Computação</strong> da <strong>Universidade Federal do Tocantins</strong>.',
    searchPlaceholder: 'Buscar na ajuda',
    noResults: 'Nenhuma seção contém esse termo.',
    tocTitle: 'Conteúdo',
    close: 'Fechar ajuda',
    sections: [
        {
            id: 'start',
            title: 'Primeiros passos',
            html: `
<p>O simulador executa um programa em assembly RISC-V, com instruções escalares e vetoriais, e mostra ciclo a ciclo o que acontece dentro do processador. Tudo roda no navegador: nada é enviado a um servidor.</p>
<ol>
    <li>Clique em <strong>Nova simulação</strong>.</li>
    <li>Escolha um <strong>exemplo</strong> na lista ou escreva o seu programa. Os erros aparecem abaixo do editor, com o número da linha; clique em um erro para ir até ela.</li>
    <li>À direita, ajuste a configuração se quiser: VLEN, número de lanes, encadeamento, unidades funcionais e latências.</li>
    <li>Clique em <strong>Executar</strong> (ou <kbd>Ctrl</kbd> + <kbd>Enter</kbd>). A simulação abre em uma aba nova.</li>
    <li>Avance com a <kbd>seta para a direita</kbd>. Cada passo traz uma frase explicando o que aconteceu, e o diagrama destaca a parte envolvida.</li>
</ol>
<p class="tip">Sugestão para começar: o exemplo <em>SAXPY com strip mining</em>, depois o <em>SAXPY escalar</em> para comparar o número de ciclos. Em seguida, o exemplo <em>Encadeamento</em> com o botão <strong>Comparar</strong>, desligando o encadeamento na configuração B.</p>
<p>Várias simulações podem ficar abertas ao mesmo tempo, cada uma em sua aba. O último programa e a última configuração usados ficam guardados no navegador e reaparecem na próxima visita.</p>`,
        },
        {
            id: 'screen',
            title: 'A tela',
            html: `
<dl>
    <dt>Cabeçalho</dt>
    <dd><strong>Nova simulação</strong> abre o editor. Com uma simulação aberta aparecem <strong>Editar</strong>, <strong>Comparar</strong>, <strong>Exercício</strong>, <strong>Exportar</strong> e <strong>Copiar link</strong>, descritos em <a href="#h-classroom">Recursos para aula</a>. À direita ficam o idioma, o botão de contraste (tema claro ou escuro) e esta ajuda.</dd>
    <dt>Abas</dt>
    <dd>Cada simulação, exercício ou comparação abre em uma aba. O nome indica o exemplo (ou a primeira instrução), o modelo e o número de lanes. Feche com o <strong>×</strong>.</dd>
    <dt>Diagrama</dt>
    <dd>Ocupa a área central. Arraste para mover, use a roda do mouse para ampliar e dê um duplo clique para voltar à posição inicial. O painel relacionado ao passo atual recebe uma borda amarela.</dd>
    <dt>Barra de controle</dt>
    <dd>No canto inferior esquerdo. Mostra o ciclo atual e o total (por exemplo <code>7 / 42</code>) e, ao lado, a explicação do passo: registradores e unidades em <strong>negrito</strong>, valores em <em>itálico</em> e instruções em fonte monoespaçada.</dd>
    <dt>Linha do tempo</dt>
    <dd>Na parte de baixo. Uma linha por instrução executada e uma coluna por ciclo: <code>Emite</code> no ciclo em que a instrução começa, <code>Exec</code> enquanto os elementos ainda estão entrando na unidade, <code>Lat</code> enquanto os últimos elementos atravessam o pipeline e <code>Parada</code> enquanto a instrução espera para ser emitida. As células só aparecem quando o passo correspondente é alcançado.</dd>
</dl>`,
        },
        {
            id: 'controls',
            title: 'Navegação e atalhos',
            html: `
<p>Cada ciclo é dividido em <strong>passos</strong>, um para cada acontecimento relevante (uma emissão, uma parada, a escrita de um grupo de elementos). Avançar um passo mostra o próximo acontecimento; avançar um ciclo pula para o fim do ciclo seguinte.</p>
<table>
    <tr><th>Ação</th><th>Teclado</th><th>Botão</th></tr>
    <tr><td>Avançar um passo</td><td><kbd>→</kbd></td><td>botão logo à direita do contador</td></tr>
    <tr><td>Voltar um passo</td><td><kbd>←</kbd></td><td>botão logo à esquerda do contador</td></tr>
    <tr><td>Avançar um ciclo</td><td><kbd>Ctrl</kbd> + <kbd>→</kbd></td><td>o mesmo botão, com <kbd>Ctrl</kbd></td></tr>
    <tr><td>Voltar um ciclo</td><td><kbd>Ctrl</kbd> + <kbd>←</kbd></td><td>o mesmo botão, com <kbd>Ctrl</kbd></td></tr>
    <tr><td>Ir para o início</td><td><kbd>Home</kbd></td><td>primeiro botão</td></tr>
    <tr><td>Ir para o fim</td><td><kbd>End</kbd></td><td>último botão</td></tr>
    <tr><td>Executar (no editor)</td><td><kbd>Ctrl</kbd> + <kbd>Enter</kbd></td><td>Executar</td></tr>
    <tr><td>Inserir recuo (no editor)</td><td><kbd>Tab</kbd></td><td></td></tr>
    <tr><td>Fechar o editor ou a ajuda</td><td><kbd>Esc</kbd></td><td>×</td></tr>
</table>
<p>Os atalhos de navegação não funcionam enquanto o editor está aberto ou quando o cursor está em um campo de texto.</p>`,
        },
        {
            id: 'dlp',
            title: 'Paralelismo em nível de dados',
            html: `
<p>Muitos programas aplicam a mesma operação a muitos dados: somar dois vetores, multiplicar matrizes, filtrar uma imagem. Esse é o <strong>paralelismo em nível de dados</strong> (DLP, <em>data level parallelism</em>). Em vez de buscar e decodificar uma instrução para cada elemento, a arquitetura usa uma instrução para muitos elementos, o que economiza energia e banda de instruções.</p>
<p>Hennessy e Patterson apresentam três famílias de arquiteturas para isso:</p>
<dl>
    <dt>Processadores vetoriais</dt>
    <dd>Registradores longos, com muitos elementos, e unidades funcionais com pipeline profundo que processam alguns elementos por ciclo (as <em>lanes</em>). O comprimento do vetor é definido pelo programa em tempo de execução (<code>vl</code>). É o modelo deste simulador, com a extensão V do RISC-V.</dd>
    <dt>Extensões SIMD</dt>
    <dd>Registradores de largura fixa (128, 256, 512 bits) em processadores comuns, como SSE e AVX. O número de elementos faz parte do código da instrução, o que obriga a reescrever o programa a cada nova largura.</dd>
    <dt>GPUs</dt>
    <dd>Milhares de threads executadas em grupos (warps) que compartilham a mesma instrução (SIMT), com troca rápida entre grupos para esconder a latência da memória.</dd>
</dl>
<p>As <strong>arquiteturas de domínio específico</strong>, como a TPU do Google, levam a ideia mais longe: um array sistólico de multiplicadores dedicado à multiplicação de matrizes.</p>
<p class="tip">Os modelos de GPU e de TPU estão planejados para versões futuras deste simulador; por enquanto, só o processador vetorial está disponível.</p>`,
        },
        {
            id: 'rvv',
            title: 'A extensão V em resumo',
            html: `
<p>A extensão V acrescenta 32 registradores vetoriais, <code>v0</code> a <code>v31</code>, cada um com <strong>VLEN</strong> bits. Um registrador guarda vários elementos de <strong>SEW</strong> bits (8, 16, 32 ou 64), escolhidos pelo programa.</p>
<table>
    <tr><th>Termo</th><th>Significado</th></tr>
    <tr><td><strong>VLEN</strong></td><td>tamanho de cada registrador vetorial, definido pelo hardware (configuração do simulador)</td></tr>
    <tr><td><strong>SEW</strong></td><td>largura de cada elemento, escolhida por <code>vsetvli</code> (<code>e8</code>, <code>e16</code>, <code>e32</code> ou <code>e64</code>)</td></tr>
    <tr><td><strong>VLMAX</strong></td><td>quantos elementos cabem em um registrador: VLEN ÷ SEW (com LMUL = 1)</td></tr>
    <tr><td><strong>vl</strong></td><td>quantos elementos as próximas instruções processam (de 0 a VLMAX)</td></tr>
    <tr><td><strong>vtype</strong></td><td>o tipo vetorial atual: SEW, LMUL e as políticas de cauda e máscara</td></tr>
</table>
<h3>vsetvli e strip mining</h3>
<p><code>vsetvli rd, rs1, e32, m1, ta, ma</code> pede para processar <code>rs1</code> elementos de 32 bits; o hardware responde em <code>rd</code> quantos vai processar agora: vl = min(rs1, VLMAX). O programa processa esse bloco, avança os ponteiros e repete até acabar. Esse laço é o <strong>strip mining</strong>, e o mesmo código funciona com qualquer VLEN: com VLEN maior, o laço só dá menos voltas. Veja o exemplo <em>SAXPY com strip mining</em>.</p>
<p><code>vsetivli</code> faz o mesmo com um número constante (de 0 a 31). Com <code>rs1 = zero</code> e <code>rd</code> diferente de zero, <code>vsetvli</code> escolhe vl = VLMAX.</p>
<h3>Máscaras</h3>
<p>Uma comparação vetorial (<code>vmslt</code>, <code>vmfeq</code>...) produz uma <strong>máscara</strong>: um bit por elemento. A maior parte das instruções aceita o sufixo <code>v0.t</code>, que restringe a operação aos elementos cujo bit em <code>v0</code> vale 1; os demais ficam inalterados. É assim que um <code>if</code> dentro de um laço vira código vetorial (exemplo <em>Máscara: ReLU condicional</em>).</p>
<h3>Cauda</h3>
<p>Os elementos de índice maior ou igual a vl formam a <strong>cauda</strong> e não são alterados. As políticas <code>ta</code>/<code>tu</code> e <code>ma</code>/<code>mu</code> são aceitas, mas o simulador sempre preserva cauda e elementos inativos, o que a especificação permite também nas políticas <em>agnostic</em>.</p>
<h3>Acessos à memória</h3>
<ul>
    <li><strong>Unitários</strong> (<code>vle32.v</code>, <code>vse32.v</code>): elementos consecutivos.</li>
    <li><strong>Com passo</strong> (<code>vlse32.v vd, (rs1), rs2</code>): elementos separados por <code>rs2</code> bytes, por exemplo uma coluna de uma matriz guardada por linhas.</li>
    <li><strong>Indexados</strong> (<code>vluxei32.v vd, (rs1), vs2</code>), também chamados <em>gather</em> e <em>scatter</em>: o elemento i está em rs1 + vs2[i] (deslocamento em bytes).</li>
</ul>
<h3>Reduções</h3>
<p><code>vredsum.vs vd, vs2, vs1</code> soma vs1[0] e todos os elementos ativos de vs2 e escreve o resultado em vd[0]. <code>vmv.x.s</code> e <code>vfmv.f.s</code> copiam o elemento 0 para um registrador escalar.</p>`,
        },
        {
            id: 'vector',
            title: 'O processador vetorial',
            html: `
<p>O modelo segue o RV64V de Hennessy e Patterson: um <strong>núcleo escalar</strong> simples, em ordem, que busca e emite todas as instruções, e uma <strong>unidade vetorial</strong> com várias unidades funcionais, cada uma com pipeline e com o mesmo número de <strong>lanes</strong>.</p>
<h3>O diagrama</h3>
<dl>
    <dt>Cabeçalho</dt>
    <dd>O PC, o estado vetorial atual (vl, SEW e VLMAX) e a configuração principal: VLEN, lanes e encadeamento.</dd>
    <dt>Emissão</dt>
    <dd>A instrução que está sendo emitida, ou a que está parada e o motivo (RAW, WAR, WAW, unidade ocupada, registrador escalar ou memória), com o ciclo em que poderá começar. Abaixo, as próximas instruções na ordem do programa. Depois de um desvio tomado aparece uma <em>bolha</em>.</dd>
    <dt>Unidade escalar</dt>
    <dd>As instruções escalares em andamento e o ciclo em que o resultado fica pronto.</dd>
    <dt>Unidades funcionais vetoriais</dt>
    <dd>Uma por unidade configurada (por padrão LSU para loads e stores, ALU para operações inteiras e soma de ponto flutuante, MUL para multiplicações e DIV para divisões). A grade tem uma linha por lane e uma coluna por estágio do pipeline; cada célula mostra o índice do elemento que está naquele estágio, na cor da instrução. A lista abaixo da grade mostra quais elementos estão entrando e quando a instrução termina.</dd>
    <dt>Registradores vetoriais</dt>
    <dd>Os registradores usados pelo programa, um elemento por coluna. A faixa colorida no alto de cada elemento indica a lane que o processa: o elemento i fica na lane i mod lanes, e cada lane tem a sua fatia do banco de registradores. A cauda (índices a partir de vl) aparece esmaecida, e os elementos escritos no passo atual ficam destacados. Registradores escritos por comparações aparecem como máscara, um bit por elemento.</dd>
    <dt>Registradores escalares, memória e estatísticas</dt>
    <dd>Os registradores <code>x</code> e <code>f</code> usados, as palavras de memória (com rótulos) e as estatísticas da execução completa.</dd>
</dl>
<h3>Por que lanes?</h3>
<p>Uma unidade com 4 lanes tem 4 cópias do circuito (por exemplo, 4 somadores com pipeline) e processa 4 elementos por ciclo. Uma instrução com vl elementos ocupa a unidade por vl ÷ lanes ciclos, arredondado para cima. Como cada lane só acessa a sua fatia dos registradores, acrescentar lanes não exige um banco de registradores com muitas portas. O exemplo <em>Lanes</em> soma 32 elementos: com a configuração padrão, leva 109 ciclos com 1 lane, 61 com 2, 37 com 4 e 29 com 8; o ganho diminui porque a latência de partida e as instruções escalares não mudam.</p>`,
        },
        {
            id: 'timing',
            title: 'Convenções de temporização',
            html: `
<ol>
    <li><strong>Emissão em ordem.</strong> Uma instrução por ciclo, na ordem do programa. Se a instrução não puder começar, ela fica parada na emissão e as seguintes esperam, mesmo as independentes.</li>
    <li><strong>Entrada dos elementos.</strong> Uma instrução vetorial que começa no ciclo c ocupa uma unidade que execute a sua classe. No ciclo c entram os elementos 0 a lanes menos 1, no ciclo c + 1 os seguintes, e assim por diante. Acessos com passo ou indexados entregam menos elementos por ciclo (configurável), porque cada elemento está em um endereço diferente.</li>
    <li><strong>Latência de partida.</strong> Cada elemento leva L ciclos (a latência da classe, igual à profundidade do pipeline) da entrada até o resultado: um elemento que entra no ciclo k é escrito no fim do ciclo k + L menos 1.</li>
    <li><strong>Encadeamento (chaining).</strong> Ligado, um elemento escrito no fim do ciclo k pode ser lido no ciclo k + 1 pela instrução seguinte, que começa assim que os primeiros elementos de que precisa estão prontos. Desligado, a instrução dependente só começa depois que a produtora escreve o último elemento.</li>
    <li><strong>Dependências.</strong> Verificadas por byte nos registradores vetoriais: RAW (ler antes da escrita), WAR (escrever antes que uma instrução anterior termine de ler) e WAW (escrever antes de uma escrita anterior). Nos registradores escalares, por registrador; na memória, por endereço.</li>
    <li><strong>Unidades.</strong> Com pipeline, uma unidade aceita a próxima instrução no ciclo seguinte à entrada dos últimos elementos da anterior. Sem pipeline, só depois que a anterior termina.</li>
    <li><strong>Reduções.</strong> O resultado é um único elemento, escrito no fim: depois que o último grupo atravessa o pipeline, uma árvore soma os resultados das lanes, o que leva log2 das lanes ativas em ciclos.</li>
    <li><strong>Escalares.</strong> Uma instrução escalar com latência L que começa no ciclo c tem o resultado pronto no fim do ciclo c + L menos 1. Desvios e <code>vsetvli</code> usam a latência da ALU. Um desvio tomado faz a busca perder o número de ciclos configurado.</li>
    <li><strong>Fim.</strong> <code>ecall</code> (ou o fim do código) encerra a emissão, e a execução termina quando as instruções em andamento terminam.</li>
</ol>
<h3>Exemplo</h3>
<p>No exemplo <em>Encadeamento</em> (32 elementos de 8 bits, 4 lanes, configuração padrão), cada instrução leva 8 ciclos para entrar na unidade. Com encadeamento, <code>vmul.vv</code> começa no ciclo seguinte à escrita dos primeiros elementos de <code>v2</code>, e o programa termina em 42 ciclos; sem encadeamento, cada instrução espera a anterior terminar, e o programa leva 63 ciclos.</p>`,
        },
        {
            id: 'chaining',
            title: 'Comboios e chimes',
            html: `
<p>Hennessy e Patterson estimam o tempo de um laço vetorial com dois conceitos:</p>
<dl>
    <dt>Comboio (convoy)</dt>
    <dd>Um grupo de instruções vetoriais que podem executar juntas: sem conflito estrutural entre elas e, com encadeamento, mesmo que dependam umas das outras.</dd>
    <dt>Chime</dt>
    <dd>O tempo para executar um comboio, aproximadamente vl ÷ lanes ciclos. Um laço com m comboios leva cerca de m chimes por bloco de elementos, ignorando a latência de partida.</dd>
</dl>
<p>No simulador, os comboios aparecem na linha do tempo: as instruções de um mesmo comboio têm as faixas <code>Exec</code> sobrepostas. No exemplo <em>Encadeamento</em>, a carga de <code>v1</code> e a de <code>v2</code> ficam em comboios diferentes, porque há uma única unidade de load e store; já <code>vmul.vv</code>, <code>vadd.vv</code> e o store se sobrepõem graças ao encadeamento.</p>
<p>Para observar a latência de partida, compare uma execução com vl pequeno (o tempo é dominado pela latência) e outra com vl grande (dominado por vl ÷ lanes).</p>`,
        },
        {
            id: 'config',
            title: 'Configuração',
            html: `
<dl>
    <dt>Modelo</dt>
    <dd>Por enquanto, o processador vetorial.</dd>
    <dt>XLEN</dt>
    <dd>32 ou 64 bits, a largura dos registradores escalares. Instruções exclusivas do RV64 (<code>ld</code>, <code>addw</code>...) exigem XLEN = 64.</dd>
    <dt>VLEN</dt>
    <dd>Tamanho de cada registrador vetorial, de 64 a 1024 bits. Define o VLMAX: com VLEN = 256, cabem 8 elementos de 32 bits ou 32 elementos de 8 bits.</dd>
    <dt>Lanes</dt>
    <dd>Elementos que cada unidade vetorial processa por ciclo.</dd>
    <dt>Encadeamento</dt>
    <dd>Permite que uma instrução comece a ler os elementos produzidos pela anterior assim que são escritos. Veja <a href="#h-timing">Convenções de temporização</a>.</dd>
    <dt>Elementos por ciclo com passo ou indexados</dt>
    <dd>Quantos elementos um acesso com passo ou indexado entrega por ciclo (limitado ao número de lanes). O padrão é 1.</dd>
    <dt>Bolhas por desvio tomado</dt>
    <dd>Ciclos sem emissão depois de um desvio ou salto tomado.</dd>
    <dt>Unidades funcionais vetoriais</dt>
    <dd>Nome, classes de instrução que a unidade executa e se tem pipeline. Uma classe pode estar em mais de uma unidade; a instrução usa a que ficar livre primeiro. Todas as classes usadas pelo programa precisam de alguma unidade.</dd>
    <dt>Latências vetoriais</dt>
    <dd>A latência de partida de cada classe: load, store, inteiro, multiplicação, divisão, e as operações de ponto flutuante (soma e comparação, multiplicação e <code>vfmacc</code>, divisão e raiz).</dd>
    <dt>Latências escalares</dt>
    <dd>Ciclos de cada classe escalar. Desvios, saltos e <code>vsetvli</code> usam a latência da ALU.</dd>
    <dt>Frequência</dt>
    <dd>Usada para o tempo de execução: tempo = ciclos ÷ frequência.</dd>
    <dt>Limite de ciclos</dt>
    <dd>Interrompe programas com laço infinito.</dd>
    <dt>Valores de exemplo</dt>
    <dd>Registradores lidos pelo programa, nunca escritos por ele, que não são endereço base nem passo e não têm valor inicial recebem valores de exemplo determinísticos.</dd>
</dl>`,
        },
        {
            id: 'language',
            title: 'Linguagem aceita',
            html: `
<h3>Escalar</h3>
<p>RV32I e RV64I, extensões M, F e D, as pseudoinstruções usuais (<code>li</code>, <code>la</code>, <code>mv</code>, <code>j</code>, <code>beqz</code>, <code>bnez</code>, <code>ret</code>...), rótulos, nomes de registradores da ABI, as seções <code>.text</code> e <code>.data</code> e as diretivas <code>.byte</code>, <code>.half</code>, <code>.word</code>, <code>.dword</code>, <code>.float</code>, <code>.double</code>, <code>.space</code>, <code>.align</code>, <code>.string</code> e <code>.equ</code>. O código começa em <code>0x0</code> e os dados em <code>0x10000</code>.</p>
<p>Valores iniciais de registradores escalares podem ser dados em comentários sozinhos na linha: <code># a0 = 10</code>, <code># fa0 = 2.5</code>. Registradores vetoriais recebem dados com <code>.data</code> e loads.</p>
<h3>Vetorial (LMUL = 1)</h3>
<table>
    <tr><th>Grupo</th><th>Instruções</th></tr>
    <tr><td>Configuração</td><td><code>vsetvli</code>, <code>vsetivli</code></td></tr>
    <tr><td>Loads e stores</td><td><code>vle8/16/32/64.v</code>, <code>vse..</code>, com passo <code>vlse..</code>, <code>vsse..</code>, indexados <code>vluxei..</code>, <code>vloxei..</code>, <code>vsuxei..</code>, <code>vsoxei..</code></td></tr>
    <tr><td>Inteiros (.vv, .vx, .vi)</td><td><code>vadd</code>, <code>vsub</code>, <code>vrsub</code>, <code>vand</code>, <code>vor</code>, <code>vxor</code>, <code>vsll</code>, <code>vsrl</code>, <code>vsra</code>, <code>vmin</code>, <code>vmax</code>, <code>vminu</code>, <code>vmaxu</code>, <code>vmul</code>, <code>vmulh</code>, <code>vmulhu</code>, <code>vdiv</code>, <code>vdivu</code>, <code>vrem</code>, <code>vremu</code>, <code>vmacc</code>, <code>vnmsac</code>, <code>vmadd</code>, <code>vnmsub</code></td></tr>
    <tr><td>Comparações (máscara)</td><td><code>vmseq</code>, <code>vmsne</code>, <code>vmslt</code>, <code>vmsltu</code>, <code>vmsle</code>, <code>vmsleu</code>, <code>vmsgt</code>, <code>vmsgtu</code>, <code>vmfeq</code>, <code>vmfne</code>, <code>vmflt</code>, <code>vmfle</code>, <code>vmfgt</code>, <code>vmfge</code></td></tr>
    <tr><td>Ponto flutuante (.vv, .vf)</td><td><code>vfadd</code>, <code>vfsub</code>, <code>vfrsub</code>, <code>vfmul</code>, <code>vfdiv</code>, <code>vfrdiv</code>, <code>vfmin</code>, <code>vfmax</code>, <code>vfsgnj</code>, <code>vfsgnjn</code>, <code>vfsgnjx</code>, <code>vfmacc</code>, <code>vfnmacc</code>, <code>vfmsac</code>, <code>vfnmsac</code>, <code>vfmadd</code>, <code>vfmsub</code>, <code>vfsqrt.v</code>, <code>vfcvt</code></td></tr>
    <tr><td>Reduções</td><td><code>vredsum</code>, <code>vredand</code>, <code>vredor</code>, <code>vredxor</code>, <code>vredmin</code>, <code>vredmax</code>, <code>vredminu</code>, <code>vredmaxu</code>, <code>vfredusum</code>, <code>vfredosum</code>, <code>vfredmin</code>, <code>vfredmax</code></td></tr>
    <tr><td>Máscaras</td><td><code>vmand</code>, <code>vmnand</code>, <code>vmandn</code>, <code>vmor</code>, <code>vmnor</code>, <code>vmorn</code>, <code>vmxor</code>, <code>vmxnor</code>, <code>vcpop.m</code>, <code>vfirst.m</code></td></tr>
    <tr><td>Movimentação</td><td><code>vmv.v.v</code>, <code>vmv.v.x</code>, <code>vmv.v.i</code>, <code>vfmv.v.f</code>, <code>vmv.x.s</code>, <code>vmv.s.x</code>, <code>vfmv.f.s</code>, <code>vfmv.s.f</code>, <code>vmerge</code>, <code>vfmerge</code>, <code>vid.v</code></td></tr>
    <tr><td>Pseudoinstruções</td><td><code>vneg.v</code>, <code>vnot.v</code>, <code>vfneg.v</code>, <code>vfabs.v</code>, <code>vmmv.m</code>, <code>vmnot.m</code>, <code>vmclr.m</code>, <code>vmset.m</code>, <code>vmsgt.vv</code>, <code>vmsge.vv</code>, <code>vmfgt.vv</code>, <code>vmfge.vv</code></td></tr>
</table>
<p>A ordem dos operandos segue a especificação: <code>vadd.vv vd, vs2, vs1</code> calcula vs2 + vs1, e <code>vfmacc.vf vd, rs1, vs2</code> calcula vd + rs1 × vs2. O endereço de um acesso vetorial é escrito entre parênteses, sem deslocamento: <code>vle32.v v1, (a0)</code>. A máscara opcional vem por último: <code>vadd.vv v3, v1, v2, v0.t</code>.</p>`,
        },
        {
            id: 'classroom',
            title: 'Recursos para aula',
            html: `
<dl>
    <dt>Exercício</dt>
    <dd>Abre a simulação como exercício: para cada instrução vetorial executada, o aluno informa o ciclo de emissão, o ciclo do primeiro resultado e o ciclo de conclusão, e o simulador corrige. Também exporta a tabela em branco e o gabarito em LaTeX.</dd>
    <dt>Comparar</dt>
    <dd>Executa o mesmo programa com outra configuração (por exemplo, sem encadeamento, ou com 8 lanes) e mostra o speedup, as estatísticas, as diferenças de configuração e as duas linhas do tempo lado a lado.</dd>
    <dt>Exportar</dt>
    <dd>Linha do tempo e tabela de eventos em CSV e em LaTeX (cabeçalho com fundo <code>tabAzul</code> e texto branco, com <code>\\hline</code>, sem booktabs).</dd>
    <dt>Copiar link</dt>
    <dd>Gera um endereço que abre a mesma simulação, comparação ou exercício, com o programa e a configuração embutidos.</dd>
</dl>`,
        },
        {
            id: 'stats',
            title: 'Estatísticas',
            html: `
<dl>
    <dt>Ciclos, instruções e CPI</dt>
    <dd>Instruções executadas, separadas em vetoriais e escalares. O CPI de um programa vetorial costuma ser alto, porque cada instrução vetorial faz o trabalho de muitas escalares; compare o trabalho pelo número de elementos.</dd>
    <dt>Elementos e operações de ponto flutuante</dt>
    <dd>Elementos ativos processados pelas instruções vetoriais e operações de ponto flutuante (uma multiplicação e soma fundida conta duas), no total e por ciclo.</dd>
    <dt>Uso das lanes</dt>
    <dd>Para cada unidade, a fração das posições disponíveis (ciclos × lanes) em que entrou um elemento.</dd>
    <dt>Paradas</dt>
    <dd>Ciclos em que a emissão ficou parada, por motivo, e bolhas causadas por desvios tomados.</dd>
    <dt>Tempo de execução</dt>
    <dd>Ciclos ÷ frequência.</dd>
</dl>`,
        },
        {
            id: 'glossary',
            title: 'Glossário',
            html: `
<dl>
    <dt>Chime</dt><dd>Tempo de execução de um comboio, cerca de vl ÷ lanes ciclos.</dd>
    <dt>Comboio</dt><dd>Grupo de instruções vetoriais que executam ao mesmo tempo.</dd>
    <dt>Encadeamento (chaining)</dt><dd>Repasse de cada elemento de uma instrução para a seguinte assim que é produzido.</dd>
    <dt>Gather e scatter</dt><dd>Load e store indexados: cada elemento em um endereço calculado a partir de um vetor de índices.</dd>
    <dt>Lane</dt><dd>Fatia da unidade vetorial (unidades funcionais e parte do banco de registradores) que processa um elemento por ciclo.</dd>
    <dt>Latência de partida</dt><dd>Ciclos até o primeiro resultado de uma instrução vetorial: a profundidade do pipeline da unidade.</dd>
    <dt>Máscara</dt><dd>Vetor de bits que habilita ou desabilita cada elemento de uma operação.</dd>
    <dt>SEW</dt><dd>Largura de um elemento, em bits.</dd>
    <dt>Strip mining</dt><dd>Divisão de um laço em blocos de até VLMAX elementos.</dd>
    <dt>VLEN e VLMAX</dt><dd>Tamanho de um registrador vetorial em bits e número de elementos que cabem nele.</dd>
    <dt>vl</dt><dd>Número de elementos processados pelas próximas instruções vetoriais.</dd>
</dl>`,
        },
        {
            id: 'limits',
            title: 'Simplificações',
            html: `
<ul>
    <li>Apenas LMUL = 1, e a largura dos acessos à memória deve ser igual ao SEW (não há instruções de alargamento ou estreitamento).</li>
    <li>Elementos inativos e da cauda são sempre preservados.</li>
    <li>A memória tem latência fixa (a latência das classes de load e store), sem caches nem conflitos de banco; acessos com passo e indexados entregam um número fixo de elementos por ciclo.</li>
    <li>A emissão para na primeira instrução que não pode começar; não há filas de instruções para as unidades vetoriais.</li>
    <li>Não há previsão de desvios: desvios tomados custam um número fixo de bolhas.</li>
    <li>Não há limite de portas no banco de registradores vetoriais.</li>
    <li>Os valores são calculados quando a instrução chega à emissão, em ordem de programa; o estado exibido muda nos ciclos em que cada elemento é escrito. O estado final é verificado contra um simulador funcional de referência.</li>
</ul>`,
        },
    ],
};
