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
n:  .word 12
x:  .float 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
y:  .float 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120
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
n:  .word 12
x:  .float 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
y:  .float 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120
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
];
