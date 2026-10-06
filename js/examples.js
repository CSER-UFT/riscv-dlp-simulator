import { getLanguage } from './i18n/index.js';

/**
 * Programas de exemplo exibidos na janela de Nova Simulação.
 * `config` (opcional) sugere ajustes de configuração que evidenciam o fenômeno do exemplo.
 */
export const exampleName = (ex) => (getLanguage() === 'en' ? ex.nameEn : ex.name);

export const EXAMPLES = [
    {
        id: 'saxpy',
        name: 'SAXPY com strip mining',
        nameEn: 'SAXPY with strip mining',
        config: { mode: 'vector' },
        code: `# SAXPY: y = a * x + y, em blocos de até VLMAX elementos (strip mining).
# Com VLEN = 256 e elementos de 32 bits, cada bloco tem até 8 elementos.
.data
a:  .float 2.0
n:  .word 32
x:  .float 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32
y:  .float 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320
.text
    la      t0, a
    flw     fa0, 0(t0)          # fa0 = a
    lw      a0, n               # a0 = elementos restantes
    la      a1, x
    la      a2, y
laco:
    vsetvli t1, a0, e32, m1, ta, ma   # t1 = vl = min(a0, VLMAX)
    vle32.v v1, (a1)            # v1 = bloco de x
    vle32.v v2, (a2)            # v2 = bloco de y
    vfmacc.vf v2, fa0, v1       # v2 = a * v1 + v2
    vse32.v v2, (a2)            # grava o bloco de y
    slli    t2, t1, 2           # bytes processados
    add     a1, a1, t2
    add     a2, a2, t2
    sub     a0, a0, t1
    bnez    a0, laco
    ecall
`,
    },
    {
        id: 'saxpy-scalar',
        name: 'SAXPY escalar (para comparar)',
        nameEn: 'Scalar SAXPY (for comparison)',
        config: { mode: 'vector' },
        code: `# SAXPY sem instruções vetoriais, um elemento por iteração.
# Compare o número de ciclos e de instruções com o exemplo SAXPY com strip mining.
.data
a:  .float 2.0
n:  .word 32
x:  .float 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32
y:  .float 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320
.text
    la      t0, a
    flw     fa0, 0(t0)          # fa0 = a
    lw      a0, n               # a0 = elementos restantes
    la      a1, x
    la      a2, y
laco:
    flw     ft0, 0(a1)          # x[i]
    flw     ft1, 0(a2)          # y[i]
    fmadd.s ft1, fa0, ft0, ft1  # a * x[i] + y[i]
    fsw     ft1, 0(a2)
    addi    a1, a1, 4
    addi    a2, a2, 4
    addi    a0, a0, -1
    bnez    a0, laco
    ecall
`,
    },
    {
        id: 'chaining',
        name: 'Encadeamento (chaining)',
        nameEn: 'Chaining',
        config: { mode: 'vector' },
        code: `# Cada instrução depende da anterior. Com encadeamento, a seguinte começa assim que
# os primeiros elementos ficam prontos; sem ele, espera a anterior terminar.
# Use Comparar (desligando o encadeamento em B) para ver as duas situações lado a lado.
# São 32 elementos de 8 bits: com 4 lanes, cada instrução leva 8 ciclos para entrar na unidade.
.data
x:  .byte 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
    .byte 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
y:  .byte 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3
    .byte 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2
z:  .space 32
.text
    li      a0, 32
    la      a1, x
    la      a2, y
    la      a3, z
    vsetvli t0, a0, e8, m1, ta, ma
    vle8.v  v1, (a1)
    vle8.v  v2, (a2)
    vmul.vv v3, v1, v2          # depende das duas cargas
    vadd.vv v4, v3, v1          # depende de vmul
    vse8.v  v4, (a3)            # depende de vadd
`,
    },
    {
        id: 'lanes',
        name: 'Lanes: 32 elementos de 8 bits',
        nameEn: 'Lanes: 32 elements of 8 bits',
        config: { mode: 'vector' },
        code: `# Soma de dois vetores de 32 bytes em uma única instrução (SEW = 8: VLMAX = 32 com VLEN = 256).
# A cada ciclo entra um elemento por lane: compare 1, 2, 4 e 8 lanes.
.data
a:  .byte 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
    .byte 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32
b:  .byte 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10
    .byte 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20
c:  .space 32
.text
    li      a0, 32
    la      a1, a
    la      a2, b
    la      a3, c
    vsetvli t0, a0, e8, m1, ta, ma
    vle8.v  v1, (a1)
    vle8.v  v2, (a2)
    vadd.vv v3, v1, v2
    vse8.v  v3, (a3)
`,
    },
    {
        id: 'dot',
        name: 'Produto escalar com redução',
        nameEn: 'Dot product with reduction',
        config: { mode: 'vector' },
        code: `# Produto escalar: somas parciais em um registrador vetorial e uma única redução no final.
.data
n:  .word 16
x:  .float 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
y:  .float 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5
.text
    lw      a0, n
    la      a1, x
    la      a2, y
    vsetvli t0, zero, e32, m1, ta, ma   # vl = VLMAX
    vmv.v.i v4, 0               # v4 = somas parciais
laco:
    vsetvli t0, a0, e32, m1, tu, ma     # tu: preserva a cauda de v4
    vle32.v v1, (a1)
    vle32.v v2, (a2)
    vfmacc.vv v4, v1, v2        # v4 += x * y
    slli    t1, t0, 2
    add     a1, a1, t1
    add     a2, a2, t1
    sub     a0, a0, t0
    bnez    a0, laco
    vsetvli t0, zero, e32, m1, ta, ma
    vmv.s.x v5, zero            # v5[0] = 0
    vfredusum.vs v6, v4, v5     # v6[0] = soma dos elementos de v4
    vfmv.f.s fa0, v6            # fa0 = resultado
`,
    },
    {
        id: 'mask',
        name: 'Máscara: ReLU condicional',
        nameEn: 'Mask: conditional ReLU',
        config: { mode: 'vector' },
        code: `# Execução condicional com máscara: se a[i] < 0, a[i] = 0 (a função ReLU).
# Os elementos com o bit da máscara em 0 ficam inalterados.
.data
a:  .word 5, -3, 8, -1, 0, 7, -6, 2
.text
    la      a1, a
    vsetivli zero, 8, e32, m1, ta, mu
    vle32.v v1, (a1)
    vmslt.vx v0, v1, zero       # v0 = máscara dos elementos negativos
    vand.vi v1, v1, 0, v0.t     # zera só os elementos ativos
    vse32.v v1, (a1)
    vcpop.m a0, v0              # a0 = quantos eram negativos
`,
    },
    {
        id: 'strided',
        name: 'Acesso com passo (strided)',
        nameEn: 'Strided access',
        config: { mode: 'vector' },
        code: `# Lê a coluna 1 de uma matriz 4 x 4 guardada por linhas: o passo é uma linha (16 bytes).
# Acessos com passo entregam menos elementos por ciclo que os unitários (veja a configuração).
.data
m:  .word 11, 12, 13, 14
    .word 21, 22, 23, 24
    .word 31, 32, 33, 34
    .word 41, 42, 43, 44
col: .space 16
.text
    la      a1, m
    addi    a1, a1, 4           # endereço de m[0][1]
    li      t1, 16              # passo em bytes
    la      a2, col
    vsetivli zero, 4, e32, m1, ta, ma
    vlse32.v v1, (a1), t1       # v1 = m[0][1], m[1][1], m[2][1], m[3][1]
    vse32.v v1, (a2)
`,
    },
    {
        id: 'gather',
        name: 'Acesso indexado (gather)',
        nameEn: 'Indexed access (gather)',
        config: { mode: 'vector' },
        code: `# y[i] = tabela[idx[i]]: cada elemento vem de um endereço diferente.
.data
tabela: .word 100, 101, 102, 103, 104, 105, 106, 107
idx:    .word 28, 0, 12, 4, 24, 8, 20, 16    # deslocamentos em bytes
y:      .space 32
.text
    la      a1, tabela
    la      a2, idx
    la      a3, y
    vsetivli zero, 8, e32, m1, ta, ma
    vle32.v v2, (a2)            # deslocamentos
    vluxei32.v v1, (a1), v2     # v1[i] = tabela[idx[i]]
    vse32.v v1, (a3)
`,
    },
    {
        id: 'matvec',
        name: 'Matriz vezes vetor',
        nameEn: 'Matrix times vector',
        config: { mode: 'vector' },
        code: `# y = A * x, com A 4 x 4 guardada por colunas:
# y = x[0] * coluna 0 + x[1] * coluna 1 + ... (vfmacc.vf usa um escalar e um vetor).
.data
A:  .float 1, 2, 3, 4       # coluna 0
    .float 5, 6, 7, 8       # coluna 1
    .float 9, 10, 11, 12    # coluna 2
    .float 13, 14, 15, 16   # coluna 3
x:  .float 1, 0.5, 2, 1
y:  .space 16
.text
    la      a1, A
    la      a2, x
    la      a3, y
    li      a0, 4               # colunas restantes
    vsetivli zero, 4, e32, m1, ta, ma
    vmv.v.i v2, 0               # v2 = 0
laco:
    flw     fa0, 0(a2)          # fa0 = x[j]
    vle32.v v1, (a1)            # v1 = coluna j
    vfmacc.vf v2, fa0, v1       # v2 += x[j] * coluna j
    addi    a1, a1, 16
    addi    a2, a2, 4
    addi    a0, a0, -1
    bnez    a0, laco
    vse32.v v2, (a3)
`,
    },
    {
        id: 'tpu-matmul',
        name: 'TPU: C = ReLU(A × B)',
        nameEn: 'TPU: C = ReLU(A × B)',
        config: { mode: 'tpu' },
        code: `# Multiplicação de matrizes 4 x 4 na TPU, seguida da ativação ReLU.
# As linhas de A entram no array sistólico uma por ciclo; os pesos (B) ficam parados no array.
.data
A:  .word 1, 2, 3, 4
    .word 5, 6, 7, 8
    .word -1, -2, -3, -4
    .word 0, 1, 0, 1
B:  .word 1, 0, 0, 0
    .word 0, 2, 0, 0
    .word 0, 0, 3, 0
    .word 1, 1, 1, 1
C:  .space 64
.text
    la      a0, A
    la      a1, B
    la      a2, C
    tpu.rdhost 0, (a0), 4       # UB[0..3] = A
    tpu.rdw    (a1)             # bloco de pesos B na fila
    tpu.matmul 0, 0, 4          # ACC[0..3] = UB[0..3] x B
    tpu.act    4, 0, 4, relu    # UB[4..7] = ReLU(ACC[0..3])
    tpu.wrhost (a2), 4, 4       # C = UB[4..7]
    lw      t0, 0(a2)           # o núcleo escalar lê C[0][0]
`,
    },
    {
        id: 'tpu-batch',
        name: 'TPU: lote de 12 linhas',
        nameEn: 'TPU: batch of 12 rows',
        config: { mode: 'tpu' },
        code: `# Doze linhas multiplicadas pelos mesmos pesos: depois de encher, o array produz uma linha por
# ciclo e a utilização cresce. Compare com o exemplo de lote pequeno.
.data
A:  .word 1, 0, 0, 0
    .word 0, 1, 0, 0
    .word 0, 0, 1, 0
    .word 0, 0, 0, 1
    .word 1, 1, 1, 1
    .word 2, 2, 2, 2
    .word 1, 2, 3, 4
    .word 4, 3, 2, 1
    .word -1, 1, -1, 1
    .word 3, 0, 3, 0
    .word 0, 5, 0, 5
    .word 1, -1, 2, -2
W:  .word 1, 2, 3, 4
    .word 5, 6, 7, 8
    .word 9, 10, 11, 12
    .word 13, 14, 15, 16
Y:  .space 192
.text
    la      a0, A
    la      a1, W
    la      a2, Y
    tpu.rdhost 0, (a0), 12
    tpu.rdw    (a1)
    tpu.matmul 0, 0, 12
    tpu.act    0, 0, 12, none
    tpu.wrhost (a2), 0, 12
`,
    },
    {
        id: 'tpu-small',
        name: 'TPU: lote pequeno (os pesos limitam)',
        nameEn: 'TPU: small batch (weights limit)',
        config: { mode: 'tpu' },
        code: `# Quatro produtos vetor x matriz, cada um com pesos diferentes. Com uma linha por bloco de pesos,
# cada bloco leva N ciclos para entrar no array e o array fica a maior parte do tempo ocioso,
# mesmo com a fila de pesos (2 blocos) sendo carregada com antecedência.
.data
x:  .word 1, 2, 3, 4
W0: .word 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1
W1: .word 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2
W2: .word 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0
W3: .word 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
Y:  .space 64
.text
    la      a0, x
    la      t0, W0
    la      t1, W1
    la      t2, W2
    la      t3, W3
    la      a2, Y
    tpu.rdhost 0, (a0), 1
    tpu.rdw    (t0)             # a fila guarda até 2 blocos
    tpu.rdw    (t1)
    tpu.matmul 0, 0, 1          # usa W0
    tpu.rdw    (t2)             # entra no lugar de W0
    tpu.matmul 1, 0, 1          # usa W1
    tpu.rdw    (t3)
    tpu.matmul 2, 0, 1          # usa W2
    tpu.matmul 3, 0, 1          # usa W3
    tpu.act    1, 0, 4, none
    tpu.wrhost (a2), 1, 4
`,
    },
    {
        id: 'tpu-ktile',
        name: 'TPU: K maior que o array (acumulação)',
        nameEn: 'TPU: K larger than the array (accumulation)',
        config: { mode: 'tpu' },
        code: `# C = A x B com A de 4 x 8 e B de 8 x 4: K = 8 não cabe em um array 4 x 4.
# A é dividida em dois blocos de colunas (A0 e A1) e B em dois blocos de linhas (B0 e B1):
# C = A0 x B0 + A1 x B1, com tpu.matmul.acc somando ao que já está nos acumuladores.
.data
A0: .word 1, 2, 3, 4        # colunas 0 a 3 de A
    .word 0, 1, 0, 1
    .word 2, 2, 2, 2
    .word 1, 0, 0, 0
A1: .word 1, 1, 1, 1        # colunas 4 a 7 de A
    .word 0, 0, 1, 0
    .word -1, 0, 1, 0
    .word 0, 0, 0, 3
B:  .word 1, 0, 0, 0        # linhas 0 a 3 de B (B0)
    .word 0, 1, 0, 0
    .word 0, 0, 1, 0
    .word 0, 0, 0, 1
    .word 1, 1, 1, 1        # linhas 4 a 7 de B (B1)
    .word 2, 2, 2, 2
    .word 0, 1, 0, 1
    .word 1, 0, 1, 0
C:  .space 64
.text
    la      a0, A0
    la      a1, A1
    la      a2, B
    addi    a3, a2, 64          # endereço de B1
    la      a4, C
    tpu.rdhost 0, (a0), 4       # UB[0..3] = A0
    tpu.rdhost 4, (a1), 4       # UB[4..7] = A1
    tpu.rdw    (a2)             # B0
    tpu.rdw    (a3)             # B1
    tpu.matmul 0, 0, 4          # ACC = A0 x B0
    tpu.matmul.acc 0, 4, 4      # ACC += A1 x B1
    tpu.act    8, 0, 4, none
    tpu.wrhost (a4), 8, 4
`,
    },
    {
        id: 'tpu-mlp',
        name: 'TPU: rede de duas camadas',
        nameEn: 'TPU: two layer network',
        config: { mode: 'tpu' },
        code: `# Rede neural de duas camadas: Y = ReLU(ReLU(X x W1) x W2).
# A saída da primeira camada fica no Unified Buffer e alimenta a segunda, sem voltar à memória.
.data
X:  .word 1, 2, 0, -1
    .word 0, 1, 1, 0
    .word 3, 0, 1, 1
    .word -2, 1, 0, 2
W1: .word 1, -1, 0, 2
    .word 0, 1, 1, 0
    .word 2, 0, -1, 1
    .word 1, 1, 0, -1
W2: .word 1, 0, 1, 0
    .word 0, 1, 0, 1
    .word 1, 1, 0, 0
    .word 0, 0, 1, 1
Y:  .space 64
.text
    la      a0, X
    la      a1, W1
    la      a2, W2
    la      a3, Y
    tpu.rdhost 0, (a0), 4       # X
    tpu.rdw    (a1)             # W1
    tpu.rdw    (a2)             # W2
    tpu.matmul 0, 0, 4          # camada 1
    tpu.act    4, 0, 4, relu    # H = ReLU(X x W1) em UB[4..7]
    tpu.matmul 4, 4, 4          # camada 2: ACC[4..7] = H x W2
    tpu.act    8, 4, 4, relu
    tpu.wrhost (a3), 8, 4
`,
    },
    {
        id: 'gpu-saxpy',
        name: 'GPU: SAXPY',
        nameEn: 'GPU: SAXPY',
        config: { mode: 'gpu' },
        code: `# SAXPY na GPU: cada thread calcula y[i] = a * x[i] + y[i] para i = tid, tid + ntid, ...
# (laço com passo igual ao número de threads, que funciona com qualquer número de warps).
# Compare 1 warp com 4 warps: com mais warps, o escalonador esconde a latência da memória.
.data
a:  .float 2.0
n:  .word 32
x:  .float 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32
y:  .float 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320
.text
    gpu.tid  t0                 # i = índice da thread
    gpu.ntid t1                 # passo = número de threads
    lw      t2, n
    la      t3, x
    la      t4, y
    la      t5, a
    flw     fa0, 0(t5)
laco:
    bge     t0, t2, fim
    slli    t6, t0, 2
    add     a0, t3, t6
    add     a1, t4, t6
    flw     ft0, 0(a0)          # x[i]
    flw     ft1, 0(a1)          # y[i]
    fmadd.s ft1, fa0, ft0, ft1
    fsw     ft1, 0(a1)
    add     t0, t0, t1
    j       laco
fim:
    ecall
`,
    },
    {
        id: 'gpu-divergence',
        name: 'GPU: divergência',
        nameEn: 'GPU: divergence',
        config: { mode: 'gpu' },
        code: `# Threads pares e ímpares seguem caminhos diferentes do if: o warp executa os dois caminhos em
# sequência, cada um com metade das threads, e elas se juntam de novo em "junta".
# Troque "andi t4, t0, 1" por "slti t4, t0, 16": cada warp inteiro segue o mesmo caminho.
.data
n:  .word 32
v:  .space 128
.text
    gpu.tid  t0
    gpu.ntid t1
    lw      t2, n
    la      t3, v
laco:
    bge     t0, t2, fim
    andi    t4, t0, 1           # t4 = i ímpar?
    beqz    t4, par
    mul     t5, t0, t0          # ímpar: i * i
    j       junta
par:
    addi    t5, t0, 100         # par: i + 100
junta:
    slli    t6, t0, 2
    add     t6, t3, t6
    sw      t5, 0(t6)
    add     t0, t0, t1
    j       laco
fim:
    ecall
`,
    },
    {
        id: 'gpu-coalescing',
        name: 'GPU: coalescência',
        nameEn: 'GPU: coalescing',
        config: { mode: 'gpu' },
        code: `# No primeiro laço, threads vizinhas leem palavras vizinhas: os acessos de um warp cabem em uma
# transação. No segundo, cada thread lê com passo de 32 bytes: uma transação por thread.
# Compare as transações por acesso nas estatísticas e o painel de coalescência.
.data
n:  .word 32
    .align 5                    # x começa no início de uma linha de 32 bytes
x:  .word 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255
    .align 5
y:  .space 128
.text
    gpu.tid  t0
    gpu.ntid t1
    lw      t2, n
    la      t3, x
    la      t4, y
    mv      a2, t0
unit:                           # y[i] = x[i]
    bge     a2, t2, passo
    slli    t5, a2, 2
    add     a0, t3, t5
    add     a1, t4, t5
    lw      t6, 0(a0)
    sw      t6, 0(a1)
    add     a2, a2, t1
    j       unit
passo:
    mv      a2, t0
strided:                        # y[i] = x[8 * i]
    bge     a2, t2, fim
    slli    t5, a2, 5           # 8 * i * 4 bytes
    add     a0, t3, t5
    slli    t5, a2, 2
    add     a1, t4, t5
    lw      t6, 0(a0)
    sw      t6, 0(a1)
    add     a2, a2, t1
    j       strided
fim:
    ecall
`,
    },
    {
        id: 'gpu-reduction',
        name: 'GPU: redução na memória compartilhada',
        nameEn: 'GPU: reduction in shared memory',
        config: { mode: 'gpu', gpu: { blocks: 4, warps: 1, warpSize: 8 } },
        code: `# Soma dos 32 elementos de v em 4 blocos de 8 threads. Cada bloco copia a sua parte de v para a
# memória compartilhada (seção .shared, uma cópia por bloco) e soma em árvore: a cada passo, as
# threads i < passo somam s[i + passo] em s[i], e a barreira do bloco garante que o passo terminou.
# A thread 0 de cada bloco grava a soma parcial em out[bloco]: 36, 100, 164 e 228 (total 528).
# Experimente: menos warps residentes no SM (configuração) fazem os blocos esperarem a vez.
.data
n:   .word 32
v:   .word 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32
out: .space 256                 # uma soma parcial por bloco
.shared
s:   .space 128                 # uma palavra por thread do bloco (até 32 threads)
.text
    gpu.tid  t0                 # i global
    gpu.btid t1                 # índice dentro do bloco
    gpu.bid  t2
    gpu.bdim t3                 # threads por bloco
    lw      t4, n
    li      a0, 0
    bge     t0, t4, copia       # fora de v: soma 0
    la      t5, v
    slli    t6, t0, 2
    add     t5, t5, t6
    lw      a0, 0(t5)
copia:
    la      s0, s
    slli    t6, t1, 2
    add     s1, s0, t6          # endereço de s[btid]
    sw      a0, 0(s1)
    gpu.bar
    srli    t4, t3, 1           # passo = threads por bloco / 2
passo:
    bge     t1, t4, espera      # só as threads com índice < passo trabalham
    slli    t5, t4, 2
    add     t5, s1, t5          # endereço de s[btid + passo]
    lw      t6, 0(t5)
    lw      a1, 0(s1)
    add     a1, a1, t6
    sw      a1, 0(s1)
espera:
    gpu.bar
    srli    t4, t4, 1
    bnez    t4, passo
    bnez    t1, fim             # só a thread 0 do bloco grava
    lw      a1, 0(s0)
    la      t5, out
    slli    t6, t2, 2
    add     t5, t5, t6
    sw      a1, 0(t5)
fim:
    ecall
`,
    },
    {
        id: 'gpu-banks',
        name: 'GPU: conflitos de banco',
        nameEn: 'GPU: bank conflicts',
        config: { mode: 'gpu', gpu: { warps: 1, warpSize: 8, smemBanks: 8 } },
        code: `# Cada thread grava na coluna 0 de uma matriz 8 x 8 de palavras na memória compartilhada.
# Em m, as linhas têm 8 palavras: a coluna 0 de todas as linhas cai no mesmo banco (8 bancos de
# 4 bytes), e o acesso é serializado em 8 ciclos (conflito de grau 8).
# Em p, cada linha tem uma palavra de enchimento (9 palavras): a coluna 0 de cada linha cai em um banco
# diferente, e o acesso leva um ciclo. Veja o painel de bancos e as estatísticas.
.shared
m:  .space 256                  # 8 x 8 palavras
p:  .space 288                  # 8 x 9 palavras
.text
    gpu.lane t0
    andi    t0, t0, 7           # linha (8 linhas)
    la      t1, m
    slli    t2, t0, 5           # linha * 32 bytes
    add     t2, t1, t2
    sw      t0, 0(t2)           # m[linha][0]: passo de 8 palavras, mesmo banco
    la      t1, p
    li      t3, 36
    mul     t2, t0, t3          # linha * 36 bytes
    add     t2, t1, t2
    sw      t0, 0(t2)           # p[linha][0]: passo de 9 palavras, bancos diferentes
    lw      t4, 0(t2)
    ecall
`,
    },
    {
        id: 'gemm-vector',
        name: 'Comparação: GEMM 8 x 8 no processador vetorial',
        nameEn: 'Comparison: 8 x 8 GEMM on the vector processor',
        config: { mode: 'vector' },
        code: `# C = A x B com matrizes 8 x 8 de inteiros (mesma carga dos exemplos de GEMM da GPU e da TPU).
# Para cada linha i de C, o laço em k soma A[i][k] x (linha k de B) no acumulador v8 com vmacc.vx.
# As colunas são processadas em blocos de até VLMAX elementos (strip mining), para qualquer VLEN.
.data
A:   .word -3, -2, -1, 0, 1, 2, 3, -3
     .word -2, -1, 0, 1, 2, 3, -3, -2
     .word -1, 0, 1, 2, 3, -3, -2, -1
     .word 0, 1, 2, 3, -3, -2, -1, 0
     .word 1, 2, 3, -3, -2, -1, 0, 1
     .word 2, 3, -3, -2, -1, 0, 1, 2
     .word 3, -3, -2, -1, 0, 1, 2, 3
     .word -3, -2, -1, 0, 1, 2, 3, -3
B:   .word -2, 0, 2, -1, 1, -2, 0, 2
     .word -1, 1, -2, 0, 2, -1, 1, -2
     .word 0, 2, -1, 1, -2, 0, 2, -1
     .word 1, -2, 0, 2, -1, 1, -2, 0
     .word 2, -1, 1, -2, 0, 2, -1, 1
     .word -2, 0, 2, -1, 1, -2, 0, 2
     .word -1, 1, -2, 0, 2, -1, 1, -2
     .word 0, 2, -1, 1, -2, 0, 2, -1
C:   .space 256
.text
    la      s0, A
    la      s1, B
    la      s2, C
    li      s3, 8               # N
    li      t0, 0               # i
linha:
    li      t1, 0               # j0: primeira coluna do bloco
bloco:
    sub     t2, s3, t1
    vsetvli t3, t2, e32, m1, ta, ma
    vmv.v.i v8, 0               # acumulador de C[i][j0..]
    slli    t4, t0, 5           # i x 32 bytes
    add     a0, s0, t4          # endereço de A[i][0]
    slli    t5, t1, 2
    add     a1, s1, t5          # endereço de B[0][j0]
    li      t6, 8               # k restantes
k:
    lw      a2, 0(a0)           # A[i][k]
    vle32.v v1, (a1)            # B[k][j0..]
    vmacc.vx v8, a2, v1         # C[i][j0..] += A[i][k] x B[k][j0..]
    addi    a0, a0, 4
    addi    a1, a1, 32
    addi    t6, t6, -1
    bnez    t6, k
    add     a3, s2, t4
    add     a3, a3, t5          # endereço de C[i][j0]
    vse32.v v8, (a3)
    add     t1, t1, t3
    blt     t1, s3, bloco
    addi    t0, t0, 1
    blt     t0, s3, linha
    ecall
`,
    },
    {
        id: 'gemm-gpu',
        name: 'Comparação: GEMM 8 x 8 na GPU',
        nameEn: 'Comparison: 8 x 8 GEMM on the GPU',
        config: { mode: 'gpu', gpu: { blocks: 2 } },
        code: `# C = A x B com matrizes 8 x 8 de inteiros: cada thread calcula um elemento C[r][c] (64 threads em
# 2 blocos). Em cada passo de k, as threads de um warp leem a mesma A[r][k] (uma transação) e elementos
# vizinhos de B[k][c] (coalescidos). Com menos threads, cada uma calcula vários elementos.
.data
A:   .word -3, -2, -1, 0, 1, 2, 3, -3
     .word -2, -1, 0, 1, 2, 3, -3, -2
     .word -1, 0, 1, 2, 3, -3, -2, -1
     .word 0, 1, 2, 3, -3, -2, -1, 0
     .word 1, 2, 3, -3, -2, -1, 0, 1
     .word 2, 3, -3, -2, -1, 0, 1, 2
     .word 3, -3, -2, -1, 0, 1, 2, 3
     .word -3, -2, -1, 0, 1, 2, 3, -3
B:   .word -2, 0, 2, -1, 1, -2, 0, 2
     .word -1, 1, -2, 0, 2, -1, 1, -2
     .word 0, 2, -1, 1, -2, 0, 2, -1
     .word 1, -2, 0, 2, -1, 1, -2, 0
     .word 2, -1, 1, -2, 0, 2, -1, 1
     .word -2, 0, 2, -1, 1, -2, 0, 2
     .word -1, 1, -2, 0, 2, -1, 1, -2
     .word 0, 2, -1, 1, -2, 0, 2, -1
C:   .space 256
.text
    gpu.tid  t0
    gpu.ntid t1
    li      s3, 64              # elementos de C
    la      s0, A
    la      s1, B
    la      s2, C
elemento:
    bge     t0, s3, fim
    srli    a0, t0, 3           # linha r
    andi    a1, t0, 7           # coluna c
    slli    a2, a0, 5
    add     a2, s0, a2          # endereço de A[r][0]
    slli    a3, a1, 2
    add     a3, s1, a3          # endereço de B[0][c]
    li      a4, 0               # soma
    li      a5, 8               # k restantes
k:
    lw      t2, 0(a2)           # A[r][k]
    lw      t3, 0(a3)           # B[k][c]
    mul     t2, t2, t3
    add     a4, a4, t2
    addi    a2, a2, 4
    addi    a3, a3, 32
    addi    a5, a5, -1
    bnez    a5, k
    slli    t4, t0, 2
    add     t4, s2, t4
    sw      a4, 0(t4)           # C[r][c]
    add     t0, t0, t1
    j       elemento
fim:
    ecall
`,
    },
    {
        id: 'gemm-gpu-shared',
        name: 'Comparação: GEMM 8 x 8 na GPU com memória compartilhada',
        nameEn: 'Comparison: 8 x 8 GEMM on the GPU with shared memory',
        config: { mode: 'gpu', gpu: { blocks: 1, warps: 2 } },
        code: `# A mesma GEMM, mas o bloco primeiro copia A e B para a memória compartilhada (as threads dividem a
# cópia), espera na barreira e depois calcula a partir da compartilhada, que tem latência bem menor que a
# memória global. Com 2 warps, compare com a GEMM sem memória compartilhada na mesma configuração
# (1 bloco de 2 warps): as transações caem de 136 para 24 e os ciclos de 1265 para 959. Com 8 warps,
# o escalonador já esconde a latência da memória global, e a cópia vira só trabalho a mais.
.data
A:   .word -3, -2, -1, 0, 1, 2, 3, -3
     .word -2, -1, 0, 1, 2, 3, -3, -2
     .word -1, 0, 1, 2, 3, -3, -2, -1
     .word 0, 1, 2, 3, -3, -2, -1, 0
     .word 1, 2, 3, -3, -2, -1, 0, 1
     .word 2, 3, -3, -2, -1, 0, 1, 2
     .word 3, -3, -2, -1, 0, 1, 2, 3
     .word -3, -2, -1, 0, 1, 2, 3, -3
B:   .word -2, 0, 2, -1, 1, -2, 0, 2
     .word -1, 1, -2, 0, 2, -1, 1, -2
     .word 0, 2, -1, 1, -2, 0, 2, -1
     .word 1, -2, 0, 2, -1, 1, -2, 0
     .word 2, -1, 1, -2, 0, 2, -1, 1
     .word -2, 0, 2, -1, 1, -2, 0, 2
     .word -1, 1, -2, 0, 2, -1, 1, -2
     .word 0, 2, -1, 1, -2, 0, 2, -1
C:   .space 256
.shared
sA:  .space 256
sB:  .space 256
.text
    gpu.btid t0
    gpu.bdim t1
    la      s0, A
    la      s4, sA
    li      t2, 128             # palavras de A e B juntas (sA e sB são vizinhas, como A e B)
copia:
    bge     t0, t2, calcula
    slli    t3, t0, 2
    add     t4, s0, t3
    lw      t5, 0(t4)
    add     t4, s4, t3
    sw      t5, 0(t4)
    add     t0, t0, t1
    j       copia
calcula:
    gpu.bar
    gpu.tid  t0
    gpu.ntid t1
    li      s3, 64
    la      s1, sB
    la      s2, C
elemento:
    bge     t0, s3, fim
    srli    a0, t0, 3           # linha r
    andi    a1, t0, 7           # coluna c
    slli    a2, a0, 5
    add     a2, s4, a2          # endereço de sA[r][0]
    slli    a3, a1, 2
    add     a3, s1, a3          # endereço de sB[0][c]
    li      a4, 0
    li      a5, 8
k:
    lw      t2, 0(a2)
    lw      t3, 0(a3)
    mul     t2, t2, t3
    add     a4, a4, t2
    addi    a2, a2, 4
    addi    a3, a3, 32
    addi    a5, a5, -1
    bnez    a5, k
    slli    t4, t0, 2
    add     t4, s2, t4
    sw      a4, 0(t4)
    add     t0, t0, t1
    j       elemento
fim:
    ecall
`,
    },
    {
        id: 'gemm-tpu',
        name: 'Comparação: GEMM 8 x 8 na TPU',
        nameEn: 'Comparison: 8 x 8 GEMM on the TPU',
        config: { mode: 'tpu' },
        code: `# C = A x B com as mesmas matrizes 8 x 8 dos exemplos de GEMM vetorial e da GPU, em um array 4 x 4.
# Os dados já estão em blocos: A0 e A1 são as colunas 0 a 3 e 4 a 7 de A (8 linhas cada); B00, B10,
# B01 e B11 são os blocos 4 x 4 de B. C0 (colunas 0 a 3 de C) = A0 x B00 + A1 x B10 e
# C1 (colunas 4 a 7) = A0 x B01 + A1 x B11. Na TPU v1, esse rearranjo é feito pelo software do host.
.data
A0:  .word -3, -2, -1, 0
     .word -2, -1, 0, 1
     .word -1, 0, 1, 2
     .word 0, 1, 2, 3
     .word 1, 2, 3, -3
     .word 2, 3, -3, -2
     .word 3, -3, -2, -1
     .word -3, -2, -1, 0
A1:  .word 1, 2, 3, -3
     .word 2, 3, -3, -2
     .word 3, -3, -2, -1
     .word -3, -2, -1, 0
     .word -2, -1, 0, 1
     .word -1, 0, 1, 2
     .word 0, 1, 2, 3
     .word 1, 2, 3, -3
B00: .word -2, 0, 2, -1
     .word -1, 1, -2, 0
     .word 0, 2, -1, 1
     .word 1, -2, 0, 2
B10: .word 2, -1, 1, -2
     .word -2, 0, 2, -1
     .word -1, 1, -2, 0
     .word 0, 2, -1, 1
B01: .word 1, -2, 0, 2
     .word 2, -1, 1, -2
     .word -2, 0, 2, -1
     .word -1, 1, -2, 0
B11: .word 0, 2, -1, 1
     .word 1, -2, 0, 2
     .word 2, -1, 1, -2
     .word -2, 0, 2, -1
C0:  .space 128
C1:  .space 128
.text
    la      a0, A0
    la      a1, A1
    tpu.rdhost 0, (a0), 8       # UB[0..7] = A0
    tpu.rdhost 8, (a1), 8       # UB[8..15] = A1
    la      a2, B00
    tpu.rdw    (a2)             # B00
    la      a2, B10
    tpu.rdw    (a2)             # B10
    tpu.matmul 0, 0, 8          # ACC[0..7] = A0 x B00
    tpu.matmul.acc 0, 8, 8      # ACC[0..7] += A1 x B10
    la      a2, B01
    tpu.rdw    (a2)             # B01
    la      a2, B11
    tpu.rdw    (a2)             # B11
    tpu.matmul 8, 0, 8          # ACC[8..15] = A0 x B01
    tpu.matmul.acc 8, 8, 8      # ACC[8..15] += A1 x B11
    tpu.act    0, 0, 8, none    # UB[0..7] = C0
    tpu.act    8, 8, 8, none    # UB[8..15] = C1
    la      a3, C0
    tpu.wrhost (a3), 0, 8
    la      a3, C1
    tpu.wrhost (a3), 8, 8
`,
    },
];
