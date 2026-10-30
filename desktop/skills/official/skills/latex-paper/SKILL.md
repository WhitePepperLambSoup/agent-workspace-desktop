---
name: latex-paper
description: 要用 LaTeX 写论文、学位论文、报告或幻灯片，改 LaTeX 编译错误，排参考文献格式时使用。
---
# LaTeX 写作

1. 新文档：没有现成模板就按语言选——中文用 ctexart（参考文献 gbt7714 宏包，\bibliographystyle{gbt7714-numerical}），英文用 article + natbib。学校或期刊有官方模板时请用户提供，不要自己仿造。
2. 结构：标题、摘要、各节、图表、参考文献分开写清楚；长文档按章拆成 chapters/*.tex，用 \include。
3. 图：数据图用科研计算环境画（aw_sciplot，期刊栏宽、PDF 矢量），存到 figures/，正文用 \includegraphics[width=\linewidth]{figures/名字.pdf}，每张图有 \caption 和 \label，正文里用 \ref 提到它。
4. 表：用 booktabs 三线表（\toprule \midrule \bottomrule），不用竖线。
5. 公式：编号公式用 equation，多行用 align；引用用 \eqref。
6. 参考文献：从文献库导出 .bib（export_references format=bibtex），正文 \cite{键}。不要手写或编造条目；不确定的用 paper_lookup 查。
7. 每次改完都 compile_latex，看 errors 逐条修，直到 error_count 为 0；再看 warnings 里的 undefined reference / citation。中文排版问题用 check_latex 检查。
8. 交付：告诉用户 PDF 位置，用 [main.pdf](路径/main.pdf) 链接；用户可以在“文件”里打开 .tex 用内置编辑器继续改，双击 PDF 能跳回源码。
