---
name: formula-latex
description: 要把图片、截图、手写或 PDF 里的数学公式转成 LaTeX（或 Word 公式），或检查、修改 LaTeX 公式写法时使用。
---
# 公式转 LaTeX

1. 看公式：截图或照片用 attach_image（需要能看图的模型；看不了时请用户把公式打出来或描述）；PDF 里的用 read_paper 找到那一页，文字层里公式常常乱掉，以图为准。
2. 转写：
   - 只输出公式本身，行内用 $...$，独立公式用 equation（要编号）或 \[ ... \]；
   - 变量用斜体、函数名用 \sin \log \exp 等命令，单位和文字用 \mathrm{} 或 \text{}；
   - 矩阵用 pmatrix/bmatrix，分段函数用 cases，多行对齐用 align；
   - 看不清的符号用 ? 标出来并问用户，不要猜。
3. 检查：长公式放进一个最小文档用 compile_latex 编译确认能通过；有 amsmath 以外的宏包要说明。
4. 要 Word 公式时：给出 LaTeX，并说明在 Word 里“插入 → 公式 → LaTeX”粘贴即可转换。
5. 多个公式时按出现顺序编号，和原文的编号对应。
