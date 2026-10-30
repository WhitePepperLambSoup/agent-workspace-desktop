---
name: office-tables
description: 用户要合并多张表、按关键列匹配（类似 VLOOKUP）、比对两张表的差异、做工资条、批量生成通知或证书（邮件合并），或要做带公式、图表、条件格式的 Excel 时使用。
---
# 表格处理

1. 先看表：office_read inspect 看每张表的工作表、列名、行数和公式。列名对不上（“工号”和“员工编号”）、有合并单元格、表头不止一行时先告诉用户，确认按哪一列对应。
2. 常用做法（结果都存成新文件，原表不改）：
   - 多张结构相同的表上下拼接：spreadsheet merge（会加一列“来源”）；
   - 按关键列把别的表的列匹配过来：spreadsheet merge，how 为 join，keys 写关键列；匹配不上的行会标黄并计数，要在回复里说明；
   - 两张表比对：spreadsheet compare，keys 写关键列（没有就按行号），不同的单元格标红，只在一张表里的行单独列出；
   - 工资条：spreadsheet payslips，每人一条，带表头，中间空一行方便裁开；
   - 批量生成 Word（录用通知、证书、邀请函）：Word 模板里用 {{列名}} 标出要填的地方，office_read template_fields 核对字段，word_document mail_merge 按行生成，name_pattern 用来命名文件，combine 合成一份，pdf 同时导出 PDF；
   - 电子发票汇总：spreadsheet invoices。
3. 自己做表：spreadsheet build。合计、平均、占比写成真正的公式（=SUM(B2:B20)），不要算好填数字；金额用 #,##0.00、百分比用 0.0%；需要时加条件格式（超预算标红）和图表。
4. 数字要核对：合并、匹配后行数是否对得上，合计是否等于分项之和；有出入的写在回复里，不要悄悄改数据。
5. 回复里写新文件的位置、行数、匹配不上或有差异的条数，以及需要用户确认的地方。
