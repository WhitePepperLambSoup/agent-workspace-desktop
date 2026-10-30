---
name: figures-statistics
description: 要用实验数据作科研图（散点、折线、柱状图加误差棒、箱线图、火山图、生存曲线、PCA、热图、剂量反应曲线）或做统计检验、回归拟合、期刊图片规范检查时使用。
---
# 科研作图与统计

1. 先看数据：query_table 或 read_document 看列名、行数、缺失值；问清楚哪列是自变量、因变量、分组，单位是什么，要投哪个期刊（决定宽度和字号）。
2. 需要科研计算环境（系统提示里有 Scientific Python 时才有）。没有的话告诉用户在 设置 → 科研计算环境 安装，不要假装能运行。
3. 写脚本到 analysis/（例如 analysis/plot_growth.py），用 science_python 运行；脚本里：
   - import aw_sciplot as sp；df = sp.read("data/xxx.csv")（必须用 sp.read，用户拖动数据点修正后才能按修正数据重画）；
   - fig, ax = sp.figure("nature", journal="nature")，多面板用 sp.panels("2x2", journal=..., column="double")；
   - 常见图直接用 sp.templates（volcano、kaplan_meier、pca、clustermap、dose_response、correlation、bar_points）；
   - 统计：两组比较 sp.compare，图上标显著性 sp.annotate_pairs（多组比较默认 Bonferroni 校正），回归 sp.fit_line；
   - sp.save(fig, "figures/名字") 存 PNG、PDF、SVG 和数据点记录。
4. 统计要写清楚：检验方法、样本量 n、统计量、p 值（校正后的也写）、效应量；样本少或不满足正态时说明并用非参数检验。不用 p 值以外的说法夸大结论。
5. sp.check("figures/名字", "nature") 检查期刊规范，不通过的项说明原因并改。
6. 回答里用 [图名](figures/名字.png) 链接图片；告诉用户可以在预览里“拖动数据点”修正录错的数据，原数据不会被改，修正写进 *.corrected.csv 并留记录。
