/**
 * Simulator help, in English. Each section becomes an entry in the table of contents.
 */
export default {
    title: 'RISC-V Data Level Parallelism Simulator',
    lead: 'Educational simulator of architectures that exploit data level parallelism, starting with the vector processor of the RISC-V V extension. Developed for the <strong>Computer Science</strong> program at the <strong>Federal University of Tocantins</strong> (UFT), Brazil.',
    searchPlaceholder: 'Search the help',
    noResults: 'No section contains this term.',
    tocTitle: 'Contents',
    close: 'Close help',
    sections: [
        {
            id: 'start',
            title: 'Getting started',
            html: `
<p>The simulator runs a RISC-V assembly program, with scalar and vector instructions, and shows cycle by cycle what happens inside the processor. Everything runs in the browser: nothing is sent to a server.</p>
<ol>
    <li>Click <strong>New simulation</strong>.</li>
    <li>Pick an <strong>example</strong> from the list or write your own program. Errors appear below the editor with their line number; click an error to jump to it.</li>
    <li>On the right, adjust the configuration if you like: VLEN, number of lanes, chaining, functional units and latencies.</li>
    <li>Click <strong>Run</strong> (or <kbd>Ctrl</kbd> + <kbd>Enter</kbd>). The simulation opens in a new tab.</li>
    <li>Move forward with the <kbd>right arrow</kbd>. Each step comes with a sentence explaining what happened, and the diagram highlights the part involved.</li>
</ol>
<p class="tip">A good start: the <em>SAXPY with strip mining</em> example, then <em>Scalar SAXPY</em> to compare the cycle counts. Then the <em>Chaining</em> example with the <strong>Compare</strong> button, turning chaining off in configuration B.</p>
<p>Several simulations can be open at once, each in its own tab. The last program and configuration are stored in the browser and come back on the next visit.</p>`,
        },
        {
            id: 'screen',
            title: 'The screen',
            html: `
<dl>
    <dt>Header</dt>
    <dd><strong>New simulation</strong> opens the editor. With a simulation open, <strong>Edit</strong>, <strong>Compare</strong>, <strong>Exercise</strong>, <strong>Export</strong> and <strong>Copy link</strong> appear; they are described in <a href="#h-classroom">Classroom tools</a>. On the right are the language, the contrast button (light or dark theme) and this help.</dd>
    <dt>Tabs</dt>
    <dd>Each simulation, exercise or comparison opens in a tab. The name shows the example (or the first instruction), the model and the number of lanes. Close it with <strong>×</strong>.</dd>
    <dt>Diagram</dt>
    <dd>Fills the central area. Drag to move, use the mouse wheel to zoom and double click to reset. The panel related to the current step gets a yellow border.</dd>
    <dt>Control bar</dt>
    <dd>In the lower left corner. Shows the current cycle and the total (for example <code>7 / 42</code>) and, next to it, the explanation of the step: registers and units in <strong>bold</strong>, values in <em>italics</em> and instructions in a monospaced font.</dd>
    <dt>Timeline</dt>
    <dd>At the bottom. One row per executed instruction and one column per cycle: <code>Issue</code> in the cycle the instruction starts, <code>Exec</code> while its elements are still entering the unit, <code>Lat</code> while the last elements cross the pipeline and <code>Stall</code> while the instruction waits to issue. Cells only appear once the corresponding step is reached.</dd>
</dl>`,
        },
        {
            id: 'controls',
            title: 'Navigation and shortcuts',
            html: `
<p>Each cycle is split into <strong>steps</strong>, one for each relevant event (an issue, a stall, the write of a group of elements). Moving one step shows the next event; moving one cycle jumps to the end of the next cycle.</p>
<table>
    <tr><th>Action</th><th>Keyboard</th><th>Button</th></tr>
    <tr><td>Forward one step</td><td><kbd>→</kbd></td><td>button right after the counter</td></tr>
    <tr><td>Back one step</td><td><kbd>←</kbd></td><td>button right before the counter</td></tr>
    <tr><td>Forward one cycle</td><td><kbd>Ctrl</kbd> + <kbd>→</kbd></td><td>the same button, with <kbd>Ctrl</kbd></td></tr>
    <tr><td>Back one cycle</td><td><kbd>Ctrl</kbd> + <kbd>←</kbd></td><td>the same button, with <kbd>Ctrl</kbd></td></tr>
    <tr><td>Go to the start</td><td><kbd>Home</kbd></td><td>first button</td></tr>
    <tr><td>Go to the end</td><td><kbd>End</kbd></td><td>last button</td></tr>
    <tr><td>Run (in the editor)</td><td><kbd>Ctrl</kbd> + <kbd>Enter</kbd></td><td>Run</td></tr>
    <tr><td>Indent (in the editor)</td><td><kbd>Tab</kbd></td><td></td></tr>
    <tr><td>Close the editor or the help</td><td><kbd>Esc</kbd></td><td>×</td></tr>
</table>
<p>Navigation shortcuts do not work while the editor is open or when the cursor is in a text field.</p>`,
        },
        {
            id: 'dlp',
            title: 'Data level parallelism',
            html: `
<p>Many programs apply the same operation to many data items: adding two vectors, multiplying matrices, filtering an image. This is <strong>data level parallelism</strong> (DLP). Instead of fetching and decoding one instruction per element, the architecture uses one instruction for many elements, which saves energy and instruction bandwidth.</p>
<p>Hennessy and Patterson present three families of architectures for it:</p>
<dl>
    <dt>Vector processors</dt>
    <dd>Long registers holding many elements, and deeply pipelined functional units that process a few elements per cycle (the <em>lanes</em>). The vector length is set by the program at run time (<code>vl</code>). This is the model in this simulator, with the RISC-V V extension.</dd>
    <dt>SIMD extensions</dt>
    <dd>Fixed width registers (128, 256, 512 bits) in ordinary processors, such as SSE and AVX. The number of elements is part of the instruction encoding, so programs must be rewritten for each new width.</dd>
    <dt>GPUs</dt>
    <dd>Thousands of threads run in groups (warps) that share the same instruction (SIMT), with fast switching between groups to hide memory latency.</dd>
</dl>
<p><strong>Domain specific architectures</strong>, such as Google's TPU, take the idea further: a systolic array of multipliers dedicated to matrix multiplication.</p>
<p class="tip">GPU and TPU models are planned for future versions of this simulator; for now, only the vector processor is available.</p>`,
        },
        {
            id: 'rvv',
            title: 'The V extension in brief',
            html: `
<p>The V extension adds 32 vector registers, <code>v0</code> to <code>v31</code>, each with <strong>VLEN</strong> bits. A register holds several elements of <strong>SEW</strong> bits (8, 16, 32 or 64), chosen by the program.</p>
<table>
    <tr><th>Term</th><th>Meaning</th></tr>
    <tr><td><strong>VLEN</strong></td><td>size of each vector register, set by the hardware (simulator configuration)</td></tr>
    <tr><td><strong>SEW</strong></td><td>width of each element, chosen by <code>vsetvli</code> (<code>e8</code>, <code>e16</code>, <code>e32</code> or <code>e64</code>)</td></tr>
    <tr><td><strong>VLMAX</strong></td><td>how many elements fit in a register: VLEN ÷ SEW (with LMUL = 1)</td></tr>
    <tr><td><strong>vl</strong></td><td>how many elements the next instructions process (from 0 to VLMAX)</td></tr>
    <tr><td><strong>vtype</strong></td><td>the current vector type: SEW, LMUL and the tail and mask policies</td></tr>
</table>
<h3>vsetvli and strip mining</h3>
<p><code>vsetvli rd, rs1, e32, m1, ta, ma</code> asks to process <code>rs1</code> elements of 32 bits; the hardware answers in <code>rd</code> how many it will process now: vl = min(rs1, VLMAX). The program processes that block, advances the pointers and repeats until done. This loop is <strong>strip mining</strong>, and the same code works with any VLEN: with a larger VLEN, the loop just takes fewer trips. See the <em>SAXPY with strip mining</em> example.</p>
<p><code>vsetivli</code> does the same with a constant (0 to 31). With <code>rs1 = zero</code> and a nonzero <code>rd</code>, <code>vsetvli</code> sets vl = VLMAX.</p>
<h3>Masks</h3>
<p>A vector comparison (<code>vmslt</code>, <code>vmfeq</code>...) produces a <strong>mask</strong>: one bit per element. Most instructions accept the <code>v0.t</code> suffix, which restricts the operation to elements whose bit in <code>v0</code> is 1; the others are left unchanged. This is how an <code>if</code> inside a loop becomes vector code (example <em>Mask: conditional ReLU</em>).</p>
<h3>Tail</h3>
<p>Elements with index greater than or equal to vl form the <strong>tail</strong> and are not changed. The <code>ta</code>/<code>tu</code> and <code>ma</code>/<code>mu</code> policies are accepted, but the simulator always preserves the tail and inactive elements, which the specification also allows under the <em>agnostic</em> policies.</p>
<h3>Memory accesses</h3>
<ul>
    <li><strong>Unit stride</strong> (<code>vle32.v</code>, <code>vse32.v</code>): consecutive elements.</li>
    <li><strong>Strided</strong> (<code>vlse32.v vd, (rs1), rs2</code>): elements <code>rs2</code> bytes apart, for example a column of a matrix stored by rows.</li>
    <li><strong>Indexed</strong> (<code>vluxei32.v vd, (rs1), vs2</code>), also called <em>gather</em> and <em>scatter</em>: element i is at rs1 + vs2[i] (byte offset).</li>
</ul>
<h3>Reductions</h3>
<p><code>vredsum.vs vd, vs2, vs1</code> adds vs1[0] and all active elements of vs2 and writes the result to vd[0]. <code>vmv.x.s</code> and <code>vfmv.f.s</code> copy element 0 to a scalar register.</p>`,
        },
        {
            id: 'vector',
            title: 'The vector processor',
            html: `
<p>The model follows Hennessy and Patterson's RV64V: a simple in order <strong>scalar core</strong> that fetches and issues every instruction, and a <strong>vector unit</strong> with several functional units, each pipelined and with the same number of <strong>lanes</strong>.</p>
<h3>The diagram</h3>
<dl>
    <dt>Header</dt>
    <dd>The PC, the current vector state (vl, SEW and VLMAX) and the main configuration: VLEN, lanes and chaining.</dd>
    <dt>Issue</dt>
    <dd>The instruction being issued, or the stalled one and the reason (RAW, WAR, WAW, busy unit, scalar register or memory), with the cycle in which it can start. Below, the next instructions in program order. After a taken branch a <em>bubble</em> shows up.</dd>
    <dt>Scalar unit</dt>
    <dd>The scalar instructions in flight and the cycle in which each result is ready.</dd>
    <dt>Vector functional units</dt>
    <dd>One per configured unit (by default LSU for loads and stores, ALU for integer operations and floating point add, MUL for multiplications and DIV for divisions). The grid has one row per lane and one column per pipeline stage; each cell shows the index of the element in that stage, in the color of its instruction. The list below the grid shows which elements are entering and when the instruction finishes.</dd>
    <dt>Vector registers</dt>
    <dd>The registers used by the program, one element per column. The colored strip at the top of each element shows the lane that processes it: element i goes to lane i mod lanes, and each lane holds its own slice of the register file. The tail (indices from vl on) is dimmed, and the elements written in the current step are highlighted. Registers written by comparisons are shown as masks, one bit per element.</dd>
    <dt>Scalar registers, memory and statistics</dt>
    <dd>The <code>x</code> and <code>f</code> registers in use, the memory words (with labels) and the statistics of the whole run.</dd>
</dl>
<h3>Why lanes?</h3>
<p>A unit with 4 lanes has 4 copies of the circuit (for example, 4 pipelined adders) and processes 4 elements per cycle. An instruction with vl elements takes the unit for vl ÷ lanes cycles, rounded up. Since each lane only accesses its own slice of the registers, adding lanes does not require a register file with many ports. The <em>Lanes</em> example adds 32 elements: with the default configuration it takes 109 cycles with 1 lane, 61 with 2, 37 with 4 and 29 with 8; the gain shrinks because the start up latency and the scalar instructions do not change.</p>`,
        },
        {
            id: 'timing',
            title: 'Timing conventions',
            html: `
<ol>
    <li><strong>In order issue.</strong> One instruction per cycle, in program order. If an instruction cannot start, it stalls at issue and the following ones wait, even independent ones.</li>
    <li><strong>Element entry.</strong> A vector instruction that starts in cycle c takes a unit that executes its class. In cycle c elements 0 to lanes minus 1 enter, in cycle c + 1 the next ones, and so on. Strided and indexed accesses deliver fewer elements per cycle (configurable), since each element is at a different address.</li>
    <li><strong>Start up latency.</strong> Each element takes L cycles (the class latency, equal to the pipeline depth) from entry to result: an element that enters in cycle k is written at the end of cycle k + L minus 1.</li>
    <li><strong>Chaining.</strong> When on, an element written at the end of cycle k can be read in cycle k + 1 by the next instruction, which starts as soon as the first elements it needs are ready. When off, the dependent instruction only starts after the producer writes its last element.</li>
    <li><strong>Dependences.</strong> Checked per byte in vector registers: RAW (reading before the write), WAR (writing before an earlier instruction finishes reading) and WAW (writing before an earlier write). In scalar registers, per register; in memory, per address.</li>
    <li><strong>Units.</strong> A pipelined unit accepts the next instruction in the cycle after the last elements of the previous one enter. An unpipelined one only after the previous one finishes.</li>
    <li><strong>Reductions.</strong> The result is a single element, written at the end: after the last group crosses the pipeline, a tree adds the lane results, which takes log2 of the active lanes in cycles.</li>
    <li><strong>Scalars.</strong> A scalar instruction with latency L that starts in cycle c has its result ready at the end of cycle c + L minus 1. Branches and <code>vsetvli</code> use the ALU latency. A taken branch makes fetch lose the configured number of cycles.</li>
    <li><strong>End.</strong> <code>ecall</code> (or the end of the code) stops issue, and execution ends when the instructions in flight finish.</li>
</ol>
<h3>Example</h3>
<p>In the <em>Chaining</em> example (32 elements of 8 bits, 4 lanes, default configuration), each instruction takes 8 cycles to enter its unit. With chaining, <code>vmul.vv</code> starts in the cycle after the first elements of <code>v2</code> are written, and the program ends in 42 cycles; without chaining, each instruction waits for the previous one to finish, and the program takes 63 cycles.</p>`,
        },
        {
            id: 'chaining',
            title: 'Convoys and chimes',
            html: `
<p>Hennessy and Patterson estimate the time of a vector loop with two concepts:</p>
<dl>
    <dt>Convoy</dt>
    <dd>A group of vector instructions that can execute together: without structural hazards among them and, with chaining, even if they depend on each other.</dd>
    <dt>Chime</dt>
    <dd>The time to execute a convoy, roughly vl ÷ lanes cycles. A loop with m convoys takes about m chimes per block of elements, ignoring the start up latency.</dd>
</dl>
<p>In the simulator, convoys show up in the timeline: instructions in the same convoy have overlapping <code>Exec</code> stretches. In the <em>Chaining</em> example, the loads of <code>v1</code> and <code>v2</code> fall in different convoys, because there is a single load and store unit; <code>vmul.vv</code>, <code>vadd.vv</code> and the store overlap thanks to chaining.</p>
<p>To observe the start up latency, compare a run with a small vl (time dominated by latency) and another with a large vl (dominated by vl ÷ lanes).</p>`,
        },
        {
            id: 'config',
            title: 'Configuration',
            html: `
<dl>
    <dt>Model</dt>
    <dd>For now, the vector processor.</dd>
    <dt>XLEN</dt>
    <dd>32 or 64 bits, the width of the scalar registers. RV64 only instructions (<code>ld</code>, <code>addw</code>...) require XLEN = 64.</dd>
    <dt>VLEN</dt>
    <dd>Size of each vector register, from 64 to 1024 bits. Sets VLMAX: with VLEN = 256, 8 elements of 32 bits or 32 elements of 8 bits fit.</dd>
    <dt>Lanes</dt>
    <dd>Elements each vector unit processes per cycle.</dd>
    <dt>Chaining</dt>
    <dd>Lets an instruction start reading the elements produced by the previous one as soon as they are written. See <a href="#h-timing">Timing conventions</a>.</dd>
    <dt>Elements per cycle when strided or indexed</dt>
    <dd>How many elements a strided or indexed access delivers per cycle (limited to the number of lanes). The default is 1.</dd>
    <dt>Bubbles per taken branch</dt>
    <dd>Cycles without issue after a taken branch or jump.</dd>
    <dt>Vector functional units</dt>
    <dd>Name, instruction classes the unit executes and whether it is pipelined. A class can be in more than one unit; the instruction uses the one that frees up first. Every class used by the program needs some unit.</dd>
    <dt>Vector latencies</dt>
    <dd>The start up latency of each class: load, store, integer, multiply, divide, and the floating point operations (add and compare, multiply and <code>vfmacc</code>, divide and square root).</dd>
    <dt>Scalar latencies</dt>
    <dd>Cycles of each scalar class. Branches, jumps and <code>vsetvli</code> use the ALU latency.</dd>
    <dt>Frequency</dt>
    <dd>Used for the execution time: time = cycles ÷ frequency.</dd>
    <dt>Cycle limit</dt>
    <dd>Stops programs with infinite loops.</dd>
    <dt>Example values</dt>
    <dd>Registers read by the program, never written by it, that are neither a base address nor a stride and have no initial value get deterministic example values.</dd>
</dl>`,
        },
        {
            id: 'language',
            title: 'Accepted language',
            html: `
<h3>Scalar</h3>
<p>RV32I and RV64I, the M, F and D extensions, the usual pseudoinstructions (<code>li</code>, <code>la</code>, <code>mv</code>, <code>j</code>, <code>beqz</code>, <code>bnez</code>, <code>ret</code>...), labels, ABI register names, the <code>.text</code> and <code>.data</code> sections and the <code>.byte</code>, <code>.half</code>, <code>.word</code>, <code>.dword</code>, <code>.float</code>, <code>.double</code>, <code>.space</code>, <code>.align</code>, <code>.string</code> and <code>.equ</code> directives. Code starts at <code>0x0</code> and data at <code>0x10000</code>.</p>
<p>Initial values of scalar registers can be given in comments alone on their line: <code># a0 = 10</code>, <code># fa0 = 2.5</code>. Vector registers get data through <code>.data</code> and loads.</p>
<h3>Vector (LMUL = 1)</h3>
<table>
    <tr><th>Group</th><th>Instructions</th></tr>
    <tr><td>Configuration</td><td><code>vsetvli</code>, <code>vsetivli</code></td></tr>
    <tr><td>Loads and stores</td><td><code>vle8/16/32/64.v</code>, <code>vse..</code>, strided <code>vlse..</code>, <code>vsse..</code>, indexed <code>vluxei..</code>, <code>vloxei..</code>, <code>vsuxei..</code>, <code>vsoxei..</code></td></tr>
    <tr><td>Integer (.vv, .vx, .vi)</td><td><code>vadd</code>, <code>vsub</code>, <code>vrsub</code>, <code>vand</code>, <code>vor</code>, <code>vxor</code>, <code>vsll</code>, <code>vsrl</code>, <code>vsra</code>, <code>vmin</code>, <code>vmax</code>, <code>vminu</code>, <code>vmaxu</code>, <code>vmul</code>, <code>vmulh</code>, <code>vmulhu</code>, <code>vdiv</code>, <code>vdivu</code>, <code>vrem</code>, <code>vremu</code>, <code>vmacc</code>, <code>vnmsac</code>, <code>vmadd</code>, <code>vnmsub</code></td></tr>
    <tr><td>Comparisons (mask)</td><td><code>vmseq</code>, <code>vmsne</code>, <code>vmslt</code>, <code>vmsltu</code>, <code>vmsle</code>, <code>vmsleu</code>, <code>vmsgt</code>, <code>vmsgtu</code>, <code>vmfeq</code>, <code>vmfne</code>, <code>vmflt</code>, <code>vmfle</code>, <code>vmfgt</code>, <code>vmfge</code></td></tr>
    <tr><td>Floating point (.vv, .vf)</td><td><code>vfadd</code>, <code>vfsub</code>, <code>vfrsub</code>, <code>vfmul</code>, <code>vfdiv</code>, <code>vfrdiv</code>, <code>vfmin</code>, <code>vfmax</code>, <code>vfsgnj</code>, <code>vfsgnjn</code>, <code>vfsgnjx</code>, <code>vfmacc</code>, <code>vfnmacc</code>, <code>vfmsac</code>, <code>vfnmsac</code>, <code>vfmadd</code>, <code>vfmsub</code>, <code>vfsqrt.v</code>, <code>vfcvt</code></td></tr>
    <tr><td>Reductions</td><td><code>vredsum</code>, <code>vredand</code>, <code>vredor</code>, <code>vredxor</code>, <code>vredmin</code>, <code>vredmax</code>, <code>vredminu</code>, <code>vredmaxu</code>, <code>vfredusum</code>, <code>vfredosum</code>, <code>vfredmin</code>, <code>vfredmax</code></td></tr>
    <tr><td>Masks</td><td><code>vmand</code>, <code>vmnand</code>, <code>vmandn</code>, <code>vmor</code>, <code>vmnor</code>, <code>vmorn</code>, <code>vmxor</code>, <code>vmxnor</code>, <code>vcpop.m</code>, <code>vfirst.m</code></td></tr>
    <tr><td>Moves</td><td><code>vmv.v.v</code>, <code>vmv.v.x</code>, <code>vmv.v.i</code>, <code>vfmv.v.f</code>, <code>vmv.x.s</code>, <code>vmv.s.x</code>, <code>vfmv.f.s</code>, <code>vfmv.s.f</code>, <code>vmerge</code>, <code>vfmerge</code>, <code>vid.v</code></td></tr>
    <tr><td>Pseudoinstructions</td><td><code>vneg.v</code>, <code>vnot.v</code>, <code>vfneg.v</code>, <code>vfabs.v</code>, <code>vmmv.m</code>, <code>vmnot.m</code>, <code>vmclr.m</code>, <code>vmset.m</code>, <code>vmsgt.vv</code>, <code>vmsge.vv</code>, <code>vmfgt.vv</code>, <code>vmfge.vv</code></td></tr>
</table>
<p>Operand order follows the specification: <code>vadd.vv vd, vs2, vs1</code> computes vs2 + vs1, and <code>vfmacc.vf vd, rs1, vs2</code> computes vd + rs1 × vs2. The address of a vector access is written in parentheses, without an offset: <code>vle32.v v1, (a0)</code>. The optional mask comes last: <code>vadd.vv v3, v1, v2, v0.t</code>.</p>`,
        },
        {
            id: 'classroom',
            title: 'Classroom tools',
            html: `
<dl>
    <dt>Exercise</dt>
    <dd>Opens the simulation as an exercise: for each executed vector instruction, the student enters the issue cycle, the cycle of the first result and the completion cycle, and the simulator grades them. It also exports the blank table and the answer key in LaTeX.</dd>
    <dt>Compare</dt>
    <dd>Runs the same program with another configuration (for example, without chaining, or with 8 lanes) and shows the speedup, the statistics, the configuration differences and both timelines side by side.</dd>
    <dt>Export</dt>
    <dd>Timeline and event table in CSV and LaTeX (header with a <code>tabAzul</code> background and white text, with <code>\\hline</code>, without booktabs).</dd>
    <dt>Copy link</dt>
    <dd>Builds an address that opens the same simulation, comparison or exercise, with the program and configuration embedded.</dd>
</dl>`,
        },
        {
            id: 'stats',
            title: 'Statistics',
            html: `
<dl>
    <dt>Cycles, instructions and CPI</dt>
    <dd>Executed instructions, split into vector and scalar ones. The CPI of a vector program is usually high, because each vector instruction does the work of many scalar ones; compare the work by the number of elements.</dd>
    <dt>Elements and floating point operations</dt>
    <dd>Active elements processed by vector instructions and floating point operations (a fused multiply add counts as two), in total and per cycle.</dd>
    <dt>Lane usage</dt>
    <dd>For each unit, the fraction of available slots (cycles × lanes) in which an element entered.</dd>
    <dt>Stalls</dt>
    <dd>Cycles in which issue stalled, by reason, and bubbles caused by taken branches.</dd>
    <dt>Execution time</dt>
    <dd>Cycles ÷ frequency.</dd>
</dl>`,
        },
        {
            id: 'glossary',
            title: 'Glossary',
            html: `
<dl>
    <dt>Chaining</dt><dd>Forwarding each element of an instruction to the next one as soon as it is produced.</dd>
    <dt>Chime</dt><dd>Execution time of a convoy, about vl ÷ lanes cycles.</dd>
    <dt>Convoy</dt><dd>Group of vector instructions that execute at the same time.</dd>
    <dt>Gather and scatter</dt><dd>Indexed load and store: each element at an address computed from an index vector.</dd>
    <dt>Lane</dt><dd>Slice of the vector unit (functional units and part of the register file) that processes one element per cycle.</dd>
    <dt>Mask</dt><dd>Bit vector that enables or disables each element of an operation.</dd>
    <dt>SEW</dt><dd>Width of an element, in bits.</dd>
    <dt>Start up latency</dt><dd>Cycles until the first result of a vector instruction: the pipeline depth of the unit.</dd>
    <dt>Strip mining</dt><dd>Splitting a loop into blocks of up to VLMAX elements.</dd>
    <dt>VLEN and VLMAX</dt><dd>Size of a vector register in bits and number of elements that fit in it.</dd>
    <dt>vl</dt><dd>Number of elements processed by the next vector instructions.</dd>
</dl>`,
        },
        {
            id: 'limits',
            title: 'Simplifications',
            html: `
<ul>
    <li>Only LMUL = 1, and the width of memory accesses must equal SEW (there are no widening or narrowing instructions).</li>
    <li>Inactive and tail elements are always preserved.</li>
    <li>Memory has a fixed latency (that of the load and store classes), without caches or bank conflicts; strided and indexed accesses deliver a fixed number of elements per cycle.</li>
    <li>Issue stops at the first instruction that cannot start; there are no instruction queues for the vector units.</li>
    <li>There is no branch prediction: taken branches cost a fixed number of bubbles.</li>
    <li>There is no limit on vector register file ports.</li>
    <li>Values are computed when the instruction reaches issue, in program order; the displayed state changes in the cycles in which each element is written. The final state is checked against a functional reference simulator.</li>
</ul>`,
        },
    ],
};
